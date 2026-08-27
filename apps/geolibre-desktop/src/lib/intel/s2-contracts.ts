/**
 * S2 Grid shapes -- mirrored from the *target* API, not the live one.
 *
 * The media service's `modules/s2/` package is still an empty scaffold (no
 * routes, no schemas, no migrations) -- but unlike the earlier version of this
 * file, there is now a concrete spec for what it will return: `S2_GRID.md`
 * (repo root), documenting the legacy `s2grid_backend` this module is meant to
 * replace, including full example payloads for every endpoint. These types
 * mirror `GET /api/s2/map`'s response shape from that doc as closely as
 * practical, the same way `contracts.ts` mirrors News. When the real module
 * ships, expect small field-level corrections here, not a rewrite from
 * scratch -- this is a real target, not a guess, this time.
 *
 * One deliberate deviation from the doc worth calling out: `poly` there is an
 * array of `[lat, lng]` pairs (see the doc's own example -- `[13.1, 80.1]`
 * near Chennai, whose real coordinates are `lat 13.08, lng 80.27`). GeoJSON
 * and MapLibre both require `[lng, lat]`. This file keeps the doc's `[lat,
 * lng]` order in `S2Cell.poly` so it stays a literal mirror of the wire
 * shape -- the swap to GeoJSON order happens once, at the map-layer boundary
 * (`S2GridLayer.tsx`'s `polyToRingCoordinates`), not scattered across every
 * consumer.
 */

/** Severity band, matching the wire field name (`tier`) and its literal values. */
export const S2_TIER_ORDER = ["green", "yellow", "red"] as const;

export type S2Tier = (typeof S2_TIER_ORDER)[number];

/**
 * One aggregated S2 cell -- `GET /api/s2/map`'s `cells[]`.
 *
 * `sev` is the continuous [0, 1] score `tier` is thresholded from (green <
 * 0.34, yellow < 0.67, else red, per S2_GRID.md section 2.2) -- kept as a
 * separate field rather than derived client-side, since the threshold
 * constants belong to the backend, not duplicated here.
 */
export interface S2Cell {
  /** S2 cell token (hex), the module's natural key for a cell. */
  token: string;
  /** Polygon vertices tracing the cell boundary, as `[lat, lng]` pairs -- see this file's module docstring. */
  poly: readonly [number, number][];
  /** Event count in this cell for the active filters/window. */
  n: number;
  /** Distinct location count within the cell. */
  nLoc: number;
  /** Continuous severity score in [0, 1]. */
  sev: number;
  tier: S2Tier;
  /** Signed ratio vs. the comparable prior window (0.25 = up 25%). */
  growth: number;
  /** Whether media attention here is accelerating (decay λ < 0) -- drives the growth-halo treatment. */
  growing: boolean;
}

/**
 * One individual location -- `GET /api/s2/map`'s `points[]`. Shown as dots
 * within a cell (or standalone at high zoom) rather than folded into the
 * cell aggregate, so an analyst can tell "one very active place" from "many
 * quiet ones" inside the same cell.
 */
export interface S2Point {
  lat: number;
  lng: number;
  /** Human place name, e.g. "Chennai, Tamil Nadu, India". */
  place: string;
  /** Event count at this location. */
  n: number;
  /** Mean severity score in [0, 1]. */
  sev: number;
  /** Peak severity score seen at this location in the window. */
  sevMax: number;
  tier: S2Tier;
  growing: boolean;
  growth: number;
  /** Total news mentions (distinct from `n`, the classified-event count). */
  mentions: number;
  /** Mean article tone, roughly [-100, 100]; negative is more negative coverage. */
  tone: number;
}

/** `GET /api/s2/map`'s full response. */
export interface S2MapData {
  /** S2 level actually used for this response's cells. */
  level: number;
  cellKm: number;
  cells: readonly S2Cell[];
  points: readonly S2Point[];
  nLocations: number;
  nEvents: number;
  /** True when the result set hit a server-side cap and is incomplete. */
  truncated: boolean;
}

/**
 * Rollup across the currently-loaded `S2MapData`, for the metrics panel.
 * Not a separate endpoint -- the real API has no single "summary" response;
 * this is derived client-side from `cells` (see `summarizeS2Map`).
 */
export interface S2Summary {
  totalEvents: number;
  cellsActive: number;
  /** Cell counts per tier. Every tier is present, including zeros. */
  byTier: Record<S2Tier, number>;
}

/** Derives the panel's rollup from a fetched map response. Pure, no fetch of its own. */
export function summarizeS2Map(data: S2MapData): S2Summary {
  const byTier: Record<S2Tier, number> = { green: 0, yellow: 0, red: 0 };
  for (const cell of data.cells) byTier[cell.tier] += 1;
  return {
    totalEvents: data.nEvents,
    cellsActive: data.cells.length,
    byTier,
  };
}

/**
 * `GET /api/s2/series`'s aggregate half -- a time-windowed rollup (event
 * count already covered by `S2Summary`; this is the kinematic/sentiment
 * metrics S2_GRID.md sections 2.3-2.5 define) for the current selection, as
 * opposed to `/api/s2/map`'s per-cell/per-point geometry. This is what the
 * metrics panel's KPI tiles read -- deliberately *not* re-derived from
 * `S2MapData`, because the map already shows the tier/severity breakdown
 * spatially; duplicating that as a second list in the panel is exactly what
 * this type exists to avoid. Everything here is information the map has no
 * way to display: a trend over time, a rate of change, a sentiment anomaly
 * count.
 */
export interface S2SeriesSummary {
  /** Events per hour over the window (2.4). */
  velocity: number;
  /** Change in velocity across the window, events/hour^2 -- positive means escalating (2.4). */
  acceleration: number;
  /** Mean article tone, roughly [-100, 100]; negative is more negative coverage. */
  meanTone: number;
  /** Fraction of events that are conflict, CAMEO QuadClass 3 or 4 (2.2). */
  conflictShare: number;
  /** Fraction of events specifically Material Conflict, QuadClass 4 (2.2). */
  materialConflictShare: number;
  /** Count of buckets with a significant tone z-score, |z| >= 3 (2.5). */
  anomalyBuckets: number;
}

/**
 * One point in the selection's severity-over-time trend -- coarse enough for
 * the panel's compact sparkline, not a full timeseries explorer. Event counts
 * split by tier (not a bare total) so the sparkline can show *composition*
 * shifting over time (e.g. red's share growing even while the total holds
 * steady), which a single-number trend line cannot.
 */
export interface S2SeriesBucket {
  /** ISO 8601, start of the bucket. */
  bucket: string;
  green: number;
  yellow: number;
  red: number;
}

export const S2_SPANS = ["24h", "7d", "30d"] as const;

export type S2Span = (typeof S2_SPANS)[number];

/** `GET /api/s2/series`'s full response, for the current filters. */
export interface S2Series {
  span: S2Span;
  buckets: readonly S2SeriesBucket[];
  summary: S2SeriesSummary;
}
