import { registerRightPanel } from "@geolibre/plugins";
import { isRightPanelVisible, subscribeRightPanels } from "@geolibre/plugins/right-panel-registry";
import { useEffect } from "react";
import { applyRightPanelVisibility } from "../lib/persisted-right-panel";

/** Stable id of the Analyst Chat right panel. */
export const ANALYST_CHAT_PANEL_ID = "analyst-chat";

/**
 * Registers the Analyst Chat panel as a dockable right panel sharing the Style
 * (right) sidebar's rail (`replace-style`) -- the same mechanism the built-in
 * Comments panel uses (see `useRegisterCommentsPanel`), so Chat gets that
 * dock's chrome (collapse-to-rail, move, close) instead of a second panel
 * system of our own.
 *
 * Called before `useRegisterCommentsPanel()` in `DesktopShell` so Chat enters
 * the registry's visible set first: `SharedSidebar` renders the shared rail in
 * that same stable registration order, with the built-in Style entry always
 * appended last, so being first here is what puts Chat's rail entry above
 * Comments and above Style -- landing it "above Comments and Style" as asked,
 * not by fixed positioning but by registration order. That order does not
 * reshuffle when a panel is opened: `SharedSidebar` previously always
 * rendered whichever panel was active first, which put a rail icon at the top
 * of the list the instant it was clicked (reported as icons "jumping" on
 * selection) -- fixed there, not here, but noted since it's what makes "Chat
 * stays first" mean the icon never has to physically move to prove it.
 *
 * Unlike Comments, this is not wired to a persisted Settings toggle: there is
 * no "hide Analyst Chat" setting yet, only the always-on registration below.
 * Visible but collapsed by default (open then immediately collapse), matching
 * how Comments/Browser behave -- discoverable in the rail without covering the
 * map on load.
 *
 * The header's close (X) button calls the same `closeRightPanel` any dockable
 * panel gets, which -- per `persisted-right-panel.ts`'s docstring -- removes
 * the rail entry entirely rather than just collapsing it; Comments and Browser
 * can do that because a Settings toggle can always bring them back. Analyst
 * Chat has no such toggle, so that close reads as the rail icon vanishing for
 * the rest of the session with no way back (reported as "clicked the cross
 * and it disappeared from the sidebar"). The subscription below is this
 * panel's stand-in for that missing toggle: whenever the registry reports
 * Analyst Chat went invisible, it is immediately reopened and re-collapsed --
 * so the close button still closes the expanded panel, it just cannot make
 * the rail entry disappear. `applyRightPanelVisibility` no-ops once it is
 * already visible, so this does not loop.
 *
 * `render` is a no-op for the same reason Comments' is: the panel body is a
 * React component needing the app's context (the store, i18n), so it cannot be
 * drawn through the registry's imperative `render(container)`. `DesktopShell`
 * portals `<IntelChatPanel>` into a dedicated content host that the dock slot
 * adopts while this panel is active.
 */
export function useRegisterAnalystChatPanel(): void {
  useEffect(() => {
    const dispose = registerRightPanel({
      id: ANALYST_CHAT_PANEL_ID,
      // Plain string, not an i18n getter: this panel's own copy is still
      // untranslated placeholder-pending-backend text (see `lib/intel/`), so
      // translating just the title would be inconsistent with the rest of it.
      title: "Analyst Chat",
      dock: "replace-style",
      render: () => {},
    });
    applyRightPanelVisibility(ANALYST_CHAT_PANEL_ID, true);
    const unsubscribe = subscribeRightPanels(() => {
      if (!isRightPanelVisible(ANALYST_CHAT_PANEL_ID)) {
        applyRightPanelVisibility(ANALYST_CHAT_PANEL_ID, true);
      }
    });
    return () => {
      unsubscribe();
      dispose();
    };
  }, []);
}
