import { collapseRightPanel, getRightPanel, openRightPanel } from "@geolibre/plugins";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@geolibre/ui";
import { PanelRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRightPanelState } from "../../hooks/useRightPanels";
import { isImageSource } from "../../lib/icon-source";
import { RIGHT_PANEL_ICONS } from "../../lib/right-panel-icons";
import { PluginRightPanel } from "./PluginRightPanel";

/** Which built-in sidebar the plugin panel shares its rail with. */
type SharedSide = "layers" | "style";

interface SharedSidebarProps {
  /** Layers (left) or Style (right) sidebar surface. */
  side: SharedSide;
  /** Id of the active plugin panel docked with `replace-layers`/`replace-style`. */
  pluginId: string;
  /** Other enabled panels merged into this same shared rail. */
  additionalPanelIds?: string[];
  /** The active panel's shared content host (see {@link PluginRightPanel}). */
  pluginContentEl: HTMLElement;
  /** Shared plugin-panel width in px, owned by the shell. */
  pluginWidth: number;
  /** Update the shared plugin-panel width. */
  onPluginWidthChange: (width: number) => void;
  /** Whether the built-in panel (Layers/Style) is part of this layout. */
  builtinVisible: boolean;
  /** Rail-entry title for the built-in panel (e.g. "Layers", "Style"). */
  builtinTitle: string;
  /** Rail-entry icon for the built-in panel. */
  builtinIcon: ReactNode;
  /**
   * Force the built-in panel collapsed regardless of the user's opt-in,
   * mirroring its standalone `autoCollapse` triggers (the notebook or a story-map
   * presentation claiming the workspace). The panel restores to its opted-in
   * state when this clears, matching the standalone panel's behavior.
   */
  forceBuiltinCollapsed: boolean;
  /**
   * Start with the built-in panel expanded (and the plugin panel a collapsed
   * rail entry) instead of the default "plugin is the active workspace" layout.
   * Used for the Browser panel, which docks here on by default but should not
   * bury the Layers panel — it starts as a collapsed entry beside expanded
   * Layers. Only sets the initial state; the user's later toggles win.
   */
  initialBuiltinExpanded?: boolean;
  /** Render the built-in panel with controlled collapse. */
  renderBuiltin: (args: {
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
  }) => ReactNode;
}

interface RailEntry {
  id: string;
  title: string;
  icon: ReactNode;
  /** Whether this entry's panel is currently expanded. */
  active: boolean;
  /** Toggle the entry: expand it, or collapse it when already expanded. */
  onToggle: () => void;
}

/**
 * The shared-sidebar surface for the `replace-layers` / `replace-style` docking
 * modes.
 *
 * When a plugin panel docks with `dock: "replace-layers"` (or `"replace-style"`)
 * it shares the Layers (left) or Style (right) sidebar area instead of appearing
 * as a separate rail beside it. This renders a single rail on that edge listing
 * both the plugin panel and the built-in panel; selecting one expands it while
 * the other stays as a rail entry. The two are mutually exclusive, so the user
 * never sees two adjacent rails (issue #765).
 *
 * The built-in panel starts collapsed so the plugin reads as the active
 * workspace; the user can expand it at any time (which collapses the plugin) and
 * vice versa. Both child panels stay mounted while collapsed (they render nothing
 * via their `hideOwnRail`/shared-rail modes) so their state survives toggling.
 */
export function SharedSidebar({
  side,
  pluginId,
  additionalPanelIds = [],
  pluginContentEl,
  pluginWidth,
  onPluginWidthChange,
  builtinVisible,
  builtinTitle,
  builtinIcon,
  forceBuiltinCollapsed,
  initialBuiltinExpanded = false,
  renderBuiltin,
}: SharedSidebarProps) {
  const { t } = useTranslation();
  const { activeId, collapsed } = useRightPanelState();
  // The built-in panel is collapsed by default while the plugin is active; the
  // user opts it in. This resets when the sidebar unmounts (the plugin closes),
  // which is the desired "collapsed by default" behavior on reopen.
  const [builtinOptedIn, setBuiltinOptedIn] = useState(initialBuiltinExpanded);

  const panelIds = [pluginId, ...additionalPanelIds.filter((id) => id !== pluginId)];
  const pluginExpanded = panelIds.includes(activeId ?? "") && !collapsed;
  // The plugin displaces the built-in panel: one shared surface, one expanded
  // panel at a time. `forceBuiltinCollapsed` gates this too (it only gates, never
  // clears the opt-in, so the panel restores when the trigger lifts).
  const builtinExpanded =
    builtinVisible && !pluginExpanded && builtinOptedIn && !forceBuiltinCollapsed;

  // Switching back to the plugin forgets the built-in opt-in, so a later collapse
  // of the plugin lands on the shared rail (both collapsed) rather than
  // surprising the user by auto-expanding the built-in panel.
  const expandPlugin = (id: string) => {
    setBuiltinOptedIn(false);
    openRightPanel(id);
  };
  const collapsePlugin = () => collapseRightPanel(pluginId);
  const expandBuiltin = () => {
    setBuiltinOptedIn(true);
    // Collapse the plugin so it yields the surface to the built-in panel.
    collapseRightPanel(pluginId);
  };
  const collapseBuiltin = () => setBuiltinOptedIn(false);

  const entries: RailEntry[] = panelIds.map((id) => {
    const panel = getRightPanel(id);
    const KnownIcon = RIGHT_PANEL_ICONS[id];
    const icon = KnownIcon ? (
      <KnownIcon className="h-4 w-4" />
    ) : panel?.icon && isImageSource(panel.icon) ? (
      <img src={panel.icon} alt="" className="h-4 w-4 object-contain" />
    ) : (
      <PanelRight className="h-4 w-4" />
    );
    const expanded = activeId === id && !collapsed;
    return {
      id,
      title: panel?.title ?? id,
      icon,
      active: expanded,
      onToggle: expanded ? collapsePlugin : () => expandPlugin(id),
    };
  });
  if (builtinVisible) {
    entries.push({
      // Namespaced so the built-in entry's React key cannot collide with a plugin
      // id (plugin ids are arbitrary strings).
      id: "__builtin__",
      title: builtinTitle,
      icon: builtinIcon,
      active: builtinExpanded,
      onToggle: builtinExpanded ? collapseBuiltin : expandBuiltin,
    });
  }

  const pluginPanel = (
    // Renders the plugin content when expanded, nothing (but stays mounted) when
    // collapsed.
    <PluginRightPanel
      dock={side === "layers" ? "replace-layers" : "replace-style"}
      contentEl={pluginContentEl}
      width={pluginWidth}
      onWidthChange={onPluginWidthChange}
    />
  );
  // The built-in panel stays mounted across toggles; `hideOwnRail` makes it
  // render nothing while collapsed so only the shared rail shows.
  const builtinPanel = builtinVisible
    ? renderBuiltin({
        collapsed: !builtinExpanded,
        onCollapsedChange: (next) => {
          if (next) collapseBuiltin();
          else expandBuiltin();
        },
      })
    : null;

  // The Layers rail sits on the far-left edge (border on its right); the Style
  // rail on the far-right edge (border on its left).
  //
  // Restyled off the stock look (a boxed `bg-accent` active state, an
  // always-visible rotated label) to match the console's own rail
  // (`IntelRail`/`ModeDock`): ghost buttons, a lit `glow-active` ring instead of
  // a filled box, and icon-only-with-tooltip discoverability at desktop widths
  // rather than a permanent vertical label. The desktop label is not removed,
  // only visually hidden (`md:hidden` on the span) -- it still exists for
  // narrower/touch layouts where a tooltip would not be reachable.
  const rail = (
    <aside
      aria-label={t("sharedRail.label")}
      className={cn(
        "intel-hairline flex w-full shrink-0 items-center gap-1 border-t bg-background px-2 py-1 md:h-auto md:w-11 md:flex-col md:border-t-0 md:px-0 md:py-2",
        side === "layers" ? "md:border-e" : "md:border-s",
      )}
    >
      {entries.map((entry) => {
        const label = entry.active
          ? t("sharedRail.collapse", { title: entry.title })
          : t("sharedRail.expand", { title: entry.title });
        const button = (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.active}
            aria-label={label}
            onClick={entry.onToggle}
            className={cn(
              "flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors md:h-9 md:w-9 md:flex-col md:justify-center md:px-1 md:py-2",
              entry.active
                ? "glow-active text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.icon}
            <span className="text-[10px] font-semibold uppercase tracking-wide md:hidden">
              {entry.title}
            </span>
          </button>
        );
        return (
          <Tooltip key={entry.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side={side === "layers" ? "right" : "left"}>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </aside>
  );

  // Layers side: rail on the far left, then the expanded panel toward the map.
  // Style side: expanded panel, then the rail on the far right.
  return side === "layers" ? (
    <>
      {rail}
      {pluginPanel}
      {builtinPanel}
    </>
  ) : (
    <>
      {pluginPanel}
      {builtinPanel}
      {rail}
    </>
  );
}
