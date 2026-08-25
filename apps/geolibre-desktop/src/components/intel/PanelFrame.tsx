import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@geolibre/ui";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared chrome for a dock panel: a compact header strip and a scrolling body.
 *
 * Every panel uses this so the docks stay visually uniform as panels are added
 * -- one header height, one label treatment, one close affordance, one scroll
 * boundary. The scroll boundary in particular is worth centralising: the panel
 * body owns its own overflow, so a long list scrolls inside the panel and never
 * grows the console layout or pushes the map around.
 *
 * The header shows a text label even though the rail is icon-only. The rail
 * needs to stay narrow, but a panel occupying 20% of the screen should say what
 * it is without a hover.
 */
export interface PanelFrameProps {
  icon: LucideIcon;
  label: string;
  /** Optional short status shown right of the label — a count, an "as of" time. */
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function PanelFrame({
  icon: Icon,
  label,
  meta,
  onClose,
  children,
  className,
}: PanelFrameProps) {
  return (
    <section
      aria-label={label}
      // `flex-1` so the panel fills the height its dock slot gives it, and
      // `min-h-0` so its scrolling body can shrink below content height instead
      // of forcing the dock to grow.
      className={cn("flex min-h-0 flex-1 flex-col bg-card/40", className)}
    >
      <header className="intel-hairline flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
        <h2 className="intel-label truncate">{label}</h2>
        {meta ? (
          <span className="intel-numeral ms-auto shrink-0 text-[11px] text-muted-foreground">
            {meta}
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Close ${label}`}
              onClick={onClose}
              className={cn(
                "h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground",
                // Without `meta` there is nothing else claiming the free space,
                // so the button takes it and sits flush right.
                meta ? "-me-1" : "-me-1 ms-auto",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {children}
      </div>
    </section>
  );
}

/**
 * The state most of this console is in today: a panel whose backend does not
 * exist yet. Given how much of the platform is an unimplemented scaffold, this
 * is a normal, expected state rather than an error, and it is styled as
 * information -- no destructive colour, no alert icon.
 *
 * `detail` should say what specifically is missing (which service, which
 * module), because during integration that is the only useful part.
 */
export function PanelNotConfigured({ detail }: { detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="intel-label">Not connected</p>
      <p className="max-w-[26ch] text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * Loading placeholder. Renders shaped bars rather than a spinner so the panel
 * keeps its eventual density while loading and does not visibly jump when data
 * lands.
 */
export function PanelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-muted" />
          <div
            className="h-2.5 rounded bg-muted"
            // Descending widths read as a list of varying-length labels rather
            // than a block of identical bars.
            style={{ width: `${72 - index * 8}%` }}
          />
        </div>
      ))}
    </div>
  );
}
