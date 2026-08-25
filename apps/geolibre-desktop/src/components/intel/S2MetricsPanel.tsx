import { cn } from "@geolibre/ui";
import { Grid3x3, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useIntelResource } from "../../hooks/useIntelResource";
import { fetchS2Cells, fetchS2Summary } from "../../lib/intel/client";
import { SEVERITY_ORDER, type S2Cell, type Severity } from "../../lib/intel/s2-contracts";
import { severityBg, severityLabel, severityText } from "../../lib/intel/severity";
import { PanelFrame, PanelSkeleton } from "./PanelFrame";

/**
 * S2 cell metrics: the console's primary at-a-glance instrument.
 *
 * Three tiers, densest last, so the eye lands on the aggregate before the
 * detail: a total, a severity distribution, then the ranked cell list.
 *
 * Rendered from fixtures -- the media service's S2 module is an empty scaffold
 * with no routes at all, so these shapes are the UI's own provisional
 * assumption (see `s2-contracts.ts`).
 */
export function S2MetricsPanel({ onClose }: { onClose: () => void }) {
  const summary = useIntelResource(() => fetchS2Summary(), []);
  const cells = useIntelResource(() => fetchS2Cells(), []);

  const loading = summary.loading || cells.loading;

  return (
    <PanelFrame
      icon={Grid3x3}
      label="S2 Grid"
      meta={summary.data ? summary.data.window : undefined}
      onClose={onClose}
    >
      {loading ? (
        <PanelSkeleton rows={7} />
      ) : (
        <div className="divide-y divide-border/40">
          {summary.data ? (
            <>
              <div className="grid grid-cols-2 gap-px bg-border/40">
                <Metric label="Events" value={summary.data.totalEvents.toLocaleString()} />
                <Metric label="Active cells" value={String(summary.data.cellsActive)} />
              </div>
              <SeverityBar bySeverity={summary.data.bySeverity} />
            </>
          ) : null}
          {cells.data ? <CellList cells={cells.data} /> : null}
        </div>
      )}
    </PanelFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p className="intel-label">{label}</p>
      <p className="intel-numeral mt-0.5 text-xl leading-none text-foreground">{value}</p>
    </div>
  );
}

/**
 * Severity distribution as a single proportional bar plus a legend.
 *
 * A stacked bar rather than four separate counts because the useful question is
 * "how much of the picture is critical", which is a proportion, not four
 * absolute numbers. Segments are ordered by `SEVERITY_ORDER` so the bar always
 * runs calm → severe left to right and its shape is comparable between refreshes.
 */
function SeverityBar({ bySeverity }: { bySeverity: Record<Severity, number> }) {
  const total = SEVERITY_ORDER.reduce((sum, severity) => sum + bySeverity[severity], 0);

  return (
    <div className="space-y-2 bg-card px-3 py-2.5">
      <p className="intel-label">Severity</p>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">No cells in window</p>
      ) : (
        <>
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={SEVERITY_ORDER.map(
              (severity) => `${severityLabel(severity)} ${bySeverity[severity]}`,
            ).join(", ")}
          >
            {SEVERITY_ORDER.map((severity) => {
              const count = bySeverity[severity];
              if (count === 0) return null;
              return (
                <div
                  key={severity}
                  // The wash utilities are translucent, which is right for a
                  // chip on a card but too faint for a 6px bar segment, so the
                  // segments use the solid text colour via `currentColor`.
                  className={cn(severityText(severity), "bg-current")}
                  style={{ width: `${(count / total) * 100}%` }}
                />
              );
            })}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {SEVERITY_ORDER.map((severity) => (
              <li key={severity} className="flex items-center gap-1.5">
                <span
                  className={cn("h-1.5 w-1.5 rounded-full bg-current", severityText(severity))}
                />
                <span className="text-[11px] text-muted-foreground">
                  {severityLabel(severity)}
                </span>
                <span className="intel-numeral text-[11px] text-foreground">
                  {bySeverity[severity]}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Ranked cell list, most severe first and then by volume.
 *
 * Sorting on severity before count is the analyst-useful order: a critical cell
 * with 40 events matters more than a routine one with 400, so a pure count sort
 * would bury the thing worth looking at.
 */
function CellList({ cells }: { cells: readonly S2Cell[] }) {
  const ranked = [...cells].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
    return bySeverity !== 0 ? bySeverity : b.eventCount - a.eventCount;
  });

  return (
    <div className="bg-card">
      <p className="intel-label px-3 pb-1 pt-2.5">Cells</p>
      <ul className="divide-y divide-border/30">
        {ranked.map((cell) => (
          <li
            key={cell.token}
            className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40"
          >
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", severityText(cell.severity))}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">{cell.label}</p>
              <p className="intel-numeral text-[10px] text-muted-foreground">
                {cell.token} · L{cell.level}
              </p>
            </div>
            <span className="intel-numeral shrink-0 text-xs text-foreground">
              {cell.eventCount}
            </span>
            <TrendChip trend={cell.trend} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Trend against the previous window.
 *
 * A null trend renders as a dash, never as 0%: "no comparable prior window" and
 * "unchanged from the prior window" are different facts, and collapsing them
 * would misreport a brand-new cell as stable.
 *
 * Colour follows direction, not severity -- rising event volume is the notable
 * case regardless of which band the cell is in.
 */
function TrendChip({ trend }: { trend: number | null }) {
  if (trend === null) {
    return (
      <span
        className="flex w-11 shrink-0 items-center justify-end gap-0.5 text-muted-foreground"
        title="No comparable prior window"
      >
        <Minus className="h-3 w-3" aria-hidden />
        <span className="sr-only">No baseline</span>
      </span>
    );
  }
  const rising = trend > 0;
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "flex w-11 shrink-0 items-center justify-end gap-0.5",
        rising ? "intel-sev-high" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span className="intel-numeral text-[10px]">{Math.round(Math.abs(trend) * 100)}%</span>
    </span>
  );
}
