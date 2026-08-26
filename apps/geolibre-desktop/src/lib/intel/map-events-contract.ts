/**
 * PROVISIONAL shapes for the chat-driven map playback -- like `s2-contracts.ts`,
 * these are **not** a mirror of anything the backend returns today. They are
 * this frontend's own strawman for the "render this on the map" tool contract
 * drafted in `UI_REPURPOSE_PLAN.md` §10 (`render_map_events`), shaped so the
 * chat panel and the map playback overlay can be built against a concrete
 * shape now rather than waiting on backend sign-off.
 *
 * The blocking fact from that section still holds: the real News/Social
 * contract has no per-event coordinates, and no per-event coordinates+time in
 * the same place -- `/news/recent` has dated timeline steps with no
 * coordinates, `/news/country/coordinates` has country centroids with no
 * time. So every `ChatMapLocation` in this app today comes from
 * `fixtures.ts`, not a live response.
 *
 * One location, multiple items: a real answer's evidence naturally clusters
 * by place (several sources reporting on the same district), not one
 * coordinate per citation, which is what actually makes "several news/social
 * items surfacing at one point before the story moves on" a sensible shape --
 * see `ChatMapLocation.items`.
 */

export const MEDIA_ITEM_KINDS = ["news", "social"] as const;

export type MediaItemKind = (typeof MEDIA_ITEM_KINDS)[number];

/** One retrieved piece of evidence surfaced at a location. */
export interface ChatMediaItem {
  /** Stable id (e.g. a citation id). */
  id: string;
  kind: MediaItemKind;
  title: string;
  snippet?: string;
  sourceUrl?: string;
  /** ISO 8601. */
  timestamp: string;
}

export const EVENT_SEVERITIES = ["info", "warning", "critical"] as const;

export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

/** One stop in the sequence: a place, with the evidence found there. */
export interface ChatMapLocation {
  /** Stable id (e.g. the first item's citation id). */
  id: string;
  lat: number;
  lng: number;
  label: string;
  severity?: EventSeverity;
  /** In display order; revealed one at a time while this location is active. */
  items: readonly ChatMediaItem[];
}
