import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import {
  toggleLocationExpanded,
  useChatMapSequence,
  type ChatMapSequenceState,
} from "../../lib/intel/chat-map-sequence";
import type {
  ChatMapLocation,
  ChatMediaItem,
  EventSeverity,
} from "../../lib/intel/map-events-contract";

const PATH_SOURCE_ID = "__geoint_chat_events_path";
const PATH_LAYER_ID = "__geoint_chat_events_path_line";
const PATH_GLOW_LAYER_ID = "__geoint_chat_events_path_glow";
// Vivid orange rather than a plain red: the severity dots/badges already use
// red for "critical" (eventSeverityText), so a red path line would read as
// another severity signal instead of a distinct "this is the travelled
// route" affordance. Orange stays clearly in the same warm/alert family
// without colliding with that meaning.
const PATH_LINE_COLOR = "#ff6a1a";
// The camera's flight duration -- see `animatePathGrowth`'s docstring for why
// the line no longer runs its own timer at all, rather than one tuned to
// match this: it reads the camera's live position every frame, so the line's
// speed *is* the camera's speed, whatever this value is. A too-short value
// (650ms, tried earlier) reads as an abrupt dart rather than a deliberate
// flight, especially once IntelChatPanel's MAP_TIMING dwell was also brought
// down closer to it -- see that constant's docstring for the pairing.
const CAMERA_FLY_MS = 1100;

/**
 * A chat event's severity (`info`/`warning`/`critical`, per the plan's draft
 * `render_map_events` schema) is a different, coarser vocabulary from S2's
 * four-band `routine`/`elevated`/`high`/`critical` scale in `severity.ts` --
 * different domain concept, so it is not reused, but mapped onto the same
 * underlying `--status-*` tokens so the two families of severity colour agree
 * everywhere they are shown.
 */
const EVENT_SEVERITY_TEXT: Readonly<Record<EventSeverity, string>> = {
  info: "intel-sev-elevated",
  warning: "intel-sev-high",
  critical: "intel-sev-critical",
};

function eventSeverityText(severity: EventSeverity | undefined): string {
  return EVENT_SEVERITY_TEXT[severity ?? "info"];
}

/**
 * Animates the map through the analyst chat's location sequence
 * (`chat-map-sequence.ts`):
 *
 * - A small severity-coloured **dot** at every revealed location.
 * - A **card** floating above each revealed location's dot. While a location
 *   is the active one and still `revealing`, its card is a stack of its items
 *   fading in one at a time; once `merging`/passed/in `overview`, the stack
 *   collapses to a single clickable badge; clicking a badge expands it back
 *   to the full item list (`toggleLocationExpanded`), in or out of overview.
 * - A **path** that animates drawing from the previous location to the new
 *   one each time the sequence advances, rather than snapping into place.
 * - Once every location has been visited (`phase === "overview"`), the camera
 *   eases out to fit all of them in view.
 *
 * Non-visual (returns null): every visible thing here is either a
 * `maplibregl.Marker` DOM element or a GeoJSON layer, added directly to the
 * live map via `mapControllerRef`, following the same pattern as
 * `RemoteCursorsOverlay`/`CommentMapOverlay` -- and for the same reason those
 * two use it: a `Marker` tracks the map's pan/zoom/rotate automatically, so a
 * card anchored to a coordinate stays correctly placed without this component
 * having to listen for camera moves and recompute a screen position itself.
 *
 * Markers are rebuilt only when the sequence state actually changes; the path
 * *source*'s existence is re-asserted separately on every `styledata` event
 * (cheap and idempotent) because a basemap switch reloads the style and wipes
 * it, but markers are plain DOM tracked by the map instance, not the style, so
 * they need no such re-assertion -- attaching the marker rebuild to
 * `styledata` too (the previous version's bug) reran it on every tile load,
 * which is a large part of what made the panel feel laggy.
 */
export function ChatMapPlayback({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}): null {
  const sequence = useChatMapSequence();
  const { locations, activeLocationIndex, phase } = sequence;
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // The step the path has actually finished drawing to, so a later effect run
  // can tell "advanced by one" (worth an animated draw) from "jumped to a
  // different step" (snap instead).
  const drawnIndexRef = useRef(-1);
  const cancelDrawRef = useRef(() => {});

  // Rebuild markers when the sequence state changes. Deliberately not on
  // `styledata` -- see the module docstring. Depends on the whole `sequence`
  // snapshot (a new object on every store change, see chat-map-sequence.ts's
  // `set`) rather than its individual fields, since `renderMarkers` reads all
  // of them.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map) return;
    safely(() => renderMarkers(map, sequence, markersRef.current));
  }, [mapControllerRef, sequence]);

  // Re-assert the path layer exists on every style reload (a basemap switch
  // wipes it); re-creating it is a no-op when it is already there.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map) return;
    const ensure = () => safely(() => ensurePathLayer(map));
    ensure();
    map.on("styledata", ensure);
    return () => {
      map.off("styledata", ensure);
    };
  }, [mapControllerRef]);

  // Draw (or snap) the path to the active location, separately from the
  // marker effect so the two can reason about "advanced by one" independently
  // of whatever triggers a marker re-render (e.g. an item revealing).
  //
  // `drawnIndexRef` must advance every time this effect runs, even if there
  // is no map yet to draw on -- it used to be updated only after an
  // `!map.isStyleLoaded()` guard, so a step that landed while the style was
  // still reloading (a basemap `styledata` cycle from panning into new tile
  // territory -- far more frequent on a long, geographically spread sequence
  // than a short one) was silently skipped *and* left `drawnIndexRef` stale.
  // The next successful run would then see `activeLocationIndex` several
  // steps ahead of `drawnIndexRef`, fail the "advanced by one" check, and
  // fall into the snap branch for the *whole* accumulated path at once --
  // exactly "the line doesn't connect during the sequence, it just shows up
  // at the end" for a many-location chat turn. `ensurePathLayer` throwing on
  // a not-yet-loaded style is guarded by `safely()` below (and inside
  // `animatePathGrowth`), so there is no need to gate the whole effect on
  // style readiness to avoid that.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    cancelDrawRef.current();
    const from = drawnIndexRef.current;
    drawnIndexRef.current = activeLocationIndex;
    if (!map) return;
    if (activeLocationIndex === from + 1) {
      cancelDrawRef.current = animatePathGrowth(map, locations, from, activeLocationIndex);
    } else {
      safely(() => {
        ensurePathLayer(map);
        (map.getSource(PATH_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
          pathCollection(locations, activeLocationIndex),
        );
      });
    }
  }, [mapControllerRef, locations, activeLocationIndex]);

  // Fly the camera to the active location while still working through the
  // sequence; once every location is visited, ease out to fit all of them.
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller) return;
    if (phase === "overview") {
      if (locations.length === 0) return;
      const map = controller.getMap();
      if (!map) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const location of locations) bounds.extend([location.lng, location.lat]);
      safely(() => map.fitBounds(bounds, { padding: 72, duration: 1200, maxZoom: 9 }));
      return;
    }
    if (activeLocationIndex < 0) return;
    const location = locations[activeLocationIndex];
    if (!location) return;
    const map = controller.getMap();
    controller.flyTo({
      center: [location.lng, location.lat],
      zoom: 7,
      duration: CAMERA_FLY_MS,
      offset: map ? cardHeadroomOffset(map) : undefined,
    });
  }, [mapControllerRef, locations, activeLocationIndex, phase]);

  // Remove everything on unmount -- the sequence usually ends by sitting in
  // the overview rather than clearing itself (see IntelChatPanel), so this is
  // what actually guarantees the source/layer/markers do not outlive a
  // console reload.
  useEffect(
    () => () => safely(() => clearAll(mapControllerRef.current?.getMap() ?? null, markersRef.current)),
    [mapControllerRef],
  );
  useEffect(() => () => cancelDrawRef.current(), []);

  return null;
}

/**
 * How far below the map container's true vertical center the camera should
 * land a location, in screen pixels, so its card -- anchored *above* the
 * marker (see `renderMarkers`) -- has headroom to grow into instead of
 * clipping off the top of the viewport. A location's card can run to several
 * hundred pixels tall with a full bento grid of items, and centering the
 * marker (the previous behaviour) gave it at most half the container's
 * height to work with regardless of how tall the card actually was.
 *
 * A fraction of the *live* container height rather than a fixed pixel count,
 * so it scales down gracefully on a short/split map panel instead of pushing
 * the marker below the visible area there. Capped so it stops growing once
 * the container is tall enough that centering was never the problem.
 */
function cardHeadroomOffset(map: MapLibreMap): [number, number] {
  const containerHeight = map.getContainer().clientHeight;
  return [0, Math.min(170, containerHeight * 0.22)];
}

/**
 * The geographic point currently sitting at the screen pixel a `flyTo` using
 * {@link cardHeadroomOffset} will ultimately center its destination on. Used
 * by `animatePathGrowth` to track the flight's actual progress -- see that
 * function's docstring for why this, and not `map.getCenter()`, is the right
 * thing to read once the camera's own flyTo carries the same offset.
 */
function effectiveFlightTarget(map: MapLibreMap): [number, number] {
  const [, offsetY] = cardHeadroomOffset(map);
  const container = map.getContainer();
  const { lng, lat } = map.unproject([container.clientWidth / 2, container.clientHeight / 2 + offsetY]);
  return [lng, lat];
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[GeoInt] chat map playback error", error);
    }
  }
}

/**
 * Two stacked line layers, not one: MapLibre has no CSS-style drop-shadow for
 * a line, but its `line-blur` paint property does the same job directly --
 * a wide, blurred, translucent layer underneath a crisp full-opacity core is
 * the standard way to fake a neon "glow" in a MapLibre/Mapbox style, the same
 * technique the India-boundary halo uses (`india-boundary-halo`) minus the
 * blur, since that one wants legibility over a busy basemap rather than a
 * glow effect. Order matters: the glow layer must be added *before* the core
 * line so the core renders on top of it, not the other way around.
 */
function ensurePathLayer(map: MapLibreMap): void {
  if (!map.getSource(PATH_SOURCE_ID)) {
    map.addSource(PATH_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(PATH_GLOW_LAYER_ID)) {
    map.addLayer({
      id: PATH_GLOW_LAYER_ID,
      type: "line",
      source: PATH_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": PATH_LINE_COLOR,
        "line-width": 13,
        "line-blur": 8,
        "line-opacity": 0.6,
      },
    });
  }
  if (!map.getLayer(PATH_LAYER_ID)) {
    map.addLayer({
      id: PATH_LAYER_ID,
      type: "line",
      source: PATH_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": PATH_LINE_COLOR,
        "line-width": 3,
        "line-opacity": 0.95,
      },
    });
  }
}

function lineFeatureCollection(coordinates: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features:
      coordinates.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates },
            },
          ]
        : [],
  };
}

function pathCollection(locations: readonly ChatMapLocation[], upToIndex: number) {
  const visited = locations.slice(0, Math.max(0, upToIndex + 1));
  return lineFeatureCollection(visited.map((location) => [location.lng, location.lat]));
}

/**
 * Grows the path from `fromIndex` (the last step it was already drawn to, -1
 * if nothing yet) to `toIndex`, by anchoring the newest segment's leading
 * endpoint to the point the camera is actually converging on every `move`
 * event, rather than animating it on an independent timer.
 *
 * An earlier version drove this with its own `requestAnimationFrame` loop and
 * duration/easing tuned to *match* `flyTo`'s -- but `flyTo` does not ease
 * linearly between two points: it follows MapLibre's own curved
 * pan-then-zoom flight path (Van Wijk's algorithm), and even a
 * duration-matched, identically-eased independent timer traces a different
 * curve through space, so the line either raced ahead of or lagged behind
 * what was on screen. Reading the camera's live position on every `move`
 * event instead draws the line through the exact point the camera is
 * *actually* at each frame, which is the only way the two cannot drift apart
 * -- they render one pixel from the same source of truth for as long as the
 * flight lasts.
 *
 * That "live position" is `effectiveFlightTarget`, not the simpler
 * `map.getCenter()`: the camera's flyTo carries the same headroom offset
 * `cardHeadroomOffset` gives its own flyTo call (see the camera effect), so
 * `getCenter()` converges on a point *offset* from the destination location,
 * not the location itself. Tracking the offset-adjusted point instead means
 * the line's tip already arrives exactly at `to` by the time the flight
 * actually ends, rather than needing a final corrective jump on `moveend` --
 * `moveend` below still snaps to `to` as a floating-point-drift cleanup, not
 * because there is a real gap left to close.
 *
 * Straight-line interpolation, not great-circle or road-snapped -- correct for
 * "connect these two report locations," wrong for "trace an actual route,"
 * per UI_REPURPOSE_PLAN.md §10's guidance on adapting the route-animation
 * primitives for this case.
 *
 * Returns a canceller; call it to stop early (e.g. a new step arrived before
 * this one finished drawing) without leaking the map listeners.
 */
function animatePathGrowth(
  map: MapLibreMap,
  locations: readonly ChatMapLocation[],
  fromIndex: number,
  toIndex: number,
): () => void {
  safely(() => ensurePathLayer(map));
  const getSource = () => map.getSource(PATH_SOURCE_ID) as GeoJSONSource | undefined;
  const base: [number, number][] = locations
    .slice(0, Math.max(0, fromIndex + 1))
    .map((location) => [location.lng, location.lat]);
  const target = locations[toIndex];
  if (!target || base.length === 0) {
    // No prior point to draw from yet (this is the sequence's first point) --
    // there is no segment to animate, only a single point with no line.
    safely(() => getSource()?.setData(lineFeatureCollection([])));
    return () => {};
  }
  const to: [number, number] = [target.lng, target.lat];

  const detach = () => {
    map.off("move", onMove);
    map.off("moveend", onMoveEnd);
  };
  const onMove = () => {
    const point = effectiveFlightTarget(map);
    safely(() => getSource()?.setData(lineFeatureCollection([...base, point])));
  };
  const onMoveEnd = () => {
    safely(() => getSource()?.setData(lineFeatureCollection([...base, to])));
    detach();
  };
  map.on("move", onMove);
  map.on("moveend", onMoveEnd);
  onMove();
  return detach;
}

/** Whether a location's card is still fading in its items, or already merged. */
type CardMode = "revealing" | "merged";

function cardModeFor(index: number, sequence: ChatMapSequenceState): CardMode | null {
  const { activeLocationIndex, phase } = sequence;
  if (phase === "overview") return "merged";
  if (index > activeLocationIndex) return null; // not revealed yet
  if (index < activeLocationIndex) return "merged"; // already passed
  return phase === "revealing" ? "revealing" : "merged"; // the active one
}

/**
 * Rebuild the dot and card markers to match the current sequence state.
 * Unvisited locations get only a small dim dot (so the user can see there is
 * more to come); the active one gets a larger pulsing dot; passed/merged
 * locations get a solid severity-coloured dot.
 */
function renderMarkers(
  map: MapLibreMap,
  sequence: ChatMapSequenceState,
  markers: Map<string, maplibregl.Marker>,
): void {
  const { locations } = sequence;
  const liveKeys = new Set<string>();
  locations.forEach((location, index) => {
    liveKeys.add(dotKey(location.id));
    if (cardModeFor(index, sequence) !== null) liveKeys.add(cardKey(location.id));
  });
  for (const [key, marker] of markers) {
    if (!liveKeys.has(key)) {
      marker.remove();
      markers.delete(key);
    }
  }

  locations.forEach((location, index) => {
    const mode = cardModeFor(index, sequence);
    const dotState: DotState =
      sequence.phase !== "overview" && index === sequence.activeLocationIndex
        ? "current"
        : mode !== null
          ? "visited"
          : "pending";
    const lngLat: [number, number] = [location.lng, location.lat];

    let dot = markers.get(dotKey(location.id));
    if (!dot) {
      dot = new maplibregl.Marker({ element: createDotElement(location, dotState) })
        .setLngLat(lngLat)
        .addTo(map);
      markers.set(dotKey(location.id), dot);
    } else {
      dot.setLngLat(lngLat);
      applyDotState(dotInner(dot.getElement()), location, dotState);
    }

    if (mode === null) return;
    let card = markers.get(cardKey(location.id));
    if (!card) {
      card = new maplibregl.Marker({ element: createCardElement(), anchor: "bottom", offset: [0, -14] })
        .setLngLat(lngLat)
        .addTo(map);
      markers.set(cardKey(location.id), card);
    } else {
      card.setLngLat(lngLat);
    }
    applyCardState(cardInner(card.getElement()), location, mode, sequence);
  });
}

function dotKey(id: string): string {
  return `dot:${id}`;
}

function cardKey(id: string): string {
  return `card:${id}`;
}

type DotState = "pending" | "current" | "visited";

/**
 * The element passed to `new maplibregl.Marker({element})` gets its
 * `maplibregl-marker` positioning class added once by MapLibre's own
 * constructor, and MapLibre keeps toggling other classes on it
 * (`maplibregl-marker-covered`, `-draggable`) for as long as it lives. Style
 * functions must never do `el.className = ...` on *that* root -- doing so
 * silently wipes MapLibre's own class and the marker falls out of position,
 * which is what made revealed items appear not to show up at all. So the root
 * here is a bare wrapper touched only once, at creation, and every restyle
 * targets its one child instead -- the same split `CommentMapOverlay` uses for
 * its own pins.
 */
function createDotElement(location: ChatMapLocation, state: DotState): HTMLDivElement {
  const root = document.createElement("div");
  const inner = document.createElement("div");
  root.appendChild(inner);
  applyDotState(inner, location, state);
  return root;
}

function dotInner(root: HTMLElement): HTMLElement {
  return root.firstElementChild as HTMLElement;
}

function applyDotState(el: HTMLElement, location: ChatMapLocation, state: DotState): void {
  // A fixed 10px box growing via `scale` rather than an animated `width`/
  // `height` -- `transition-transform` (already on this element) animates
  // `transform` smoothly for free, but a plain CSS `transition` property list
  // does not cover `width`/`height` unless named explicitly, so the previous
  // literal size swap popped instantly between 10px and 16px. That abrupt pop,
  // right as the card above it appears, is what read as the dot and the card
  // just "switching" rather than one smooth motion.
  el.className = cn(
    "h-2.5 w-2.5 rounded-full border-2 border-background bg-current transition-transform",
    state === "pending" ? "text-muted-foreground/60" : eventSeverityText(location.severity),
    state === "current" && "geoint-pulse scale-[1.6] ring-4 ring-current/25",
  );
}

/** Bare marker root plus the one child every card style function targets -- see `createDotElement`'s docstring for why the root itself must never be restyled. */
function createCardElement(): HTMLDivElement {
  const root = document.createElement("div");
  root.appendChild(document.createElement("div"));
  return root;
}

function cardInner(root: HTMLElement): HTMLElement {
  return root.firstElementChild as HTMLElement;
}

/**
 * Applies the right content for the card's current mode, rebuilding the DOM
 * only when the *mode itself* changes (tracked via `dataset.cardMode`), never
 * on every render. Within `"revealing"` mode, already-shown items are never
 * touched -- `syncRevealingStack` only appends the newly revealed one -- so an
 * item's fade-in plays once and does not replay every time a sibling item
 * joins it, which is what made the previous version feel jumpy.
 */
function applyCardState(
  el: HTMLElement,
  location: ChatMapLocation,
  mode: CardMode,
  sequence: ChatMapSequenceState,
): void {
  const expanded = mode === "merged" && sequence.expandedLocationIds.has(location.id);
  const key = mode === "revealing" ? "revealing" : expanded ? "expanded" : "merged";
  if (el.dataset.cardMode !== key) {
    el.replaceChildren();
    el.dataset.cardMode = key;
    if (key === "revealing") initRevealingStack(el, location);
    else if (key === "expanded") renderExpandedList(el, location);
    else renderMergedBadge(el, location);
  }
  if (key === "revealing") syncRevealingStack(el, location, sequence.revealedItemCount);
}

function initRevealingStack(el: HTMLElement, location: ChatMapLocation): void {
  // `geoint-card-grow`, not the generic `geoint-fade-in`: this is the card's
  // very first appearance at a newly-active location, right above its
  // severity dot, and growing up from that anchor point reads as one
  // continuous motion instead of the dot and an already-full-size rectangle
  // just swapping in with nothing visually connecting them.
  el.className = cn(
    "geoint-card-grow map-glass max-h-[480px] w-[380px] overflow-y-auto rounded-xl border border-l-[3px] border-current/35 p-3 shadow-lg motion-reduce:animate-none",
    eventSeverityText(location.severity),
  );

  const header = document.createElement("div");
  header.className = "intel-hairline flex items-center gap-2 border-b pb-2";
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = cn(
    "h-2.5 w-2.5 shrink-0 rounded-full bg-current ring-4 ring-current/20",
    eventSeverityText(location.severity),
  );
  const label = document.createElement("p");
  label.className = "min-w-0 flex-1 truncate text-sm font-semibold text-foreground";
  label.textContent = location.label;
  header.append(dot, label);
  el.appendChild(header);

  const list = document.createElement("div");
  list.className = "mt-2.5 grid grid-cols-2 gap-2";
  list.dataset.role = "item-list";
  el.appendChild(list);
}

function syncRevealingStack(el: HTMLElement, location: ChatMapLocation, revealedItemCount: number): void {
  const list = el.querySelector<HTMLElement>('[data-role="item-list"]');
  if (!list) return;
  while (list.children.length < revealedItemCount) {
    const index = list.children.length;
    list.appendChild(createItemRow(location.items[index], index, location.items.length));
  }
  while (list.children.length > revealedItemCount) {
    list.lastElementChild?.remove();
  }
}

/**
 * Whether an item's tile spans the full width of its bento grid rather than
 * sharing a row with a neighbour: the first item is always the "headline"
 * tile, and the last item spans too whenever the remaining, non-headline
 * items are an odd count -- otherwise that last tile would sit alone next to
 * an empty grid cell. Deliberately based on the location's *final* item
 * count, not how many are revealed so far, so a tile's span is decided the
 * moment it is created and never has to reflow as its siblings fade in.
 */
function isFeaturedItem(index: number, total: number): boolean {
  if (index === 0) return true;
  return index === total - 1 && total % 2 === 0;
}

/**
 * One item's tile, built with DOM APIs -- `textContent`, never
 * string-interpolated markup -- because this text (title/snippet) is meant to
 * originate from retrieved news/social content once a real backend lands, and
 * that is untrusted input; the same defense-in-depth precedent
 * `CommentMapOverlay` follows for its own user-supplied pin content.
 */
function createItemRow(item: ChatMediaItem, index: number, total: number): HTMLDivElement {
  const featured = isFeaturedItem(index, total);
  const row = document.createElement("div");
  row.className = cn(
    "geoint-fade-in rounded-md border transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm motion-reduce:animate-none motion-reduce:hover:translate-y-0",
    // The featured tile gets its own tinted border instead of `intel-hairline`
    // -- overriding just one side of that utility's border-color is a
    // cascade-order gamble (see index.css's own notes on why map-glass et al.
    // are `@utility` in the first place), so it is simplest not to mix them.
    featured
      ? "col-span-2 border-primary/30 bg-primary/[0.06] p-3 hover:bg-primary/10"
      : "intel-hairline bg-background/40 p-2.5 hover:bg-background/60",
  );

  const kindRow = document.createElement("div");
  kindRow.className = "flex items-center gap-1.5";
  const kind = document.createElement("span");
  kind.className = cn(
    "intel-label rounded-full px-1.5 py-0.5",
    item.kind === "news" ? "bg-primary/15 text-primary" : "bg-accent/40 text-accent-foreground",
  );
  kind.textContent = item.kind === "news" ? "News" : "Social";
  kindRow.appendChild(kind);

  // Only the cited case gets a badge -- every item at a location shows up
  // here regardless of citation status (see `ChatMediaItem.cited`'s
  // docstring), so marking the common case ("just found here, not quoted")
  // would out-badge more tiles than it distinguishes. Cited is the fact
  // worth calling out: it is what the answer's prose actually leaned on.
  if (item.cited) {
    const cited = document.createElement("span");
    cited.className = "intel-label rounded-full bg-status-warning/15 px-1.5 py-0.5 text-status-warning";
    cited.textContent = "Cited";
    kindRow.appendChild(cited);
  }

  const time = document.createElement("span");
  time.className = "intel-numeral ms-auto text-[9px] text-muted-foreground";
  time.textContent = new Date(item.timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  kindRow.appendChild(time);
  row.appendChild(kindRow);

  const title = document.createElement("p");
  title.className = cn(
    "mt-1 font-medium leading-snug text-foreground",
    featured ? "text-[13px]" : "text-[11px]",
  );
  title.textContent = item.title;
  row.appendChild(title);

  if (item.snippet) {
    const snippet = document.createElement("p");
    snippet.className = cn(
      "mt-1 leading-snug text-muted-foreground",
      featured ? "text-[11px] line-clamp-2" : "text-[10px] line-clamp-1",
    );
    snippet.textContent = item.snippet;
    row.appendChild(snippet);
  }

  if (item.sourceUrl) {
    const link = document.createElement("a");
    link.href = item.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className =
      "mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20";
    link.textContent = "Open source ↗";
    link.addEventListener("click", (e) => e.stopPropagation());
    row.appendChild(link);
  }
  return row;
}

/** The compact, clickable "N sources" badge a location settles into after its items merge. */
function renderMergedBadge(el: HTMLElement, location: ChatMapLocation): void {
  el.className = cn(
    "geoint-fade-in intel-hairline map-glass flex max-w-48 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 shadow-md transition-transform hover:scale-105 motion-reduce:animate-none",
  );
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${location.label}: ${location.items.length} sources, click to view`);
  el.onclick = (e) => {
    e.stopPropagation();
    toggleLocationExpanded(location.id);
  };

  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", eventSeverityText(location.severity));
  el.appendChild(dot);

  const label = document.createElement("span");
  label.className = "truncate text-[10px] font-medium text-foreground";
  label.textContent = location.label;
  el.appendChild(label);

  const count = document.createElement("span");
  count.className = "intel-numeral shrink-0 rounded-full bg-primary/15 px-1.5 text-[9px] font-semibold text-primary";
  count.textContent = String(location.items.length);
  el.appendChild(count);
}

/**
 * The full item list a merged badge expands into when clicked.
 *
 * Uses `geoint-sheet-in` rather than the generic `geoint-fade-in` every other
 * mode here uses -- reads more like a panel rising over the map for what is
 * the one moment in this whole sequence a *click* triggers rather than the
 * autoplay timeline, and it happens to matter functionally too: `el` is the
 * same DOM node across a mode change (only its content is rebuilt, see
 * `applyCardState`), and a CSS animation does not replay just because the
 * className string is reassigned unless the animation-name itself changes
 * value -- `renderMergedBadge` also uses `geoint-fade-in`, so collapsing then
 * re-expanding would not have replayed the entrance at all. A distinct name
 * per mode guarantees a real value change every time, which is what actually
 * makes this "click it again after the whole sequence is done and it still
 * animates" rather than a one-time transition.
 */
function renderExpandedList(el: HTMLElement, location: ChatMapLocation): void {
  el.className = cn(
    "geoint-sheet-in map-glass max-h-[480px] w-[420px] cursor-default overflow-y-auto rounded-xl border border-l-[3px] border-current/35 p-3 shadow-lg motion-reduce:animate-none",
    eventSeverityText(location.severity),
  );

  const header = document.createElement("div");
  header.className = "intel-hairline flex items-center justify-between gap-2 border-b pb-2";
  const labelRow = document.createElement("div");
  labelRow.className = "flex min-w-0 flex-1 items-center gap-2";
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = cn(
    "h-2.5 w-2.5 shrink-0 rounded-full bg-current ring-4 ring-current/20",
    eventSeverityText(location.severity),
  );
  const label = document.createElement("p");
  label.className = "min-w-0 flex-1 truncate text-sm font-semibold text-foreground";
  label.textContent = location.label;
  labelRow.append(dot, label);
  header.appendChild(labelRow);

  const close = document.createElement("button");
  close.type = "button";
  close.className =
    "intel-numeral shrink-0 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground";
  close.textContent = "Collapse";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLocationExpanded(location.id);
  });
  header.appendChild(close);
  el.appendChild(header);

  const list = document.createElement("div");
  list.className = "mt-2.5 grid grid-cols-2 gap-2";
  location.items.forEach((item, index) => {
    const row = createItemRow(item, index, location.items.length);
    // A small cascade rather than every tile's `geoint-fade-in` firing on the
    // exact same frame -- this is the one place all of a location's items
    // appear at once (`syncRevealingStack` already staggers naturally, one
    // real fade-in per revealed item over time), so without this the whole
    // grid reads as a single flat "pop" instead of a sequence. `fillMode:
    // "backwards"` matters here, not just polish: without it the delay would
    // leave the tile at its normal (visible) styles until the animation
    // starts, flashing it in early and fading it in a second time.
    row.style.animationDelay = `${Math.min(index, 6) * 35}ms`;
    row.style.animationFillMode = "backwards";
    list.appendChild(row);
  });
  el.appendChild(list);
}

function clearAll(map: MapLibreMap | null, markers: Map<string, maplibregl.Marker>): void {
  for (const marker of markers.values()) marker.remove();
  markers.clear();
  if (map) {
    if (map.getLayer(PATH_LAYER_ID)) map.removeLayer(PATH_LAYER_ID);
    if (map.getLayer(PATH_GLOW_LAYER_ID)) map.removeLayer(PATH_GLOW_LAYER_ID);
    if (map.getSource(PATH_SOURCE_ID)) map.removeSource(PATH_SOURCE_ID);
  }
}
