import { useAppStore } from "@geolibre/core";
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@geolibre/ui";
import { Clock, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { INTEL_DOCK_PANEL_META, INTEL_SHEET_META } from "../../lib/intel/panels";
import { FeedbackDialog } from "../layout/FeedbackDialog";

/**
 * The console rail: a narrow icon column of independent toggles.
 *
 * Every entry toggles a surface *while the map stays live*: the top group opens
 * dock panels beside it, the second group raises overlay sheets over it. Nothing
 * in the rail can navigate away from the map, because there is nowhere to
 * navigate to.
 *
 * Icon-only with tooltips, and an active entry is lit (`glow-active`) rather
 * than boxed -- UI_REPURPOSE_PLAN.md §2a rejected the boxed-active-tab look, and
 * a rail of boxed active items would read as a tab strip again. `aria-pressed`
 * (not `aria-current`) because these are independent switches, not one selected
 * item in a set.
 */
export function IntelRail() {
  const sheet = useAppStore((s) => s.ui.intel.sheet);
  const timelineOpen = useAppStore((s) => s.ui.intel.timelineOpen);
  const setSheet = useAppStore((s) => s.setIntelSheet);
  const setTimelineOpen = useAppStore((s) => s.setIntelTimelineOpen);
  const openPanels = useAppStore((s) => s.ui.intel.openPanels);
  const togglePanel = useAppStore((s) => s.toggleIntelPanel);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Console panels"
        className="intel-hairline flex w-12 shrink-0 flex-col items-center gap-1 border-e bg-background py-2"
      >
        {INTEL_DOCK_PANEL_META.map((panel) => (
          <RailButton
            key={panel.id}
            icon={panel.icon}
            label={panel.label}
            hint={panel.hint}
            active={openPanels.includes(panel.id)}
            onClick={() => togglePanel(panel.id)}
          />
        ))}

        <RailButton
          icon={Clock}
          label="Timeline"
          hint="Temporal scrubber beneath the map"
          active={timelineOpen}
          onClick={() => setTimelineOpen(!timelineOpen)}
        />

        {/* Divider between "panels beside the map" and "sheets over it". The
            two behave differently, so they are not one flat list. */}
        <div className="my-1 h-px w-5 bg-border/60" role="separator" />

        {INTEL_SHEET_META.map((entry) => (
          <RailButton
            key={entry.id}
            icon={entry.icon}
            label={entry.label}
            hint={entry.hint}
            active={sheet === entry.id}
            // Re-pressing the open sheet's button closes it, so the button is a
            // real toggle and never a dead click.
            onClick={() => setSheet(sheet === entry.id ? null : entry.id)}
          />
        ))}

        <div className="flex-1" />

        <RailButton
          icon={MessageSquarePlus}
          label="Feedback"
          hint="Report a problem or suggest a change"
          active={false}
          onClick={() => setFeedbackOpen(true)}
        />
      </nav>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}

interface RailButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}

function RailButton({ icon: Icon, label, hint, active, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={active}
          aria-label={label}
          onClick={onClick}
          className={cn(
            "h-9 w-9 rounded-lg transition-colors",
            active ? "glow-active text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-52">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}
