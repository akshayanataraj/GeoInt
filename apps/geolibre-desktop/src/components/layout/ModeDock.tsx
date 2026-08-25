import { useAppStore } from "@geolibre/core";
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@geolibre/ui";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { APP_MODE_META } from "../../lib/app-modes";
import { FeedbackDialog } from "./FeedbackDialog";

/**
 * The single-screen mode dock (UI_REPURPOSE_PLAN.md §2, §2a): a narrow,
 * icon-only vertical rail, not a labeled tab strip -- the prior header-bar
 * version still read as browser tabs even though it wasn't routing. No text
 * labels (discoverability comes from the `Tooltip` on hover instead), no
 * bordered/filled "active tab" box -- the active mode gets `glow-active`
 * (a ring + soft glow in --primary, defined in index.css) instead.
 *
 * Reserves real flex space (a fixed-width flex column), not an
 * absolute-position overlay, for the same reason the header-bar version
 * did: it structurally cannot overlap anything `DesktopShell` docks at its
 * own edges (Layers/Browser panels, the map's own controls). `App.tsx` lays
 * this out as a flex row with the dock on the left and `DesktopShell`/
 * `ModeScreen` taking the remaining space, mirroring how the header-bar
 * version reserved a row above the content instead.
 *
 * Deliberately NOT built inside `DesktopShell`/`TopToolbar` (both multi-
 * thousand-line files deeply specific to the map experience): a mode that
 * isn't "map" doesn't mount `DesktopShell` at all, so anything meant to
 * persist across modes has to live above that branch, not inside it.
 *
 * Feedback is a floating action here, not a mode switch, per the feature
 * spec's requirement that it stay reachable from every module.
 */
export function ModeDock() {
  const activeMode = useAppStore((s) => s.ui.activeMode);
  const setActiveMode = useAppStore((s) => s.setActiveMode);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Mode switcher"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-background py-2"
      >
        {APP_MODE_META.map((mode) => {
          const Icon = mode.icon;
          const active = activeMode === mode.id;
          return (
            <Tooltip key={mode.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={active}
                  aria-label={mode.label}
                  onClick={() => setActiveMode(mode.id)}
                  className={cn(
                    "h-9 w-9 rounded-lg transition-colors",
                    active ? "glow-active text-primary" : "text-muted-foreground",
                    !active && "hover:text-foreground",
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{mode.label}</TooltipContent>
            </Tooltip>
          );
        })}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Send feedback"
              onClick={() => setFeedbackOpen(true)}
              className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <MessageSquarePlus className="h-4.5 w-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Feedback</TooltipContent>
        </Tooltip>
      </nav>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
