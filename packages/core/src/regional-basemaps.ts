/**
 * Raster basemaps for regions the default catalog does not serve well.
 *
 * The mechanism mirrors {@link PlanetaryBasemap}: `styleUrl` is a
 * `geolibre://regional-basemap/<id>` sentinel that the map controller's
 * `resolveMapStyle` expands into a raster style at apply time (it is not a
 * fetchable URL). A separate sentinel prefix from the planetary one keeps the
 * two apart, because selecting a planetary basemap also switches the project's
 * celestial body, which must not happen here.
 */

/**
 * The regions the pickers group these basemaps under. Each gets its own
 * heading and explanatory note inside the single "Regional" section, so a
 * future region slots in without the section itself becoming country-specific.
 */
export type RegionalBasemapRegionId = "india";

/**
 * A raster basemap for a region, rendered from XYZ (or TMS) tiles.
 */
export interface RegionalBasemap {
  id: string;
  /** Which region heading this basemap sits under. */
  region: RegionalBasemapRegionId;
  /**
   * Display name, in the language of the region the basemap serves. These are
   * Chinese-market services whose users know them by their Chinese names, and
   * the section heading already says which region they belong to, so the labels
   * are not translated the way UI strings are.
   */
  name: string;
  /** Sentinel stored as the basemap style URL. */
  styleUrl: string;
  /** XYZ (or TMS, see {@link scheme}) tile template. */
  tileUrl: string;
  /**
   * An optional transparent overlay drawn above {@link tileUrl}, so a satellite
   * basemap can ship with its roads and labels burnt in as one selectable
   * basemap rather than something the user has to stack by hand.
   */
  overlayTileUrl?: string;
  /**
   * Tile row ordering. Tencent numbers rows from the bottom (**TMS**); Amap is
   * standard XYZ. Omit for XYZ; MapLibre defaults to `"xyz"` when absent.
   */
  scheme?: "tms";
  /** Max native zoom of the source (MapLibre overzooms beyond this). */
  maxZoom: number;
  /** Attribution shown on the map. */
  attribution: string;
  /**
   * True when the tiles are drawn in GCJ-02, an offset datum some
   * jurisdictions mandate for public map services. Neither GeoLibre nor
   * MapLibre applies the shift, so WGS84 data laid over such a basemap would
   * land roughly 100 to 700 m off (see docs/getting-started.md).
   */
  gcj02?: boolean;
}

export const REGIONAL_BASEMAP_SENTINEL_PREFIX = "geolibre://regional-basemap/";

const sentinel = (id: string) => `${REGIONAL_BASEMAP_SENTINEL_PREFIX}${id}`;

const GOOGLE_MAPS_ATTRIBUTION = '&copy; <a href="https://www.google.com/maps">Google Maps</a>';

// The classic `mt#.google.com/vt` tile endpoint is undocumented and not the
// official, billed Google Maps Platform API -- unauthorized use of it is a
// real Terms of Service risk for a production deployment (see
// UI_REPURPOSE_PLAN.md for the fuller writeup; a sibling project in this same
// effort removed an identical entry for exactly this reason). Kept here as a
// deliberate, informed choice for this deployment rather than an oversight.
// `gl=in` is the undocumented region-bias parameter some integrations use to
// request India's officially depicted borders (e.g. the full extent of
// Jammu & Kashmir); it is not a documented, guaranteed contract, so treat the
// border rendering as best-effort, not authoritative.
const GOOGLE_ROADMAP_URL = "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en&gl=in";
// `lyrs=y` is Google's "hybrid" layer: satellite imagery with roads/labels
// burnt in, in one tile request (unlike Amap's old two-source overlay
// pattern above, this provider composites both itself). Chosen as the
// product default for a photorealistic look (see UI_REPURPOSE_PLAN.md §2a)
// while keeping place names/roads legible on top of real imagery.
const GOOGLE_HYBRID_URL = "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=en&gl=in";

/** Basemaps that render India's officially depicted borders. */
export const INDIA_BASEMAPS: readonly RegionalBasemap[] = [
  {
    id: "google-hybrid",
    region: "india",
    name: "Google Maps (Satellite)",
    styleUrl: sentinel("google-hybrid"),
    tileUrl: GOOGLE_HYBRID_URL,
    maxZoom: 20,
    attribution: GOOGLE_MAPS_ATTRIBUTION,
  },
  {
    id: "google-roadmap",
    region: "india",
    name: "Google Maps",
    styleUrl: sentinel("google-roadmap"),
    tileUrl: GOOGLE_ROADMAP_URL,
    maxZoom: 20,
    attribution: GOOGLE_MAPS_ATTRIBUTION,
  },
];

/** Every regional basemap, across all regions. */
export const REGIONAL_BASEMAPS: readonly RegionalBasemap[] = INDIA_BASEMAPS;

/**
 * The regional basemaps grouped for display, one entry per region. Both the New
 * Project and Change Basemap panels render this inside a single collapsible
 * "Regional" section, so adding a region is a change here rather than in two
 * dialogs.
 */
export const REGIONAL_BASEMAP_GROUPS: readonly {
  id: RegionalBasemapRegionId;
  basemaps: readonly RegionalBasemap[];
}[] = [{ id: "india", basemaps: INDIA_BASEMAPS }];

/** Look up a regional basemap by its `geolibre://regional-basemap/<id>` sentinel. */
export function getRegionalBasemapByStyleUrl(
  styleUrl: string | undefined,
): RegionalBasemap | undefined {
  if (!styleUrl) return undefined;
  return REGIONAL_BASEMAPS.find((basemap) => basemap.styleUrl === styleUrl);
}

/** Look up a regional basemap by id. */
export function getRegionalBasemapById(id: string | undefined): RegionalBasemap | undefined {
  if (!id) return undefined;
  return REGIONAL_BASEMAPS.find((basemap) => basemap.id === id);
}

/** Whether a style URL is a regional-basemap sentinel, resolvable or not. */
export function isRegionalBasemapSentinel(styleUrl: string | undefined): boolean {
  return Boolean(styleUrl?.startsWith(REGIONAL_BASEMAP_SENTINEL_PREFIX));
}
