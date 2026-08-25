import { useAppStore, INTEL_DOCK_SIDE, type IntelDockPanel } from "@geolibre/core";
import { cn } from "@geolibre/ui";
import type { ReactNode } from "react";
import { ConsoleSheet } from "./ConsoleSheet";
import { EventFeedPanel } from "./EventFeedPanel";
import { IntelChatPanel } from "./IntelChatPanel";
import { IntelRail } from "./IntelRail";
import { S2MetricsPanel } from "./S2MetricsPanel";
import { TimelineScrubber } from "./TimelineScrubber";

/**
 * The console frame.
 *
 * ```
 * ┌────┬───────────┬──────────────────┬──────────────┐
 * │    │ left dock │                  │  right dock  │
 * │rail│ S2 Grid   │   MAP (always)   │ Analyst Chat │
 * │    │ ───────── ├──────────────────┤              │
 * │    │ Event Feed│ TimelineScrubber │              │
 * └────┴───────────┴──────────────────┴──────────────┘
 * ```
 *
 * The left dock stacks S2 Grid over the Event Feed, splitting the column
 * height. Both are visible at once by design -- they answer "how much, and
 * where" and "what specifically", which an analyst reads together.
 *
 * An earlier version registered these into GeoLibre's own side-panel registry
 * so they would share its sidebar chrome. That was abandoned: the registry
 * expands one panel per rail and collapses the rest, so S2 and the event feed
 * could never be on screen together, which is the arrangement that actually
 * works. Owning the docks here costs the dock chrome (no drag-to-detach) and
 * buys the stacked layout.
 *
 * `children` is the map shell, and it is *always* rendered -- no panel state can
 * hide or unmount it. Unmounting would tear down the live MapLibre instance and
 * every layer and panel state it holds, so the only thing that ever covers it is
 * the sheet overlay.
 *
 * Docks reserve real width in the flex row rather than floating over the map.
 * Two reasons, the second being the one that bites if ignored: the map is
 * genuinely narrower when a dock is open (so MapLibre resizes and nothing hides
 * under a panel), and a floating panel would sit on top of the controls the map
 * shell docks at its own edges -- attribution, scale, the map's own buttons.
 */
export function IntelConsole({ children }: { children: ReactNode }) {
  const openPanels = useAppStore((s) => s.ui.intel.openPanels);
  const timelineOpen = useAppStore((s) => s.ui.intel.timelineOpen);
  const closePanel = useAppStore((s) => s.closeIntelPanel);

  const leftPanels = openPanels.filter((panel) => INTEL_DOCK_SIDE[panel] === "left");
  const rightPanels = openPanels.filter((panel) => INTEL_DOCK_SIDE[panel] === "right");

  const renderPanel = (panel: IntelDockPanel): ReactNode => {
    const onClose = () => closePanel(panel);
    switch (panel) {
      case "s2":
        return <S2MetricsPanel onClose={onClose} />;
      case "events":
        return <EventFeedPanel onClose={onClose} />;
      case "chat":
        return <IntelChatPanel onClose={onClose} />;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-background">
      <IntelRail />

      {leftPanels.length > 0 ? (
        <Dock side="left" panels={leftPanels} render={renderPanel} />
      ) : null}

      {/* The map column. `relative` anchors the sheet overlay, which covers the
          map and the timeline but deliberately not the rail or the docks: the
          rail must stay clickable so a sheet can be dismissed from the same
          button that opened it. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">{children}</div>
        {timelineOpen ? <TimelineScrubber /> : null}
        <ConsoleSheet />
      </div>

      {rightPanels.length > 0 ? (
        <Dock side="right" panels={rightPanels} render={renderPanel} />
      ) : null}
    </div>
  );
}

/**
 * A dock column.
 *
 * Fixed width: 300px on the left (a metrics column) and 380px on the right
 * (prose and citations need the extra measure). Drag-to-resize is a reasonable
 * later addition, left out here because it needs persistence and a
 * minimum-width policy to be worth having, and neither is worth designing
 * before the panels hold real data.
 */
function Dock({
  side,
  panels,
  render,
}: {
  side: "left" | "right";
  panels: readonly IntelDockPanel[];
  render: (panel: IntelDockPanel) => ReactNode;
}) {
  return (
    <div
      className={cn(
        "intel-hairline flex min-h-0 shrink-0 flex-col divide-y divide-border/40 bg-background",
        side === "left" ? "w-[300px] border-e" : "w-[380px] border-s",
        side === "left" ? "geoint-dock-in-left" : "geoint-dock-in-right",
        "motion-reduce:animate-none",
      )}
    >
      {/* One slot per panel, each an equal share of the column height with its
          own `min-h-0` so the panel inside scrolls rather than stretching the
          dock. Keyed by panel id, not index, so toggling one panel off does not
          re-key (and so remount) the panels below it -- which for the chat would
          silently discard the transcript. */}
      {panels.map((panel) => (
        <div key={panel} className="flex min-h-0 flex-1 flex-col">
          {render(panel)}
        </div>
      ))}
    </div>
  );
}
