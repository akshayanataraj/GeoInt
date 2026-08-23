import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, it } from "node:test";
import { v8 } from "@maplibre/maplibre-gl-style-spec";
import { BLEND_MODES, DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "@geolibre/core";
import {
  LAYER_OPACITY_FOR_BLEND,
  blendModeForNativeLayer,
  blendSpecFor,
  isBlending,
  resetLayerBlendModes,
  syncLayerBlendModes,
  type BlendConstants,
  type BlendSpec,
} from "../packages/map/src/layer-blend-modes";
import { fillPaint, linePaint } from "../packages/map/src/style-mapper";

/**
 * Distinguishable stand-ins for the WebGL enums, so a spec assertion names the
 * constant it expects instead of a number nobody can read.
 */
const GL: BlendConstants = {
  ONE: 101,
  DST_COLOR: 103,
  ONE_MINUS_SRC_COLOR: 104,
  ONE_MINUS_SRC_ALPHA: 105,
  FUNC_ADD: 106,
  MAX: 109,
};

/** A premultiplied colour, `[r, g, b, a]`, each channel in 0..1. */
type Rgba = [number, number, number, number];

/** The GL blend factor a {@link BlendConstants} value stands for, per channel. */
function factorFor(constant: number, channel: number, src: Rgba, dst: Rgba): number {
  switch (constant) {
    case GL.ONE:
      return 1;
    case GL.DST_COLOR:
      return dst[channel];
    case GL.ONE_MINUS_SRC_COLOR:
      return 1 - src[channel];
    case GL.ONE_MINUS_SRC_ALPHA:
      return 1 - src[3];
    default:
      throw new Error(`unmodelled blend factor ${constant}`);
  }
}

/**
 * What the GPU writes for one pixel under a {@link BlendSpec}, so the invariants
 * the mode list rests on can be asserted without a WebGL context. Mirrors the
 * fixed-function stage: MIN/MAX ignore the factors, FUNC_ADD applies them, and
 * the result clamps to 0..1.
 */
function simulateBlend(spec: BlendSpec, src: Rgba, dst: Rgba): Rgba {
  const [srcFactor, dstFactor] = spec.func;
  const out = [0, 0, 0, 0].map((_, channel) => {
    if (spec.equation === GL.MAX) return Math.max(src[channel], dst[channel]);
    const s = src[channel] * factorFor(srcFactor, channel, src, dst);
    const d = dst[channel] * factorFor(dstFactor, channel, src, dst);
    return Math.min(1, Math.max(0, s + d));
  });
  return out as Rgba;
}

function layer(id: string, overrides: Partial<GeoLibreLayer> = {}): GeoLibreLayer {
  return {
    id,
    name: id,
    type: "geojson",
    source: {},
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {},
    ...overrides,
  };
}

afterEach(() => resetLayerBlendModes());

describe("blend mode GL specs", () => {
  it("leaves normal (and anything unrecognized) on ordinary compositing", () => {
    assert.equal(blendSpecFor("normal", GL), null);
    assert.equal(blendSpecFor(undefined, GL), null);
    // A project file authored by a newer GeoLibre must render, not throw.
    assert.equal(blendSpecFor("overlay" as never, GL), null);
    assert.equal(isBlending("normal"), false);
    assert.equal(isBlending("multiply"), true);
  });

  it("multiplies as src*dst over the backdrop where the layer is transparent", () => {
    // Premultiplied source: dst*(1-srcA) is what leaves the backdrop intact
    // where the layer contributes nothing, instead of punching a hole in it.
    assert.deepEqual(blendSpecFor("multiply", GL), {
      func: [GL.DST_COLOR, GL.ONE_MINUS_SRC_ALPHA],
      equation: GL.FUNC_ADD,
    });
  });

  it("maps each remaining mode to its fixed-function pair", () => {
    assert.deepEqual(blendSpecFor("screen", GL), {
      func: [GL.ONE, GL.ONE_MINUS_SRC_COLOR],
      equation: GL.FUNC_ADD,
    });
    assert.deepEqual(blendSpecFor("lighten", GL), {
      func: [GL.ONE, GL.ONE],
      equation: GL.MAX,
    });
    assert.deepEqual(blendSpecFor("add", GL), {
      func: [GL.ONE, GL.ONE],
      equation: GL.FUNC_ADD,
    });
  });

  it("leaves the map untouched wherever a blended layer is transparent", () => {
    // The invariant that bounds BLEND_MODES. MapLibre composites a blended fill
    // or line as one quad covering the whole viewport, so a mode that turns a
    // transparent source into anything but "leave the destination alone"
    // repaints the entire map. Checked against real pixels before this was
    // pinned here: a MIN equation (`darken`) erased the basemap to transparent
    // black, and a reverse subtract (`subtract`) left the canvas at dstA - srcA
    // so the page showed through the layer. Both were dropped, and this test is
    // what stops either from being added back.
    const transparent: Rgba = [0, 0, 0, 0];
    const backdrop: Rgba = [0.93, 0.92, 0.84, 1];
    for (const mode of BLEND_MODES) {
      const spec = blendSpecFor(mode, GL);
      if (!spec) continue;
      assert.deepEqual(
        simulateBlend(spec, transparent, backdrop),
        backdrop,
        `${mode} alters the map where the layer contributes nothing`,
      );
    }
  });

  it("keeps the map canvas opaque under every mode", () => {
    // A canvas left below alpha 1 lets the page background bleed through the
    // map, which is how `subtract` failed in the browser.
    const opaqueBackdrop: Rgba = [0.93, 0.92, 0.84, 1];
    for (const halfCovered of [0, 0.5, 1]) {
      const src: Rgba = [0.1 * halfCovered, 0.3 * halfCovered, 0.6 * halfCovered, halfCovered];
      for (const mode of BLEND_MODES) {
        const spec = blendSpecFor(mode, GL);
        if (!spec) continue;
        assert.equal(
          simulateBlend(spec, src, opaqueBackdrop)[3],
          1,
          `${mode} at srcAlpha ${halfCovered} left the canvas translucent`,
        );
      }
    }
  });

  it("resolves every mode the UI offers", () => {
    // BLEND_MODES drives the Style panel's options, so a mode added there
    // without a GL spec would render as a silently inert menu entry.
    for (const mode of BLEND_MODES) {
      assert.equal(
        isBlending(mode),
        mode !== "normal",
        `${mode} has no GL spec but is offered in the UI`,
      );
    }
  });
});

describe("the native style-layer registry", () => {
  it("covers a layer's generated sub-layers by prefix", () => {
    syncLayerBlendModes([
      layer("abc", { style: { ...DEFAULT_LAYER_STYLE, blendMode: "multiply" } }),
    ]);
    for (const role of ["fill", "line", "circle", "extrusion", "generator-fill", "inverted-fill"]) {
      assert.equal(blendModeForNativeLayer(`layer-abc-${role}`), "multiply", role);
    }
  });

  it("keeps labels and cluster counts on ordinary compositing", () => {
    syncLayerBlendModes([
      layer("abc", { style: { ...DEFAULT_LAYER_STYLE, blendMode: "multiply" } }),
    ]);
    // Text multiplied into a dark hillshade is text you cannot read.
    assert.equal(blendModeForNativeLayer("layer-abc-text"), null);
    assert.equal(blendModeForNativeLayer("layer-abc-label"), null);
    assert.equal(blendModeForNativeLayer("layer-abc-cluster-count"), null);
    // Icon markers are symbology, not chrome, so they do blend.
    assert.equal(blendModeForNativeLayer("layer-abc-marker"), "multiply");
  });

  it("covers a single-native-layer raster named for the store layer itself", () => {
    syncLayerBlendModes([
      layer("dem", { type: "raster", style: { ...DEFAULT_LAYER_STYLE, blendMode: "screen" } }),
    ]);
    assert.equal(blendModeForNativeLayer("dem"), "screen");
  });

  it("covers the native ids a plugin-managed layer declares", () => {
    syncLayerBlendModes([
      layer("ext", {
        metadata: { nativeLayerIds: ["vector-ctrl-fill", "vector-ctrl-line"] },
        style: { ...DEFAULT_LAYER_STYLE, blendMode: "lighten" },
      }),
    ]);
    assert.equal(blendModeForNativeLayer("vector-ctrl-fill"), "lighten");
    assert.equal(blendModeForNativeLayer("vector-ctrl-line"), "lighten");
    // Declaring native ids replaces the store-id fallback rather than adding to it.
    assert.equal(blendModeForNativeLayer("ext"), null);
  });

  it("ignores layers left on normal", () => {
    syncLayerBlendModes([layer("plain")]);
    assert.equal(blendModeForNativeLayer("layer-plain-fill"), null);
  });

  it("reports whether a sync actually changed anything", () => {
    const blended = layer("abc", { style: { ...DEFAULT_LAYER_STYLE, blendMode: "multiply" } });
    assert.equal(syncLayerBlendModes([blended]), true);
    // A repaint per store change regardless of the mode would be wasteful, so
    // an unchanged pass has to report false.
    assert.equal(syncLayerBlendModes([blended]), false);
    assert.equal(
      syncLayerBlendModes([
        layer("abc", { style: { ...DEFAULT_LAYER_STYLE, blendMode: "screen" } }),
      ]),
      true,
    );
    assert.equal(syncLayerBlendModes([layer("abc")]), true);
    assert.equal(blendModeForNativeLayer("layer-abc-fill"), null);
  });

  it("drops a layer's registration when it leaves the map", () => {
    syncLayerBlendModes([
      layer("abc", { style: { ...DEFAULT_LAYER_STYLE, blendMode: "multiply" } }),
    ]);
    syncLayerBlendModes([]);
    assert.equal(blendModeForNativeLayer("layer-abc-fill"), null);
  });
});

describe("electing MapLibre's layer-opacity composite", () => {
  it("pins fill and line layer-opacity just under 1 while blending", () => {
    const style = { ...DEFAULT_LAYER_STYLE, blendMode: "multiply" as const };
    assert.equal(fillPaint(style, 1)["fill-layer-opacity"], LAYER_OPACITY_FOR_BLEND);
    assert.equal(linePaint(style, 1)["line-layer-opacity"], LAYER_OPACITY_FOR_BLEND);
    assert.ok(LAYER_OPACITY_FOR_BLEND < 1, "a value of 1 would not elect the composite path");
  });

  it("restores layer-opacity to 1 when the mode is cleared", () => {
    // `ensureLayer` only writes the paint keys it is handed, so the property
    // has to be emitted unconditionally or clearing a mode would leave the
    // layer stuck on the render-to-texture path.
    assert.equal(fillPaint(DEFAULT_LAYER_STYLE, 1)["fill-layer-opacity"], 1);
    assert.equal(linePaint(DEFAULT_LAYER_STYLE, 1)["line-layer-opacity"], 1);
  });
});

/**
 * `layer-blend-modes` drives three unexported `maplibre-gl` internals. The
 * runtime feature detection in `installLayerBlendModes` keeps a bump from
 * *breaking* the map, but it fails quietly — blending simply stops working.
 * These assertions are what makes the drift loud at bump time instead.
 */
describe("the maplibre-gl render-seam mirror", () => {
  it("still spells the paint properties that elect the composite path", () => {
    assert.ok(
      v8.paint_fill["fill-layer-opacity"],
      "maplibre-gl-style-spec dropped fill-layer-opacity; blended fills would render per polygon",
    );
    assert.ok(
      v8.paint_line["line-layer-opacity"],
      "maplibre-gl-style-spec dropped line-layer-opacity; blended lines would render per segment",
    );
  });

  it("still ships the painter and context methods the wrappers replace", () => {
    // The classes are module-private and need a live WebGL context to build,
    // which node has none of, so the shipped bundle is read directly. Minified
    // output preserves method names, so a rename shows up here.
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"), "utf8");
    for (const seam of [
      "renderLayer",
      "useProgram",
      "setColorMode",
      "blendFunc",
      "blendEquation",
    ]) {
      assert.ok(
        bundle.includes(seam),
        `maplibre-gl no longer mentions "${seam}"; packages/map/src/layer-blend-modes.ts needs revisiting`,
      );
    }
    // The program name the render-to-texture composite is drawn with, which is
    // how the wrapper tells the composite from the draws feeding it.
    assert.ok(
      bundle.includes("layerOpacity"),
      'maplibre-gl no longer names its "layerOpacity" composite program',
    );
  });
});
