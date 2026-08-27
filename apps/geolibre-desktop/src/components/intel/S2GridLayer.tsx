import type { MapController } from "@geolibre/map";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { useIntelResource } from "../../hooks/useIntelResource";
import { fetchS2Map } from "../../lib/intel/client";
import type { S2Cell, S2MapData, S2Point, S2Tier } from "../../lib/intel/s2-contracts";
import { useS2Filters } from "../../lib/intel/s2-filters";
import { tierLabel } from "../../lib/intel/severity";

const CELL_SOURCE_ID = "__geoint_s2_cells";
const CELL_FILL_LAYER_ID = "__geoint_s2_cells_fill";
const CELL_LINE_LAYER_ID = "__geoint_s2_cells_line";
const POINT_SOURCE_ID = "__geoint_s2_points";
const POINT_HALO_LAYER_ID = "__geoint_s2_points_halo";
const POINT_LAYER_ID = "__geoint_s2_points_circle";

/**
 * S2 Grid's map choropleth: severity-coloured cell polygons plus per-location
 * points, drawn directly onto the one shared map instance -- same precedent
 * as `ChatMapPlayback.tsx` (raw MapLibre sources/layers via `mapControllerRef`,
 * never a second map). Unlike that component this has no animated sequence to
 * drive: it is a static (for now, fixture-backed) reactive layer that redraws
 * whenever `fetchS2Map`'s data changes, plus a click handler for a plain
 * MapLibre `Popup` -- no cross-panel selection state yet. Wiring this into the
 * Selection/Location/Event mode split `S2MetricsPanel`'s legacy counterpart
 * had is deferred; see docs/MAP_ANIMATION... sibling doc, S2_GRID.md section
 * 5.3, for that follow-up.
 *
 * Non-visual (returns null). Unlike `ChatMapPlayback` (always mounted --
 * a chat sequence is rare and self-clears to nothing to draw), this is only
 * mounted in `DesktopShell.tsx` while the analyst has the S2 Grid dock panel
 * open (`IntelRail`'s toggle, `ui.intel.openPanels`) -- an always-on global
 * choropleth would wash every other surface (chat's path/markers, comment
 * pins, the basemap itself) in translucent severity polygons even while the
 * analyst is looking at an unrelated panel, which is wrong for an overlay
 * that is specifically "what S2 Grid is showing you right now." Mounting
 * only while the panel is open also means unmounting is the layer's own
 * cleanup path (see the unmount effect below), not a separate concern.
 */
export function S2GridLayer({
  mapControllerRef,
  mapReadyGeneration,
}: {
  mapControllerRef: RefObject<MapController | null>;
  /**
   * Bumped by `DesktopShell` whenever the map controller (re)initializes --
   * see `useNetcdfIdentify`/`useCogSpectralIdentify` for the same pattern.
   * Required here, unlike `ChatMapPlayback`: that component's trigger
   * (a chat message landing) only ever fires long after the map is already
   * up, so it never needs to react to the controller becoming ready. This
   * one's trigger is `fetchS2Map`'s ~450ms fixture delay on mount, which can
   * easily resolve *before* the map finishes initializing -- without this,
   * that race left the layer silently never drawn (mapControllerRef is a
   * stable ref identity, so a bare `[mapControllerRef, s2.data]` dependency
   * list does not rerun once the controller shows up later).
   */
  mapReadyGeneration: number;
}): null {
  const filters = useS2Filters();
  const s2 = useIntelResource(() => fetchS2Map(filters), [filters]);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Re-assert the sources/layers on every style reload (a basemap switch wipes
  // them) and whenever fresh data arrives. Re-creating an already-present
  // source/layer is a no-op, matching `ChatMapPlayback`'s `ensurePathLayer`.
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map || !s2.data) return;
    const data = s2.data;
    const ensure = () => safely(() => ensureLayers(map, data));
    ensure();
    map.on("styledata", ensure);
    return () => {
      map.off("styledata", ensure);
    };
  }, [mapControllerRef, s2.data, mapReadyGeneration]);

  // Hover cursor + click-to-inspect popup, wired once per map instance (not
  // per data refresh -- the layers themselves are what changes, not this
  // interactivity).
  useEffect(() => {
    const map = mapControllerRef.current?.getMap() ?? null;
    if (!map) return;

    const setPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = "";
    };
    const onCellClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;
      showPopup(map, popupRef, [event.lngLat.lng, event.lngLat.lat], cellPopupHtml(feature.properties));
    };
    const onPointClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      showPopup(map, popupRef, [lng, lat], pointPopupHtml(feature.properties));
    };

    map.on("mouseenter", CELL_FILL_LAYER_ID, setPointer);
    map.on("mouseleave", CELL_FILL_LAYER_ID, clearPointer);
    map.on("click", CELL_FILL_LAYER_ID, onCellClick);
    map.on("mouseenter", POINT_LAYER_ID, setPointer);
    map.on("mouseleave", POINT_LAYER_ID, clearPointer);
    map.on("click", POINT_LAYER_ID, onPointClick);

    return () => {
      map.off("mouseenter", CELL_FILL_LAYER_ID, setPointer);
      map.off("mouseleave", CELL_FILL_LAYER_ID, clearPointer);
      map.off("click", CELL_FILL_LAYER_ID, onCellClick);
      map.off("mouseenter", POINT_LAYER_ID, setPointer);
      map.off("mouseleave", POINT_LAYER_ID, clearPointer);
      map.off("click", POINT_LAYER_ID, onPointClick);
    };
  }, [mapControllerRef, mapReadyGeneration]);

  // Remove everything on unmount, so the layer does not outlive a console reload.
  useEffect(
    () => () => {
      popupRef.current?.remove();
      safely(() => clearAll(mapControllerRef.current?.getMap() ?? null));
    },
    [mapControllerRef],
  );

  return null;
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[GeoInt] S2 grid layer error", error);
    }
  }
}

/**
 * `S2Cell.poly` is `[lat, lng]` pairs, per the doc it mirrors (see
 * `s2-contracts.ts`'s module docstring) -- GeoJSON/MapLibre require
 * `[lng, lat]`, and a polygon ring must close (first vertex repeated last).
 * This is the one place that conversion happens.
 */
function polyToRing(poly: readonly [number, number][]): [number, number][] {
  const ring = poly.map(([lat, lng]): [number, number] => [lng, lat]);
  const [firstLng, firstLat] = ring[0] ?? [0, 0];
  const [lastLng, lastLat] = ring[ring.length - 1] ?? [0, 0];
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat]);
  return ring;
}

function cellsToFeatureCollection(cells: readonly S2Cell[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => ({
      type: "Feature" as const,
      // `token` doubles as the popup/inspection key; not used for MapLibre's
      // own numeric `feature-state` id (S2 tokens are hex strings).
      properties: {
        token: cell.token,
        tier: cell.tier,
        sev: cell.sev,
        n: cell.n,
        nLoc: cell.nLoc,
        growth: cell.growth,
        growing: cell.growing,
      },
      geometry: { type: "Polygon" as const, coordinates: [polyToRing(cell.poly)] },
    })),
  };
}

function pointsToFeatureCollection(points: readonly S2Point[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point) => ({
      type: "Feature" as const,
      properties: {
        place: point.place,
        tier: point.tier,
        n: point.n,
        sev: point.sev,
        sevMax: point.sevMax,
        mentions: point.mentions,
        tone: point.tone,
        growing: point.growing,
        growth: point.growth,
      },
      geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
    })),
  };
}

/**
 * Colour resolution reads the live computed `--muted-foreground`/
 * `--status-warning`/`--status-critical` values off `document.documentElement`
 * rather than hardcoding hex -- MapLibre paint values are plain style-spec
 * literals, not real CSS, so a `hsl(var(--x))` string would not resolve the
 * way it does in a stylesheet; this reads the *computed* value once and feeds
 * MapLibre a literal `hsl(h, s%, l%)` string instead. Mirrors `intel-tier-*`'s
 * token choices in index.css exactly, so the map and every chip/panel using
 * those utilities agree.
 */
function resolveTierColor(cssVar: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  // Custom properties here are stored as "H S% L%" (Tailwind/shadcn HSL
  // triplet convention, unitless H) -- reassemble into a real hsl() function.
  return raw ? `hsl(${raw.replace(/\s+/g, " ")})` : "#888888";
}

function tierColorExpression(): ExpressionSpecification {
  const colors: Record<S2Tier, string> = {
    green: resolveTierColor("--muted-foreground"),
    yellow: resolveTierColor("--status-warning"),
    red: resolveTierColor("--status-critical"),
  };
  return ["match", ["get", "tier"], "green", colors.green, "yellow", colors.yellow, "red", colors.red, colors.green];
}

function ensureLayers(map: MapLibreMap, data: S2MapData): void {
  const cellData = cellsToFeatureCollection(data.cells);
  const pointData = pointsToFeatureCollection(data.points);

  const cellSource = map.getSource(CELL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (cellSource) {
    cellSource.setData(cellData);
  } else {
    map.addSource(CELL_SOURCE_ID, { type: "geojson", data: cellData });
  }
  const pointSource = map.getSource(POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (pointSource) {
    pointSource.setData(pointData);
  } else {
    map.addSource(POINT_SOURCE_ID, { type: "geojson", data: pointData });
  }

  const tierColor = tierColorExpression();

  if (!map.getLayer(CELL_FILL_LAYER_ID)) {
    map.addLayer({
      id: CELL_FILL_LAYER_ID,
      type: "fill",
      source: CELL_SOURCE_ID,
      paint: {
        "fill-color": tierColor,
        // Growing cells read as a slightly denser wash, not a separate
        // colour -- tier already owns colour, growth owns intensity.
        "fill-opacity": ["case", ["get", "growing"], 0.5, 0.32],
      },
    });
  }
  if (!map.getLayer(CELL_LINE_LAYER_ID)) {
    map.addLayer({
      id: CELL_LINE_LAYER_ID,
      type: "line",
      source: CELL_SOURCE_ID,
      paint: {
        "line-color": tierColor,
        "line-width": ["case", ["get", "growing"], 2.2, 1],
        "line-opacity": 0.85,
      },
    });
  }
  // Halo first so the real point layer draws on top of it (S2_GRID.md
  // section 5.2's "Growth Halo": a soft ring under a growing location's dot).
  if (!map.getLayer(POINT_HALO_LAYER_ID)) {
    map.addLayer({
      id: POINT_HALO_LAYER_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      filter: ["==", ["get", "growing"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "n"], 20, 14, 250, 26],
        "circle-color": tierColor,
        "circle-opacity": 0.22,
        "circle-blur": 0.6,
      },
    });
  }
  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "n"], 20, 4, 250, 11],
        "circle-color": tierColor,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.9,
      },
    });
  }
}

function clearAll(map: MapLibreMap | null): void {
  if (!map) return;
  for (const layerId of [POINT_LAYER_ID, POINT_HALO_LAYER_ID, CELL_LINE_LAYER_ID, CELL_FILL_LAYER_ID]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [POINT_SOURCE_ID, CELL_SOURCE_ID]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function showPopup(
  map: MapLibreMap,
  popupRef: RefObject<maplibregl.Popup | null>,
  lngLat: [number, number],
  html: string,
): void {
  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
}

/** Built with string concatenation of already-escaped/typed values only -- no
 * untrusted user text reaches this (unlike `ChatMapPlayback`'s item titles,
 * every field here is fixture/backend-numeric or a closed tier enum), so a
 * `Popup.setHTML` is safe here without the DOM-API construction that
 * component uses for actual retrieved content. */
function cellPopupHtml(properties: Record<string, unknown> | null): string {
  const p = properties ?? {};
  const tier = String(p.tier ?? "green") as S2Tier;
  return [
    `<div style="font:12px system-ui;min-width:180px">`,
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(String(p.token ?? ""))}</div>`,
    `<div>Tier: ${escapeHtml(tierLabel(tier))}</div>`,
    `<div>Events: ${escapeHtml(String(p.n ?? 0))} · Locations: ${escapeHtml(String(p.nLoc ?? 0))}</div>`,
    `<div>Severity score: ${escapeHtml(Number(p.sev ?? 0).toFixed(2))}</div>`,
    p.growing ? `<div>Growing (media attention accelerating)</div>` : "",
    `</div>`,
  ].join("");
}

function pointPopupHtml(properties: Record<string, unknown> | null): string {
  const p = properties ?? {};
  const tier = String(p.tier ?? "green") as S2Tier;
  return [
    `<div style="font:12px system-ui;min-width:180px">`,
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(String(p.place ?? ""))}</div>`,
    `<div>Tier: ${escapeHtml(tierLabel(tier))}</div>`,
    `<div>Events: ${escapeHtml(String(p.n ?? 0))} · Mentions: ${escapeHtml(String(p.mentions ?? 0))}</div>`,
    `<div>Tone: ${escapeHtml(Number(p.tone ?? 0).toFixed(1))}</div>`,
    p.growing ? `<div>Growing (media attention accelerating)</div>` : "",
    `</div>`,
  ].join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
