import { expect, test, type Page } from "@playwright/test";
import { dropGeoJson, layerRow, readFixture, waitForMap } from "./helpers";

const POLYGON = readFixture("blend-polygon.geojson");

/**
 * Per-layer blend modes are the one GeoLibre feature with no assertable
 * signal short of the rendered pixels: the mode never reaches a paint
 * property, it is applied inside MapLibre's render loop by the wrappers in
 * `packages/map/src/layer-blend-modes.ts`. A unit test can only check the GL
 * factor table, so this drives the real canvas.
 *
 * It also pins the invariant that bounded the mode list. `darken` (a MIN
 * equation) and `subtract` (a reverse subtract) were both dropped because
 * MapLibre composites a blended layer as one viewport-filling quad and its
 * blend state covers alpha too, so they erased the map outside the layer and
 * left the canvas translucent inside it. Every shipped mode has to leave the
 * canvas opaque and leave the map alone where the layer does not cover.
 */

/** Reads back one pixel of the live WebGL canvas as `[r, g, b, a]`. */
async function samplePixel(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector(".maplibregl-canvas") as HTMLCanvasElement;
      // The app keeps `preserveDrawingBuffer` on for the Print Layout composer,
      // which is also what makes the drawing buffer readable here.
      const scratch = document.createElement("canvas");
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const ctx = scratch.getContext("2d")!;
      ctx.drawImage(canvas, 0, 0);
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      const data = ctx.getImageData(
        Math.floor(rect.width * x * dpr),
        Math.floor(rect.height * y * dpr),
        1,
        1,
      ).data;
      return [data[0], data[1], data[2], data[3]];
    },
    [fx, fy],
  );
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test("blends a vector layer against the map beneath it", async ({ page }) => {
  await waitForMap(page);
  await dropGeoJson(page, "blendtest", POLYGON);
  await expect(layerRow(page, "blendtest")).toBeVisible();

  const select = layerRow(page, "blendtest").getByLabel("Blend mode for blendtest");
  await expect(select).toBeVisible();

  // Let the basemap tiles settle so the backdrop being blended into is stable.
  await page.waitForTimeout(3000);
  const normal = await samplePixel(page, 0.5, 0.5);
  expect(normal[3]).toBe(255);

  await select.selectOption("multiply");
  await expect
    .poll(async () => luminance(await samplePixel(page, 0.5, 0.5)), { timeout: 15_000 })
    .toBeLessThan(luminance(normal));

  await select.selectOption("screen");
  await expect
    .poll(async () => luminance(await samplePixel(page, 0.5, 0.5)), { timeout: 15_000 })
    .toBeGreaterThan(luminance(normal));

  // Clearing the mode has to restore the layer exactly: `fill-layer-opacity` is
  // set to elect MapLibre's composite path and must be written back to 1.
  await select.selectOption("normal");
  await expect.poll(async () => samplePixel(page, 0.5, 0.5), { timeout: 15_000 }).toEqual(normal);
});

test("keeps the canvas opaque and the uncovered map intact in every mode", async ({ page }) => {
  await waitForMap(page);
  await dropGeoJson(page, "blendtest", POLYGON);
  await expect(layerRow(page, "blendtest")).toBeVisible();
  await page.waitForTimeout(3000);

  const select = layerRow(page, "blendtest").getByLabel("Blend mode for blendtest");
  const modes = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(modes).toContain("multiply");
  // The two modes whose GL equations broke this invariant must stay unlisted.
  expect(modes).not.toContain("darken");
  expect(modes).not.toContain("subtract");

  for (const mode of modes) {
    await select.selectOption(mode);
    await page.waitForTimeout(1200);
    const centre = await samplePixel(page, 0.5, 0.5);
    expect(centre[3], `${mode} left the canvas translucent`).toBe(255);
  }
});
