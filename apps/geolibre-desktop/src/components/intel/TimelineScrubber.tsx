import { useAppStore } from "@geolibre/core";
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@geolibre/ui";
import { Play, X } from "lucide-react";
import { useState } from "react";

/**
 * Temporal scrubber beneath the map.
 *
 * Presented as an inert control on purpose, and labelled as such. The window
 * buttons and the scrub position hold local state so the control's mechanics and
 * proportions are reviewable, but nothing is filtered by them: no panel in this
 * console has a time-filterable data source yet. The S2 module that would supply
 * time-series aggregates is an empty scaffold, and the news feed's timeline
 * events carry dates but no coordinates, so there is nothing on the map for a
 * time window to select.
 *
 * The alternative -- wiring it to filter the fixtures -- would make it look
 * finished and hide exactly the dependency that has to be resolved first. The
 * playback control is disabled for the same reason: an animation over invented
 * events would be the most convincing and least true thing in the interface.
 *
 * What it does establish is the layout contract: the strip reserves real height
 * at the bottom of the map column, so turning it on shrinks the map rather than
 * covering its lower edge (and its attribution and scale controls).
 */
const WINDOWS = ["1h", "6h", "24h", "7d", "30d"] as const;

export function TimelineScrubber() {
  const setTimelineOpen = useAppStore((s) => s.setIntelTimelineOpen);
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>("24h");
  // 0..100 along the window. Local and inert -- see the note above.
  const [position, setPosition] = useState(100);

  return (
    <section
      aria-label="Timeline"
      className="intel-hairline flex h-11 shrink-0 items-center gap-3 border-t bg-card/60 px-3"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled
            aria-label="Play through the window"
            className="h-6 w-6 shrink-0 text-muted-foreground"
          >
            <Play className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Playback needs time-stamped map events</TooltipContent>
      </Tooltip>

      <div className="flex shrink-0 items-center gap-0.5">
        {WINDOWS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={window === option}
            onClick={() => setWindow(option)}
            className={cn(
              "intel-numeral rounded px-1.5 py-0.5 text-[10px] transition-colors",
              window === option
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {/* Native range input rather than the UI package's Slider: this is a
          full-width scrub track in a 44px strip, and the styled Slider's thumb
          and padding are built for form layouts. */}
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label={`Position within the last ${window}`}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />

      <span className="intel-numeral shrink-0 text-[10px] text-muted-foreground">
        {position === 100 ? "now" : `-${window} +${position}%`}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close timeline"
            onClick={() => setTimelineOpen(false)}
            className="-me-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Close</TooltipContent>
      </Tooltip>
    </section>
  );
}
