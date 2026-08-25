import type { MapController } from "@geolibre/map";
import { cn } from "@geolibre/ui";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import {
  setChatMapActiveIndex,
  useChatMapSequence,
} from "../../lib/intel/chat-map-sequence";
import type { ChatMapEvent, EventSeverity } from "../../lib/intel/map-events-contract";

const PATH_SOURCE_ID = "__geoint_chat_events_path";
const PATH_LAYER_ID = "__geoint_chat_events_path_line";
const PATH_DRAW_MS = 900;

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
 * Animates the map through the analyst chat's current event sequence:
 *
 * - A small severity-coloured **dot** at every revealed event's coordinate.
 * - A **card** floating above each revealed event's dot -- the current one
 *   expanded (label, time, description, source link), earlier ones shrunk to
 *   a compact clickable chip, so the map fills in with the story's evidence
 *   as it goes rather than only ever showing one card at a time.
 * - A **path** that animates drawing from the previous point to the new one
 *   each time the sequence advances, rather than snapping into place.
 * - Both the dot and the card are clickable: clicking an earlier step jumps
 *   the sequence back to it (`setChatMapActiveIndex`), replaying its camera
 *   move and re-expanding its card.
 *
 * Non-visual (returns null): every visible thing here is either a
 * `maplibregl.Marker` DOM element or a GeoJSON layer, added directly to the
 * live map via `mapControllerRef`, following the same pattern as
 * `RemoteCursorsOverlay`/`CommentMapOverlay` -- and for the same reason those
 * two use it: a `Marker` tracks the map's pan/zoom/rotate automatically, so a
 * card anchored to a coordinate stays correctly placed without this component
 * having to listen for camera moves and recompute a screen position itself.
 *
 * Two different mechanisms for the two moving parts:
 *
 * - **Dots and cards** are plain DOM, styled with the app's own
 *   `intel-sev-*`/`geoint-pulse`/`map-glass` Tailwind utilities (ordinary CSS)
 *   rather than a MapLibre style-spec layer, which cannot reference a CSS
 *   custom property for its colours.
 * - The **path** genuinely is a GeoJSON line layer -- animating a hand-drawn
 *   polyline of DOM elements would be reinventing what MapLibre already does
 *   well. Its one MapLibre-owned colour, `line-color`, is resolved once from
 *   `--primary` into a literal `hsl(...)` the same way `chart-export.ts`
 *   resolves theme colours for its own non-DOM (SVG) rendering context.
 */
export function ChatMapPlayback({
  mapControllerRef,
}: {
  mapControllerRef: RefObject<MapController | null>;
}): null {
  const { events, activeIndex } = useChatMapSequence();
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // The step the path has actually finished drawing to, so a later effect run
  // can tell "advanced by one" (worth an animated draw) from "jumped to a
  // different step" (snap instead -- an animated redraw backwards or across a
  // skip would look like the sequence rewinding, not like progress).
  const drawnIndexRef = useRef(-1);
  // Cancels whichever path-draw animation is currently in flight, so clicking
  // a new step before the previous draw finishes can't leave two animations
  // fighting over the same GeoJSON source.
  const cancelDrawRef = useRef(() => {});

  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map) return;
    const render = () =>
      safely(() => renderMarkers(map, events, activeIndex, markersRef.current));
    render();
    // A basemap switch reloads the style and wipes the path source/layer, so
    // re-create it once the new style is in place. Markers are plain DOM and
    // survive a style reload untouched, but re-running is harmless for them.
    map.on("styledata", render);
    return () => {
      map.off("styledata", render);
    };
  }, [mapControllerRef, events, activeIndex]);

  // Draw (or snap) the path to the active step, separately from the marker
  // effect above so the two can reason about "advanced by one" independently
  // of whatever triggers a marker re-render.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map || !map.isStyleLoaded()) return;
    cancelDrawRef.current();
    const from = drawnIndexRef.current;
    drawnIndexRef.current = activeIndex;
    if (activeIndex === from + 1) {
      cancelDrawRef.current = animatePathGrowth(map, events, from, activeIndex);
    } else {
      safely(() => {
        ensurePathLayer(map);
        (map.getSource(PATH_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
          pathCollection(events, activeIndex),
        );
      });
    }
  }, [mapControllerRef, events, activeIndex]);

  // Fly the camera to the active event. Separate from the effects above so a
  // re-render that only touches markers or the path never re-triggers a
  // camera move.
  useEffect(() => {
    if (activeIndex < 0) return;
    const event = events[activeIndex];
    if (!event) return;
    mapControllerRef.current?.flyTo({
      center: [event.lng, event.lat],
      zoom: 7,
      duration: 1400,
    });
  }, [mapControllerRef, events, activeIndex]);

  // Remove everything on unmount -- the sequence usually ends by sitting on
  // the last event rather than clearing itself (see IntelChatPanel), so this
  // is what actually guarantees the source/layer/markers do not outlive a
  // console reload.
  useEffect(
    () => () => safely(() => clearAll(mapControllerRef.current?.getMap() ?? null, markersRef.current)),
    [mapControllerRef],
  );
  // Separate effect (rather than folded into the one above) purely so the
  // draw-cancellation and the marker teardown are two independent concerns,
  // matching how RemoteCursorsOverlay keeps its own single teardown effect to
  // one job.
  useEffect(() => () => cancelDrawRef.current(), []);

  return null;
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

/** Read a CSS custom property off the document root as an `hsl(...)` string. */
function resolvedHsl(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : "#0ea5e9";
}

function ensurePathLayer(map: MapLibreMap): void {
  if (!map.getSource(PATH_SOURCE_ID)) {
    map.addSource(PATH_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(PATH_LAYER_ID)) {
    map.addLayer({
      id: PATH_LAYER_ID,
      type: "line",
      source: PATH_SOURCE_ID,
      paint: {
        "line-color": resolvedHsl("--primary"),
        "line-width": 2,
        "line-dasharray": [0.2, 1.6],
        "line-opacity": 0.85,
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

function pathCollection(events: readonly ChatMapEvent[], upToIndex: number) {
  const visited = events.slice(0, Math.max(0, upToIndex + 1));
  return lineFeatureCollection(visited.map((event) => [event.lng, event.lat]));
}

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Animates the path from `fromIndex` (the last step it was already drawn to,
 * -1 if nothing yet) to `toIndex`, sliding the newest segment's endpoint from
 * the previous point to the new one over `PATH_DRAW_MS` rather than snapping.
 * Straight-line interpolation, not great-circle or road-snapped -- correct for
 * "connect these two report locations," wrong for "trace an actual route,"
 * per UI_REPURPOSE_PLAN.md §10's guidance on adapting the route-animation
 * primitives for this case.
 *
 * Returns a canceller; call it to stop the animation early (e.g. because a new
 * step arrived before this one finished drawing).
 */
function animatePathGrowth(
  map: MapLibreMap,
  events: readonly ChatMapEvent[],
  fromIndex: number,
  toIndex: number,
): () => void {
  ensurePathLayer(map);
  const getSource = () => map.getSource(PATH_SOURCE_ID) as GeoJSONSource | undefined;
  const base: [number, number][] = events
    .slice(0, Math.max(0, fromIndex + 1))
    .map((event) => [event.lng, event.lat]);
  const target = events[toIndex];
  if (!target) return () => {};
  const to: [number, number] = [target.lng, target.lat];
  const from = base[base.length - 1];
  if (!from) {
    // Nothing to draw from yet (this is the sequence's first point) -- there
    // is no segment to animate, only a single point with no line.
    safely(() => getSource()?.setData(lineFeatureCollection([])));
    return () => {};
  }

  let cancelled = false;
  const startedAt = performance.now();
  const tick = () => {
    if (cancelled) return;
    const t = Math.min(1, (performance.now() - startedAt) / PATH_DRAW_MS);
    safely(() => getSource()?.setData(lineFeatureCollection([...base, lerp(from, to, t)])));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}

type MarkerState = "pending" | "current" | "visited";

/**
 * Rebuild the dot and card markers to match `events`/`activeIndex`. Unvisited
 * events get only a small dim dot (so the user can see there is more to
 * come); visited ones get a solid severity-coloured dot plus a compact,
 * clickable card; the current one gets a larger pulsing dot plus its card
 * expanded to full detail.
 */
function renderMarkers(
  map: MapLibreMap,
  events: readonly ChatMapEvent[],
  activeIndex: number,
  markers: Map<string, maplibregl.Marker>,
): void {
  const liveKeys = new Set<string>();
  events.forEach((event, index) => {
    liveKeys.add(dotKey(event.id));
    if (index <= activeIndex) liveKeys.add(cardKey(event.id));
  });
  for (const [key, marker] of markers) {
    if (!liveKeys.has(key)) {
      marker.remove();
      markers.delete(key);
    }
  }

  const onSelect = (index: number) => setChatMapActiveIndex(index);

  events.forEach((event, index) => {
    const state: MarkerState =
      index === activeIndex ? "current" : index < activeIndex ? "visited" : "pending";
    const lngLat: [number, number] = [event.lng, event.lat];

    let dot = markers.get(dotKey(event.id));
    if (!dot) {
      const el = createDotElement(event, state, () => onSelect(index));
      dot = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      markers.set(dotKey(event.id), dot);
    } else {
      dot.setLngLat(lngLat);
      applyDotState(dot.getElement(), event, state);
    }

    if (index > activeIndex) return; // not revealed yet -- no card
    let card = markers.get(cardKey(event.id));
    const total = events.length;
    if (!card) {
      const el = createCardElement(event, state, index, total, () => onSelect(index));
      card = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -14] })
        .setLngLat(lngLat)
        .addTo(map);
      markers.set(cardKey(event.id), card);
    } else {
      card.setLngLat(lngLat);
      applyCardState(card.getElement(), event, state, index, total);
    }
  });
}

function dotKey(id: string): string {
  return `dot:${id}`;
}

function cardKey(id: string): string {
  return `card:${id}`;
}

function createDotElement(
  event: ChatMapEvent,
  state: MarkerState,
  onClick: () => void,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cursor-pointer";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  applyDotState(el, event, state);
  return el;
}

function applyDotState(el: HTMLElement, event: ChatMapEvent, state: MarkerState): void {
  const size = state === "current" ? 16 : 10;
  // `severityText` (a solid `color`) plus `bg-current` -- the same pairing
  // `S2MetricsPanel`'s severity bar uses -- so the dot renders as a solid
  // filled colour rather than the translucent wash `severityBg` is tuned for.
  el.className = cn(
    "cursor-pointer rounded-full border-2 border-background bg-current transition-transform hover:scale-125",
    state === "pending" ? "text-muted-foreground/60" : eventSeverityText(event.severity),
    state === "current" && "geoint-pulse",
  );
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

/**
 * The floating card above a revealed event's dot: expanded detail for the
 * current step, a compact clickable chip for earlier ones. Built with DOM
 * APIs -- `textContent`, never string-interpolated markup -- because this
 * text (label/description) is meant to originate from retrieved news/social
 * content once a real backend lands, and that is untrusted input; the same
 * defense-in-depth precedent `CommentMapOverlay` follows for its own
 * user-supplied pin content.
 */
function createCardElement(
  event: ChatMapEvent,
  state: MarkerState,
  index: number,
  total: number,
  onClick: () => void,
): HTMLDivElement {
  const el = document.createElement("div");
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  applyCardState(el, event, state, index, total);
  return el;
}

function applyCardState(
  el: HTMLElement,
  event: ChatMapEvent,
  state: MarkerState,
  index: number,
  total: number,
): void {
  el.replaceChildren();
  if (state === "current") {
    renderExpandedCard(el, event, index, total);
  } else {
    renderCompactChip(el, event);
  }
}

function renderExpandedCard(el: HTMLElement, event: ChatMapEvent, index: number, total: number): void {
  el.className =
    "geoint-fade-in intel-hairline map-glass w-64 cursor-pointer rounded-lg border p-2.5 shadow-lg motion-reduce:animate-none";

  const header = document.createElement("div");
  header.className = "flex items-start gap-2";

  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = cn("mt-1 h-2 w-2 shrink-0 rounded-full bg-current", eventSeverityText(event.severity));
  header.appendChild(dot);

  const titleBlock = document.createElement("div");
  titleBlock.className = "min-w-0 flex-1";
  const label = document.createElement("p");
  label.className = "text-xs font-semibold leading-snug text-foreground";
  label.textContent = event.label;
  const time = document.createElement("time");
  time.className = "intel-numeral block text-[10px] text-muted-foreground";
  time.dateTime = event.timestamp;
  time.textContent = formatEventTime(event.timestamp);
  titleBlock.append(label, time);
  header.appendChild(titleBlock);

  const step = document.createElement("span");
  step.className = "intel-numeral shrink-0 text-[10px] text-muted-foreground";
  step.textContent = `${index + 1} / ${total}`;
  header.appendChild(step);
  el.appendChild(header);

  if (event.description) {
    const description = document.createElement("p");
    description.className = "mt-1.5 text-[11px] leading-relaxed text-foreground/90";
    description.textContent = event.description;
    el.appendChild(description);
  }

  if (event.sourceUrl) {
    const link = document.createElement("a");
    link.href = event.sourceUrl;
    link.target = "_blank";
    // `noreferrer` alongside `noopener`: this is a third-party source, so the
    // destination should not receive this console's URL.
    link.rel = "noopener noreferrer";
    link.className = "mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline";
    link.textContent = "Source ↗";
    link.addEventListener("click", (e) => e.stopPropagation());
    el.appendChild(link);
  }
}

function renderCompactChip(el: HTMLElement, event: ChatMapEvent): void {
  el.className = cn(
    "intel-hairline map-glass flex max-w-40 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 shadow transition-transform hover:scale-105",
  );

  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = cn(
    "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
    eventSeverityText(event.severity),
  );
  el.appendChild(dot);

  const label = document.createElement("span");
  label.className = "truncate text-[10px] font-medium text-foreground";
  label.textContent = event.label;
  el.appendChild(label);
}

/**
 * Date and time, unlike `EventFeedPanel`'s time-only formatter: that feed is a
 * recent window where the date is nearly always today, but a chat sequence's
 * events can span several different days (as this fixture's do), so the date
 * is the part that actually distinguishes one step from another.
 */
function formatEventTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clearAll(map: MapLibreMap | null, markers: Map<string, maplibregl.Marker>): void {
  for (const marker of markers.values()) marker.remove();
  markers.clear();
  if (map) {
    if (map.getLayer(PATH_LAYER_ID)) map.removeLayer(PATH_LAYER_ID);
    if (map.getSource(PATH_SOURCE_ID)) map.removeSource(PATH_SOURCE_ID);
  }
}
