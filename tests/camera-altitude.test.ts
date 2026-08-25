/**
 * Tests for the status bar's camera altitude readout (issue #1816).
 *
 * `scaleAltitudeToActiveBody` existed because MapLibre reports altitude against
 * Earth's radius even on a planetary basemap. Earth is the only body this
 * product ships, so the scaling is now identity and what is worth testing is
 * that it stays identity and still rejects the values MapLibre cannot produce.
 *
 * The formatting half is unaffected: the readout still has to switch
 * denomination across the ~7 orders of magnitude between standing on a ridge and
 * viewing the whole globe.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  formatCameraAltitude,
  scaleAltitudeToActiveBody,
  setActiveEllipsoidId,
} from "@geolibre/core";

afterEach(() => setActiveEllipsoidId("earth"));

describe("scaleAltitudeToActiveBody", () => {
  it("passes altitude through unchanged on Earth", () => {
    setActiveEllipsoidId("earth");
    assert.equal(scaleAltitudeToActiveBody(4200), 4200);
  });

  it("stays identity for a body id the old build supported", () => {
    // A project saved before the non-Earth bodies were removed can still set
    // one. It resolves to Earth, so the altitude must come back untouched
    // rather than scaled by a stale radius.
    for (const removed of ["moon", "mars"]) {
      setActiveEllipsoidId(removed);
      assert.equal(scaleAltitudeToActiveBody(10000), 10000, `${removed} should not scale`);
    }
  });

  it("returns null for a value MapLibre could not produce", () => {
    assert.equal(scaleAltitudeToActiveBody(null), null);
    assert.equal(scaleAltitudeToActiveBody(Number.NaN), null);
    assert.equal(scaleAltitudeToActiveBody(Number.POSITIVE_INFINITY), null);
  });
});

describe("formatCameraAltitude", () => {
  it("stays in metres below a kilometre", () => {
    assert.match(formatCameraAltitude(420, "metric"), /^420 m$/);
  });

  it("crosses to kilometres past a kilometre", () => {
    assert.match(formatCameraAltitude(12_742_000, "metric"), /km$/);
  });

  it("uses feet then miles for imperial", () => {
    assert.match(formatCameraAltitude(300, "imperial"), /ft$/);
    assert.match(formatCameraAltitude(50_000, "imperial"), /mi$/);
  });

  it("uses nautical miles for nautical", () => {
    assert.match(formatCameraAltitude(50_000, "nautical"), /nmi$/);
  });

  it("keeps a decimal only while the number is small enough to need one", () => {
    // 1500 m -> 1.5 km reads usefully; 12742 km -> a decimal would be noise.
    assert.match(formatCameraAltitude(1500, "metric"), /1\.5 km/);
    assert.ok(!/\./.test(formatCameraAltitude(12_742_000, "metric")));
  });

  it("agrees with the scale bar about which unit describes this view", () => {
    // Both read from scaleDenomination, so a span that labels the scale bar in
    // km must not label the altitude in m.
    assert.match(formatCameraAltitude(999, "metric"), / m$/);
    assert.match(formatCameraAltitude(1001, "metric"), / km$/);
  });
});
