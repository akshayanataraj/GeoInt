/**
 * Tests for the radius-ratio geodesy helpers now that Earth is the only body.
 *
 * Upstream GeoLibre supported twelve celestial bodies, and these helpers existed
 * because Turf.js hardcodes Earth's radius with no per-call override
 * (GeoLibre#1128): every distance Turf returned had to be scaled by the active
 * body's radius ratio, and every distance handed to it pre-scaled. This product
 * removed the non-Earth bodies, so the ratio is always 1 and all three
 * conversions are exact no-ops.
 *
 * The helpers were kept rather than ripped out of every call site (see
 * `ellipsoids.ts`), so these tests pin the invariant that matters now: they are
 * *identity*, and nothing can quietly reintroduce a scale factor. The
 * unknown-body case is the one with real teeth -- `setActiveEllipsoidId` is
 * still called with whatever a stored project carries, including a body id from
 * the old build, and it must fall back to Earth rather than produce a zero or
 * NaN radius that would silently corrupt every measurement in the app.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  bodyLengthToEarth,
  EARTH_MEAN_RADIUS_METERS,
  earthAreaToBody,
  earthLengthToBody,
  ELLIPSOIDS,
  getActiveBodyRadiusRatio,
  getEllipsoid,
  meanRadiusMeters,
  setActiveEllipsoidId,
} from "@geolibre/core";

afterEach(() => setActiveEllipsoidId("earth"));

describe("the ellipsoid table", () => {
  it("contains Earth and nothing else", () => {
    assert.deepEqual(
      ELLIPSOIDS.map((e) => e.id),
      ["earth"],
    );
  });

  it("still describes Earth as WGS 84", () => {
    const earth = getEllipsoid("earth");
    assert.equal(earth.semiMajorAxisMeters, 6378137);
    // Oblate, not a sphere -- so the mean radius must come out below the
    // equatorial one, which is what the measurement math depends on.
    assert.ok(meanRadiusMeters(earth) < earth.semiMajorAxisMeters);
    assert.ok(Math.abs(EARTH_MEAN_RADIUS_METERS - 6371008.8) < 1);
  });
});

describe("getActiveBodyRadiusRatio", () => {
  it("is exactly 1 on Earth", () => {
    setActiveEllipsoidId("earth");
    assert.equal(getActiveBodyRadiusRatio(), 1);
  });

  it("falls back to Earth for an unknown body rather than breaking measurement", () => {
    setActiveEllipsoidId("nibiru");
    assert.equal(getActiveBodyRadiusRatio(), 1);
  });

  it("falls back to Earth for a body this build used to support", () => {
    // A project saved by the upstream build can still carry
    // `map.ellipsoidId: "mars"`. That must resolve to Earth rather than to a
    // missing record: the helpers divide by this radius, so a zero would turn
    // every measurement into Infinity.
    for (const removed of ["moon", "mars", "venus", "titan", "charon"]) {
      setActiveEllipsoidId(removed);
      assert.equal(getActiveBodyRadiusRatio(), 1, `${removed} should resolve to Earth`);
    }
  });

  it("is undefined-safe", () => {
    setActiveEllipsoidId(undefined);
    assert.equal(getActiveBodyRadiusRatio(), 1);
  });
});

describe("the length and area conversions", () => {
  it("passes lengths through unchanged in both directions", () => {
    setActiveEllipsoidId("earth");
    assert.equal(earthLengthToBody(3065.81), 3065.81);
    assert.equal(bodyLengthToEarth(5000), 5000);
  });

  it("passes areas through unchanged", () => {
    setActiveEllipsoidId("earth");
    assert.equal(earthAreaToBody(1_000_000), 1_000_000);
  });

  it("round-trips exactly", () => {
    setActiveEllipsoidId("earth");
    assert.equal(earthLengthToBody(bodyLengthToEarth(1234.5)), 1234.5);
  });

  it("stays identity even after a removed body id is set", () => {
    // The path a stale project takes: an unrecognized body must not leave the
    // conversions scaled by anything.
    setActiveEllipsoidId("mars");
    assert.equal(earthLengthToBody(1000), 1000);
    assert.equal(bodyLengthToEarth(1000), 1000);
    assert.equal(earthAreaToBody(1000), 1000);
  });
});
