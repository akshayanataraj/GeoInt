import { useAppStore, type IntelDockPanel } from "@geolibre/core";
import { cn } from "@geolibre/ui";
import type { ReactNode } from "react";
import { ConsoleSheet } from "./ConsoleSheet";
import { EventFeedPanel } from "./EventFeedPanel";
import { IntelRail } from "./IntelRail";
import { S2MetricsPanel } from "./S2MetricsPanel";
import { TimelineScrubber } from "./TimelineScrubber";

/**
 * The console frame.
 *
 * ```
 * ┌────┬───────────┬───────────────────────────────────┐
 * │    │ left dock │                                   │
 * │rail│ S2 Grid   │            MAP (always)            │
 * │    │ ───────── ├───────────────────────────────────┤
 * │    │ Event Feed│         TimelineScrubber            │
 * └────┴───────────┴───────────────────────────────────┘
 * ```
 *
 * The left dock stacks S2 Grid over the Event Feed, splitting the column
 * height. Both are visible at once by design -- they answer "how much, and
 * where" and "what specifically", which an analyst reads together.
 *
 * An earlier version also put the Analyst Chat panel in a second dock on the
 * right, owned by this same component. That moved: Chat is now registered into
 * GeoLibre's own right-side panel registry, sharing the Style rail above
 * Comments and the built-in Style panel (see `useRegisterAnalystChatPanel` and
 * its mount in `DesktopShell.tsx`), so it gets that dock's chrome (collapse,
 * move, close) instead of a second panel system of our own. Chat is a single
 * conversational surface with nothing that needs to be open *alongside*
 * Style/Comments, unlike S2+Events, which is why it fits that shared-rail model
 * while S2+Events do not -- that registry expands one panel per rail and
 * collapses the rest, which would never let S2 and the event feed be visible
 * together.
 *
 * `children` is the map shell, and it is *always* rendered -- no panel state can
 * hide or unmount it. Unmounting would tear down the live MapLibre instance and
 * every layer and panel state it holds, so the only thing that ever covers it is
 * the sheet overlay.
 *
 * The dock reserves real width in the flex row rather than floating over the
 * map. Two reasons, the second being the one that bites if ignored: the map is
 * genuinely narrower when the dock is open (so MapLibre resizes and nothing
 * hides under a panel), and a floating panel would sit on top of the controls
 * the map shell docks at its own edges -- attribution, scale, the map's own
 * buttons.
 */
export function IntelConsole({ children }: { children: ReactNode }) {
  const openPanels = useAppStore((s) => s.ui.intel.openPanels);
  const timelineOpen = useAppStore((s) => s.ui.intel.timelineOpen);
  const closePanel = useAppStore((s) => s.closeIntelPanel);

  const renderPanel = (panel: IntelDockPanel): ReactNode => {
    const onClose = () => closePanel(panel);
    switch (panel) {
      case "s2":
        return <S2MetricsPanel onClose={onClose} />;
      case "events":
        return <EventFeedPanel onClose={onClose} />;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-background">
      <IntelRail />

      {openPanels.length > 0 ? <Dock panels={openPanels} render={renderPanel} /> : null}

      {/* The map column. `relative` anchors the sheet overlay, which covers the
          map and the timeline but deliberately not the rail or the dock: the
          rail must stay clickable so a sheet can be dismissed from the same
          button that opened it. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">{children}</div>
        {timelineOpen ? <TimelineScrubber /> : null}
        <ConsoleSheet />
      </div>
    </div>
  );
}

/**
 * The left dock column. Fixed 300px width -- a metrics column. Drag-to-resize
 * is a reasonable later addition, left out here because it needs persistence
 * and a minimum-width policy to be worth having, and neither is worth designing
 * before the panels hold real data.
 */
function Dock({
  panels,
  render,
}: {
  panels: readonly IntelDockPanel[];
  render: (panel: IntelDockPanel) => ReactNode;
}) {
  return (
    <div
      className={cn(
        "intel-hairline flex min-h-0 w-[300px] shrink-0 flex-col divide-y divide-border/40 border-e bg-background",
        "geoint-dock-in-left motion-reduce:animate-none",
      )}
    >
      {/* One slot per panel, each an equal share of the column height with its
          own `min-h-0` so the panel inside scrolls rather than stretching the
          dock. Keyed by panel id, not index, so toggling one panel off does not
          re-key (and so remount) the panel below it. */}
      {panels.map((panel) => (
        <div key={panel} className="flex min-h-0 flex-1 flex-col">
          {render(panel)}
        </div>
      ))}
    </div>
  );
}
