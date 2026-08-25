import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLANETARY_BASEMAP_SENTINEL_PREFIX,
  PLANETARY_BASEMAPS,
} from "../packages/core/src/ellipsoids";
import {
  getRegionalBasemapById,
  getRegionalBasemapByStyleUrl,
  INDIA_BASEMAPS,
  isRegionalBasemapSentinel,
  REGIONAL_BASEMAP_GROUPS,
  REGIONAL_BASEMAP_SENTINEL_PREFIX,
  REGIONAL_BASEMAPS,
} from "../packages/core/src/regional-basemaps";

describe("regional basemap catalog invariants", () => {
  it("basemap ids are unique", () => {
    const ids = REGIONAL_BASEMAPS.map((basemap) => basemap.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every basemap's styleUrl is its id under the regional sentinel prefix", () => {
    for (const basemap of REGIONAL_BASEMAPS) {
      assert.equal(basemap.styleUrl, `${REGIONAL_BASEMAP_SENTINEL_PREFIX}${basemap.id}`);
      assert.ok(isRegionalBasemapSentinel(basemap.styleUrl));
    }
  });

  it("every tile template carries the {z}/{x}/{y} placeholders MapLibre substitutes", () => {
    for (const basemap of REGIONAL_BASEMAPS) {
      for (const template of [basemap.tileUrl, basemap.overlayTileUrl].filter(Boolean)) {
        for (const placeholder of ["{z}", "{x}", "{y}"]) {
          assert.ok(
            template?.includes(placeholder),
            `${basemap.id} tile template is missing ${placeholder}`,
          );
        }
      }
    }
  });

  it("serves every basemap over https, so the desktop CSP and the web build accept it", () => {
    for (const basemap of REGIONAL_BASEMAPS) {
      assert.ok(basemap.tileUrl.startsWith("https://"), `${basemap.id} is not https`);
    }
  });

  // A regional basemap must never collide with the planetary sentinel: the
  // planetary path also switches the project's celestial body, which would
  // reproject measurements onto the wrong radius for an Earth basemap.
  it("uses a sentinel prefix distinct from the planetary one", () => {
    assert.notEqual(REGIONAL_BASEMAP_SENTINEL_PREFIX, PLANETARY_BASEMAP_SENTINEL_PREFIX);
    for (const basemap of REGIONAL_BASEMAPS) {
      assert.ok(!basemap.styleUrl.startsWith(PLANETARY_BASEMAP_SENTINEL_PREFIX));
    }
    const planetaryIds = new Set(PLANETARY_BASEMAPS.map((basemap) => basemap.id));
    for (const basemap of REGIONAL_BASEMAPS) {
      assert.ok(
        !planetaryIds.has(basemap.id),
        `${basemap.id} collides with a planetary basemap id`,
      );
    }
  });

  it("resolves a basemap by style URL and by id, and rejects an unknown one", () => {
    const street = getRegionalBasemapById("google-roadmap");
    assert.equal(street?.name, "Google Maps");
    assert.equal(getRegionalBasemapByStyleUrl(street?.styleUrl)?.id, "google-roadmap");

    // An unresolvable sentinel (e.g. a project saved with an id since renamed)
    // still reads as a sentinel, so the map controller falls back to the
    // default basemap rather than fetching `geolibre://` as a URL.
    const stale = `${REGIONAL_BASEMAP_SENTINEL_PREFIX}gone`;
    assert.equal(getRegionalBasemapByStyleUrl(stale), undefined);
    assert.ok(isRegionalBasemapSentinel(stale));
    assert.ok(!isRegionalBasemapSentinel("https://tiles.openfreemap.org/styles/liberty"));
    assert.equal(getRegionalBasemapByStyleUrl(undefined), undefined);
    assert.equal(getRegionalBasemapById(undefined), undefined);
  });
});

describe("India basemaps", () => {
  it("groups every India basemap under the india region", () => {
    assert.ok(INDIA_BASEMAPS.length > 0);
    for (const basemap of INDIA_BASEMAPS) {
      assert.equal(basemap.region, "india");
    }
  });

  it("credits Google Maps on every basemap", () => {
    for (const basemap of INDIA_BASEMAPS) {
      assert.ok(basemap.attribution.includes("Google Maps"), `${basemap.id} is missing its credit`);
    }
  });
});

describe("REGIONAL_BASEMAP_GROUPS (picker section)", () => {
  it("covers every regional basemap exactly once", () => {
    const grouped = REGIONAL_BASEMAP_GROUPS.flatMap((group) => group.basemaps.map((b) => b.id));
    assert.deepEqual([...grouped].sort(), [...REGIONAL_BASEMAPS.map((b) => b.id)].sort());
    assert.equal(new Set(grouped).size, grouped.length);
  });

  it("puts every basemap in the group matching its own region", () => {
    for (const group of REGIONAL_BASEMAP_GROUPS) {
      for (const basemap of group.basemaps) {
        assert.equal(basemap.region, group.id);
      }
    }
  });
});
