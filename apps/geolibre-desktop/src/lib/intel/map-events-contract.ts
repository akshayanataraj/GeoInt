/**
 * Shapes for the chat-driven map playback -- this app's own internal
 * representation, not a wire mirror. The News chat response now carries a
 * real `map_locations` field (`contracts.ts`'s `MapLocation`/`MapMediaItem`,
 * snake_case, GDELT-resolved coordinates, no `kind`); `client.ts`'s
 * `toChatMapLocations` maps that onto the shapes below, which is what
 * `ChatMapPlayback`/`chat-map-sequence.ts` are actually built against. Kept
 * as a separate app-internal type (rather than using the wire type directly)
 * so this app's own field names/conventions (`kind` always present, camelCase)
 * don't have to track the service's Pydantic models verbatim -- see
 * `toChatMapLocations`'s docstring for the specific mapping decisions
 * (`kind` defaulted to `"news"`, blank-string fallbacks, etc.).
 *
 * Originally drafted before the backend had any of this (the "render this on
 * the map" tool contract in `UI_REPURPOSE_PLAN.md` §10, `render_map_events`)
 * so the chat panel and map playback overlay could be built against a
 * concrete shape without waiting on backend sign-off; a fixture dataset
 * exercised it during that period and has since been deleted now that real
 * data does (see `IntelChatPanel.tsx`'s module docstring).
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
  /**
   * Whether the answer's prose actually cited this item, as opposed to it
   * merely being other retrieved coverage found at the same place -- see
   * `MapMediaItem.cited` in `contracts.ts`. A location's `items` includes
   * both; this is what lets the UI show the two differently instead of
   * implying the model vetted every item equally.
   */
  cited: boolean;
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
