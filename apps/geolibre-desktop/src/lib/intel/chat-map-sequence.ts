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
 * Deliberately not part of `@geolibre/core`'s store: `ChatMapEvent` is this
 * app's own provisional concept (see `map-events-contract.ts`), not a GeoLibre
 * project/domain type, and this state is never saved, never undone, and reset
 * on every new turn -- it has nothing in common with the project state that
 * store owns.
 */

import { useSyncExternalStore } from "react";
import type { ChatMapEvent } from "./map-events-contract";

export interface ChatMapSequenceState {
  /** The turn's events, in chronological order. Empty when nothing is active. */
  events: readonly ChatMapEvent[];
  /** Index into `events` the map should be centred on, or -1 for "not started". */
  activeIndex: number;
}

const EMPTY_STATE: ChatMapSequenceState = { events: [], activeIndex: -1 };

let state: ChatMapSequenceState = EMPTY_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Start a new sequence, replacing whatever was playing. Resets to step -1. */
export function setChatMapSequence(events: readonly ChatMapEvent[]): void {
  state = { events, activeIndex: events.length > 0 ? -1 : -1 };
  emit();
}

/** Advance (or set) which event the map is centred on. Clamped to the events array. */
export function setChatMapActiveIndex(index: number): void {
  if (state.events.length === 0) return;
  const clamped = Math.max(-1, Math.min(index, state.events.length - 1));
  if (clamped === state.activeIndex) return;
  state = { ...state, activeIndex: clamped };
  emit();
}

/** Clear the sequence entirely (a fresh question, or the chat panel closing). */
export function clearChatMapSequence(): void {
  if (state.events.length === 0 && state.activeIndex === -1) return;
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
