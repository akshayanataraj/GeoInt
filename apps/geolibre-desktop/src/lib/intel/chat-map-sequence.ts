/**
 * Tiny external store carrying the "currently playing" chat map sequence from
 * `IntelChatPanel` to `ChatMapPlayback`.
 *
 * The two are not parent/child: the chat panel is portaled into GeoLibre's
 * Style rail (see `useRegisterAnalystChatPanel`), while the playback overlay
 * mounts beside the map in `DesktopShell`, entirely elsewhere in the render
 * tree. A module-level store with `useSyncExternalStore` avoids needing a
 * context provider placed above both, which is the same reasoning
 * `@geolibre/plugins`' right-panel registry uses (see `useRightPanels.ts`) --
 * this just mirrors that idiom at the app layer instead of adding a new one.
 *
 * Deliberately not part of `@geolibre/core`'s store: `ChatMapLocation` is this
 * app's own provisional concept (see `map-events-contract.ts`), not a
 * GeoLibre project/domain type, and this state is never saved, never undone,
 * and reset on every new turn -- it has nothing in common with the project
 * state that store owns.
 *
 * The playback is a small state machine, not just "which index is active":
 *
 * ```
 * idle --(setChatMapSequence)--> revealing(loc 0) -- items reveal one at a
 *   time --> merging(loc 0) --> revealing(loc 1) --> ... --> merging(loc N-1)
 *   --> overview
 * ```
 *
 * `revealing` shows the active location's items fading in one by one;
 * `merging` is the brief transition where they collapse into one badge;
 * `overview` is the resting state once every location has been visited --
 * the camera has zoomed out to fit all of them, each showing its merged
 * badge, and `expandedLocationIds` tracks which ones the user has clicked
 * open to read their full item list. There is deliberately no auto-return to
 * `idle`: overview is where a finished sequence sits until the next question.
 */

import { useSyncExternalStore } from "react";
import type { ChatMapLocation } from "./map-events-contract";

export type PlaybackPhase = "idle" | "revealing" | "merging" | "overview";

export interface ChatMapSequenceState {
  locations: readonly ChatMapLocation[];
  /** Index into `locations`, or -1 before the first one starts. */
  activeLocationIndex: number;
  /** How many of the active location's items are shown, 0..items.length. */
  revealedItemCount: number;
  phase: PlaybackPhase;
  /** Locations the user has clicked open in the overview to read in full. */
  expandedLocationIds: ReadonlySet<string>;
}

const EMPTY_STATE: ChatMapSequenceState = {
  locations: [],
  activeLocationIndex: -1,
  revealedItemCount: 0,
  phase: "idle",
  expandedLocationIds: new Set(),
};

let state: ChatMapSequenceState = EMPTY_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<ChatMapSequenceState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Start a new sequence, replacing whatever was playing. */
export function setChatMapSequence(locations: readonly ChatMapLocation[]): void {
  state = { ...EMPTY_STATE, locations, expandedLocationIds: new Set() };
  emit();
}

/** Move to a location and begin revealing its items from the start. */
export function advanceToLocation(index: number): void {
  if (index < 0 || index >= state.locations.length) return;
  set({ activeLocationIndex: index, revealedItemCount: 0, phase: "revealing" });
}

/** Reveal one more of the active location's items. */
export function revealNextItem(): void {
  const location = state.locations[state.activeLocationIndex];
  if (!location) return;
  set({ revealedItemCount: Math.min(location.items.length, state.revealedItemCount + 1) });
}

/** Begin the current location's collapse-into-one-badge transition. */
export function beginMerge(): void {
  if (state.activeLocationIndex < 0) return;
  set({ phase: "merging" });
}

/** All locations visited: rest in the zoomed-out, all-merged overview. */
export function finishToOverview(): void {
  set({ phase: "overview" });
}

/** Toggle whether a location's full item list is expanded in the overview. */
export function toggleLocationExpanded(id: string): void {
  const next = new Set(state.expandedLocationIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set({ expandedLocationIds: next });
}

export function clearChatMapSequence(): void {
  if (state === EMPTY_STATE) return;
  state = EMPTY_STATE;
  emit();
}

export function subscribeChatMapSequence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatMapSequenceSnapshot(): ChatMapSequenceState {
  return state;
}

export function useChatMapSequence(): ChatMapSequenceState {
  return useSyncExternalStore(
    subscribeChatMapSequence,
    getChatMapSequenceSnapshot,
    getChatMapSequenceSnapshot,
  );
}
