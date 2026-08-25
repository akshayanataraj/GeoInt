import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DESKTOP_LAYOUT_SETTINGS,
  normalizeDesktopSettings,
} from "../apps/geolibre-desktop/src/hooks/useDesktopSettings";

// The Comments right panel used to be session-only: its Settings → Layout
// toggle moved the panel registry but nothing was persisted, so every launch
// reopened it (GeoLibre#1935). It is now a layout setting like the Layers/Style
// panels, which means it has to round-trip through normalizeDesktopSettings and
// keep defaulting to on for existing users whose stored settings predate the key.
//
// The Browser panel was removed from this product entirely, so its
// `browserPanelVisible` key is gone. A stored value for it is simply ignored
// (normalizeDesktopSettings only copies keys it knows about), which is what the
// last case pins: a settings blob written by the old build must still load
// cleanly rather than throwing or resurrecting the key.
describe("dockable panel layout settings", () => {
  it("defaults the Comments panel to visible", () => {
    assert.equal(DEFAULT_DESKTOP_LAYOUT_SETTINGS.commentsPanelVisible, true);
  });

  it("keeps a disabled panel disabled across a load", () => {
    const layout = normalizeDesktopSettings({
      layout: { commentsPanelVisible: false },
    }).layout;
    assert.equal(layout.commentsPanelVisible, false);
  });

  it("falls back to the defaults for settings saved before the keys existed", () => {
    const layout = normalizeDesktopSettings({
      layout: { layerPanelVisible: false, stylePanelVisible: true, toolbarLabels: true },
    }).layout;
    assert.equal(layout.layerPanelVisible, false);
    assert.equal(layout.commentsPanelVisible, true);
  });

  it("rejects non-boolean values from tampered storage", () => {
    const layout = normalizeDesktopSettings({
      layout: { commentsPanelVisible: 0 },
    }).layout;
    assert.equal(layout.commentsPanelVisible, true);
  });

  it("ignores the removed Browser panel key without resurrecting it", () => {
    const layout = normalizeDesktopSettings({
      layout: { browserPanelVisible: false, commentsPanelVisible: true },
    }).layout;
    assert.equal(layout.commentsPanelVisible, true);
    assert.ok(!("browserPanelVisible" in layout));
  });
});
