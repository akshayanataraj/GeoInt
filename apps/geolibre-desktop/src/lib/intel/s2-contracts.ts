/**
 * PROVISIONAL shapes for the S2 geospatial module.
 *
 * Unlike `contracts.ts`, these are **not** mirrors of anything. The media
 * service's `modules/s2/` package is an empty scaffold today -- every file in it
 * is a bare `__init__.py`, there are no routes, no schemas, and no migrations.
 * The only description of the module is prose in
 * `docs/MICROSERVICES_ARCHITECTURE.md` §5.4.4, which lists the capabilities
 * ("S2 cell calculations, geographic filtering and aggregation, event severity
 * and taxonomy mapping, map/time-series/location statistics, event and
 * related-news lookup, alert definitions and matching") without specifying a
 * single field.
 *
 * So these types are the UI's own working assumption, invented to build the
 * panel against, and they will almost certainly not match the eventual server
 * contract. They are kept in a separate file from the real mirrors precisely so
 * nobody mistakes one for the other: when the S2 module ships, expect to
 * rewrite this file rather than extend it, and treat any disagreement as this
 * file being wrong.
 *
 * The one thing worth preserving across that rewrite is the severity ladder,
 * which is a product/visual decision (it drives the console's colour semantics)
 * rather than a guess about the wire format.
 */

/**
 * Event severity, ordered least to most severe. Drives colour throughout the
 * console, so the ordering is load-bearing: `SEVERITY_ORDER.indexOf` is used for
 * sorting and for picking the accent of an aggregate.
 */
export const SEVERITY_ORDER = ["routine", "elevated", "high", "critical"] as const;

export type Severity = (typeof SEVERITY_ORDER)[number];

/** One aggregated S2 cell. */
export interface S2Cell {
  /** S2 cell token (hex), the module's natural key for a cell. */
  token: string;
  /** S2 level; higher is a smaller cell. */
  level: number;
  /** Human label for the area the cell covers, for display in a list. */
  label: string;
  centroid: { lat: number; lng: number };
  eventCount: number;
  severity: Severity;
  /**
   * Change in `eventCount` against the previous equivalent window, as a signed
   * ratio (0.25 = up 25%). Null when there is no comparable prior window, which
   * must render as "no baseline" rather than as 0% -- they mean different things
   * to an analyst.
   */
  trend: number | null;
}

/** Rollup across every cell currently in scope. */
export interface S2Summary {
  totalEvents: number;
  cellsActive: number;
  /** Cell counts per severity band. Every band is present, including zeros. */
  bySeverity: Record<Severity, number>;
  /** ISO-8601. When the aggregation was computed, not when it was fetched. */
  asOf: string;
  /** Coarse window the aggregation covers, e.g. "24h". */
  window: string;
}
