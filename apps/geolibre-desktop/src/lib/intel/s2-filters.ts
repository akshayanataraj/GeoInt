/**
 * Tiny external store for the S2 Grid map/panel's shared filter state -- same
 * idiom as `chat-map-sequence.ts` (a module-level store, `useSyncExternalStore`,
 * no context provider) and for the same reason: `S2MetricsPanel` (in
 * `IntelConsole`'s left dock) and `S2GridLayer` (in `DesktopShell`'s map area)
 * are siblings under `App`, not parent/child, so there is no natural place to
 * lift local component state to.
 *
 * Deliberately not part of `@geolibre/core`'s store: this is this app's own,
 * still-fixture-backed S2 Grid concept (see `s2-contracts.ts`), not a
 * GeoLibre project/domain type, and it is never saved or undone -- same
 * reasoning `chat-map-sequence.ts` gives for staying out of that store.
 *
 * Both consumers read `fetchS2Map(filters)`/`fetchS2Series(filters)` with the
 * current snapshot, so a filter change refetches (and redraws/re-lists) both
 * the map choropleth and the panel's KPIs/top-locations list together --
 * "find some area" narrows what both surfaces show, not just one of them.
 */

import { useSyncExternalStore } from "react";
import { S2_TIER_ORDER, type S2Span, type S2Tier } from "./s2-contracts";

export interface S2Filters {
  span: S2Span;
  /** Tiers to include. All three by default -- unchecking one narrows, not the other way round. */
  tiers: ReadonlySet<S2Tier>;
  /** Case-insensitive substring match against a point's `place`. Empty = no filter. Cells have no place name to match, so this narrows points only -- see `client.ts`'s `fetchS2Map`. */
  place: string;
}

const DEFAULT_FILTERS: S2Filters = {
  span: "7d",
  tiers: new Set(S2_TIER_ORDER),
  place: "",
};

let state: S2Filters = DEFAULT_FILTERS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setS2Span(span: S2Span): void {
  state = { ...state, span };
  emit();
}

/** Toggling every tier off is a valid (if unusual) "show nothing" state, not specially prevented. */
export function toggleS2Tier(tier: S2Tier): void {
  const next = new Set(state.tiers);
  if (next.has(tier)) next.delete(tier);
  else next.add(tier);
  state = { ...state, tiers: next };
  emit();
}

export function setS2Place(place: string): void {
  state = { ...state, place };
  emit();
}

export function resetS2Filters(): void {
  if (state === DEFAULT_FILTERS) return;
  state = DEFAULT_FILTERS;
  emit();
}

export function subscribeS2Filters(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getS2FiltersSnapshot(): S2Filters {
  return state;
}

export function useS2Filters(): S2Filters {
  return useSyncExternalStore(subscribeS2Filters, getS2FiltersSnapshot, getS2FiltersSnapshot);
}
