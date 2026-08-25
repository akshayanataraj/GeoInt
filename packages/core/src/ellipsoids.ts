/**
 * The reference ellipsoid used for measurement.
 *
 * **Earth only.** Upstream GeoLibre shipped twelve celestial bodies here (Moon,
 * Mars, Mercury, Venus, the Galilean moons, Titan, Pluto, Charon) with matching
 * planetary basemap mosaics and a planet switcher in the layer panel. All of it
 * is removed: this is a terrestrial intelligence product, and the option to put
 * the map on Ganymede was pure surface area -- extra basemap entries, extra UI,
 * and a per-project "which body is this" concept threaded through measurement,
 * elevation, and basemap persistence.
 *
 * What remains is the shape of that machinery with a single entry, deliberately
 * rather than inlining an Earth constant everywhere. The measurement helpers
 * below (`earthLengthToBody`, `getActiveMeanRadiusMeters`, ...) are called from
 * several packages; collapsing them would mean editing every call site for no
 * behavioural gain, and they now reduce to identity / Earth's radius, which is
 * correct. If a second body is ever genuinely wanted, adding it back here is the
 * whole change -- but the basemaps, the switcher, and the picker sections are
 * gone and would have to be rebuilt.
 *
 * Note this module never provided real multi-CRS rendering: MapLibre only
 * renders Web Mercator and treats the planet as a unit sphere
 * (maplibre-gl-js#168). Its only job was supplying a radius to measurement code,
 * which is now always Earth's.
 *
 * The active ellipsoid is a module-level singleton kept in sync with the
 * project's map preferences (see the store's `setPreferences`); measurement
 * helpers read it lazily at call time so callers need not thread it through
 * their signatures.
 */

/** A biaxial (rotational) reference ellipsoid. */
export interface Ellipsoid {
  /** Stable id persisted in the project (`map.ellipsoidId`). */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Equatorial (semi-major) radius in metres — the "web mercator" radius. */
  semiMajorAxisMeters: number;
  /**
   * Inverse flattening `1/f`. `0` would denote a perfect sphere, in which case
   * the polar radius equals {@link semiMajorAxisMeters}.
   */
  inverseFlattening: number;
}

/**
 * The one built-in ellipsoid: Earth, WGS 84. Kept as a list so
 * {@link EllipsoidId} and {@link getEllipsoid} keep working unchanged.
 */
export const ELLIPSOIDS = [
  {
    id: "earth",
    name: "Earth (WGS 84)",
    semiMajorAxisMeters: 6378137,
    inverseFlattening: 298.257223563,
  },
] as const satisfies readonly Ellipsoid[];

export type EllipsoidId = (typeof ELLIPSOIDS)[number]["id"];

export const DEFAULT_ELLIPSOID_ID: EllipsoidId = "earth";

/** Look an ellipsoid up by id, falling back to Earth for unknown ids. */
export function getEllipsoid(id: string | undefined): Ellipsoid {
  return (
    ELLIPSOIDS.find((e) => e.id === id) ?? ELLIPSOIDS.find((e) => e.id === DEFAULT_ELLIPSOID_ID)!
  );
}

/**
 * Mean radius `R = (2a + b) / 3` in metres, where `b` is the polar radius
 * derived from the inverse flattening. This is the radius used for spherical
 * (haversine) distance and area math.
 */
export function meanRadiusMeters(ellipsoid: Ellipsoid): number {
  const a = ellipsoid.semiMajorAxisMeters;
  if (!ellipsoid.inverseFlattening) return a;
  const f = 1 / ellipsoid.inverseFlattening;
  const b = a * (1 - f);
  return (2 * a + b) / 3;
}

/** Earth's mean radius in metres — the radius Turf.js and MapLibre bake in. */
export const EARTH_MEAN_RADIUS_METERS = meanRadiusMeters(ELLIPSOIDS.find((e) => e.id === "earth")!);

// --- Active ellipsoid singleton -------------------------------------------

let activeEllipsoidId: EllipsoidId = DEFAULT_ELLIPSOID_ID;

/**
 * Point the measurement helpers at a body. Unknown ids fall back to Earth so a
 * malformed project can never break measurements. Safe to call on every
 * preferences change; it is a cheap assignment.
 */
export function setActiveEllipsoidId(id: string | undefined): void {
  activeEllipsoidId = getEllipsoid(id).id as EllipsoidId;
}

export function getActiveEllipsoid(): Ellipsoid {
  return getEllipsoid(activeEllipsoidId);
}

/** Mean radius (metres) of the active body — for haversine distance/area. */
export function getActiveMeanRadiusMeters(): number {
  return meanRadiusMeters(getActiveEllipsoid());
}

/** Semi-major axis (metres) of the active body — for its Web-Mercator scale. */
export function getActiveSemiMajorAxisMeters(): number {
  return getActiveEllipsoid().semiMajorAxisMeters;
}

// --- Earth-locked geodesy correction ---------------------------------------

/**
 * The active body's mean radius as a fraction of Earth's — `R_body / R_earth`,
 * and exactly `1` on Earth.
 *
 * Everything GeoLibre measures ultimately comes from lon/lat *angles*, and the
 * only thing that turns an angle into a ground distance is the radius it is
 * multiplied by. Turf.js hardcodes Earth's, with no per-call override (that is
 * the "Turf is Earth-locked" half of GeoLibre#1128), so rather than patch or
 * replace Turf we post-scale what it returns and pre-scale what we hand it. The
 * result is exact for a sphere, which is how every non-Earth body GeoLibre
 * offers is modelled anyway, and within Mars' 0.6% flattening at worst.
 *
 * Suggested by @thareUSGS (USGS Astrogeology) on GeoLibre#1128 as the practical
 * workaround planetary web maps have long used on Earth-locked engines.
 */
export function getActiveBodyRadiusRatio(): number {
  return getActiveMeanRadiusMeters() / EARTH_MEAN_RADIUS_METERS;
}

/**
 * Convert a length Turf.js measured on Earth into the active body's true ground
 * length. A no-op on Earth.
 *
 * Use on anything Turf *returns* — a distance, a length, a perimeter.
 *
 * The correction is a dimensionless ratio, so it is unit-agnostic: pass the
 * length in whatever unit Turf gave it back (metres, kilometres, miles) and the
 * result is in that same unit. There is no hidden unit conversion here.
 */
export function earthLengthToBody(length: number): number {
  return length * getActiveBodyRadiusRatio();
}

/**
 * Convert a true ground length on the active body into the Earth-equivalent
 * length to hand Turf.js. A no-op on Earth.
 *
 * Use on anything passed *into* Turf as a distance — a buffer width, a circle
 * or sector radius, a search threshold — so the resulting geometry spans that
 * distance on this body rather than on Earth.
 *
 * Unit-agnostic like {@link earthLengthToBody}: pass the length in whatever
 * unit you are about to hand Turf alongside it, and the result is in that unit.
 */
export function bodyLengthToEarth(length: number): number {
  return length / getActiveBodyRadiusRatio();
}

/**
 * Convert an area Turf.js measured on Earth into the active body's true ground
 * area. A no-op on Earth.
 *
 * Areas scale with the *square* of the radius ratio, so this is not the same
 * correction as {@link earthLengthToBody}. Unit-agnostic in the same way, for
 * whatever squared unit the area is expressed in.
 */
export function earthAreaToBody(area: number): number {
  const ratio = getActiveBodyRadiusRatio();
  return area * ratio * ratio;
}
