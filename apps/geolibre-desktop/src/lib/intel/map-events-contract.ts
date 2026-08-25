/**
 * PROVISIONAL shape for a chat-driven map event -- like `s2-contracts.ts`, this
 * is **not** a mirror of anything the backend returns today. It is this
 * frontend's own strawman for the "render this on the map" tool contract
 * drafted in `UI_REPURPOSE_PLAN.md` §10 (`render_map_events`), typed here so
 * the chat panel and the map playback overlay can be built against a concrete
 * shape now rather than waiting on backend sign-off.
 *
 * The blocking fact from that section still holds: the real News/Social
 * contract has no per-event coordinates, and no per-event coordinates+time in
 * the same place -- `/news/recent` has dated timeline steps with no
 * coordinates, `/news/country/coordinates` has country centroids with no time.
 * So every `ChatMapEvent` in this app today comes from `fixtures.ts`, not a
 * live response. Field names intentionally match the plan's draft tool schema
 * (camelCased for JS) so wiring a real backend later is a rename, not a
 * redesign.
 */

export const EVENT_SEVERITIES = ["info", "warning", "critical"] as const;

export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export interface ChatMapEvent {
  /** Stable id (e.g. a citation id) -- lets a future incremental update
   *  replace this event in place instead of duplicating it. */
  id: string;
  lat: number;
  lng: number;
  /** ISO 8601. Required here (unlike the draft tool schema's optional field):
   *  every event in this app drives the animated sequence, which needs an
   *  order. */
  timestamp: string;
  label: string;
  description?: string;
  sourceUrl?: string;
  severity?: EventSeverity;
}
