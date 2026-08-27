import { Input, cn } from "@geolibre/ui";
import { Grid3x3, Minus, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useIntelResource } from "../../hooks/useIntelResource";
import { fetchS2Map, fetchS2Series } from "../../lib/intel/client";
import {
  S2_SPANS,
  S2_TIER_ORDER,
  type S2MapData,
  type S2Point,
  type S2SeriesBucket,
  type S2SeriesSummary,
  type S2Tier,
} from "../../lib/intel/s2-contracts";
import { setS2Place, setS2Span, toggleS2Tier, useS2Filters, type S2Filters } from "../../lib/intel/s2-filters";
import { tierLabel, tierText } from "../../lib/intel/severity";
import { PanelFrame, PanelSkeleton } from "./PanelFrame";

/**
 * S2 Grid's readout: kinematic/sentiment KPIs, a severity trend, and a
 * ranked location list, plus the filters that narrow both this panel and
 * `S2GridLayer`'s map choropleth together.
 *
 * Deliberately *not* a second rendering of what the map already shows. An
 * earlier version put a tier-distribution bar and a per-cell list here,
 * which was just the map's own colour-coding restated as numbers -- useful
 * once, not twice on the same screen. This instead reads from
 * `fetchS2Series` (S2_GRID.md's `/api/s2/series`, a genuinely different
 * response from `/api/s2/map`): velocity, acceleration, tone, conflict
 * share, anomaly buckets -- a trend and a rate of change, which the map's
 * point-in-time choropleth has no way to show. See `S2SeriesSummary`'s
 * docstring in `s2-contracts.ts`.
 *
 * Filters live in `s2-filters.ts`, an external store shared with
 * `S2GridLayer` (the two are siblings under `App`, not parent/child) --
 * changing the span, unchecking a tier, or typing a place narrows what both
 * surfaces fetch and show, which is the point of "find some area": a
 * result here is the same result the map is drawing.
 *
 * Rendered from fixtures -- the media service's S2 module is an empty
 * scaffold with no routes at all, so `fetchS2Map`/`fetchS2Series` mirror the
 * *target* API shape (S2_GRID.md) rather than something already live.
 */
export function S2MetricsPanel({ onClose }: { onClose: () => void }) {
  const filters = useS2Filters();
  const map = useIntelResource(() => fetchS2Map(filters), [filters]);
  const series = useIntelResource(() => fetchS2Series(filters), [filters]);

  return (
    <PanelFrame icon={Grid3x3} label="S2 Grid" meta={map.data ? `L${map.data.level}` : undefined} onClose={onClose}>
      <S2FilterBar filters={filters} />
      {map.loading || series.loading ? (
        <PanelSkeleton rows={7} />
      ) : map.data && series.data ? (
        <div className="divide-y divide-border/40">
          <KpiGrid mapData={map.data} summary={series.data.summary} />
          <div className="space-y-1.5 bg-card px-3 py-2.5">
            <p className="intel-label">Severity trend, {series.data.span}</p>
            <SeverityTrendChart buckets={series.data.buckets} />
          </div>
          <TopLocationsList points={map.data.points} />
        </div>
      ) : null}
    </PanelFrame>
  );
}

/**
 * Span, tier, and place controls in one strip. A tier chip toggles that
 * tier's inclusion (all three on by default -- unchecking narrows); the
 * place field is a plain substring match against a point's `place` (see
 * `fetchS2Map`'s docstring for why it narrows points, not cells).
 */
function S2FilterBar({ filters }: { filters: S2Filters }) {
  return (
    <div className="space-y-2 bg-card px-3 py-2.5">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0.5" role="group" aria-label="Time span">
          {S2_SPANS.map((span) => (
            <button
              key={span}
              type="button"
              aria-pressed={filters.span === span}
              onClick={() => setS2Span(span)}
              className={cn(
                "intel-numeral rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                filters.span === span
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {span}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-1" role="group" aria-label="Severity tiers">
          {S2_TIER_ORDER.map((tier) => {
            const active = filters.tiers.has(tier);
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={active}
                aria-label={`${active ? "Hide" : "Show"} ${tierLabel(tier)}`}
                title={tierLabel(tier)}
                onClick={() => toggleS2Tier(tier)}
                className={cn(
                  "h-4 w-4 rounded-full border-2 border-current bg-current transition-opacity",
                  tierText(tier),
                  active ? "opacity-100" : "opacity-20",
                )}
              />
            );
          })}
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute start-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={filters.place}
          onChange={(event) => setS2Place(event.target.value)}
          placeholder="Find an area…"
          aria-label="Find an area"
          className="h-7 ps-7 text-xs"
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p className="intel-label">{label}</p>
      <p className={cn("intel-numeral mt-0.5 leading-none", valueClassName ?? "text-lg text-foreground")}>
        {value}
      </p>
    </div>
  );
}

/**
 * Six tiles: two baseline counts (Events, Locations -- already filtered),
 * four from `S2SeriesSummary`'s kinematic/sentiment metrics. Matches
 * S2_GRID.md 5.1's "6 KPI Metric Tiles" for the panel's Selection mode.
 */
function KpiGrid({ mapData, summary }: { mapData: S2MapData; summary: S2SeriesSummary }) {
  const escalating = summary.acceleration > 0;
  return (
    <div className="grid grid-cols-3 gap-px bg-border/40">
      <Metric label="Events" value={mapData.nEvents.toLocaleString()} valueClassName="text-lg text-foreground" />
      <Metric label="Locations" value={String(mapData.nLocations)} valueClassName="text-lg text-foreground" />
      <Metric
        label="Velocity"
        value={`${summary.velocity.toFixed(1)}/hr`}
        valueClassName="text-lg text-foreground"
      />
      <Metric
        label="Acceleration"
        value={`${escalating ? "+" : ""}${summary.acceleration.toFixed(1)}`}
        valueClassName={cn("text-lg", escalating ? "intel-tier-red" : "text-foreground")}
      />
      <Metric
        label="Mean tone"
        value={summary.meanTone.toFixed(1)}
        valueClassName={cn("text-lg", summary.meanTone < -3 ? "intel-tier-yellow" : "text-foreground")}
      />
      <Metric
        label="Anomalies"
        value={String(summary.anomalyBuckets)}
        valueClassName={cn("text-lg", summary.anomalyBuckets > 0 ? "intel-tier-red" : "text-foreground")}
      />
    </div>
  );
}

/**
 * Compact stacked-bar sparkline: each bucket's green/yellow/red composition,
 * one bar per bucket -- shows severity *shifting* over time, which nothing
 * else in this panel or on the map does. Zero-dependency SVG, per
 * S2_GRID.md 5.5's own charting philosophy, not a charting library for a
 * seven-point series.
 */
function SeverityTrendChart({ buckets }: { buckets: readonly S2SeriesBucket[] }) {
  if (buckets.length === 0) {
    return <p className="text-xs text-muted-foreground">No trend data for these filters</p>;
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.green + bucket.yellow + bucket.red));
  const barWidth = 100 / buckets.length;
  const gap = barWidth * 0.18;
  const chartHeight = 32;

  return (
    <svg viewBox={`0 0 100 ${chartHeight}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      {buckets.map((bucket, index) => {
        const x = index * barWidth + gap / 2;
        const w = barWidth - gap;
        const scale = chartHeight / max;
        let y = chartHeight;
        const segments: { tier: S2Tier; count: number }[] = [
          { tier: "green", count: bucket.green },
          { tier: "yellow", count: bucket.yellow },
          { tier: "red", count: bucket.red },
        ];
        return (
          <g key={bucket.bucket}>
            {segments.map(({ tier, count }) => {
              const height = count * scale;
              y -= height;
              return (
                <rect
                  key={tier}
                  x={x}
                  y={y}
                  width={w}
                  height={height}
                  className={cn(tierText(tier), "fill-current")}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Top 8 busiest locations, most severe first then by volume -- the panel's
 * one list, and a genuinely different readout from a per-cell list: cells
 * are anonymous hex tokens the map already colours, while a location has a
 * human-readable place name an analyst can act on directly. Matches
 * S2_GRID.md 5.5's `rankBars` ("Top 8 busiest locations in current view").
 */
function TopLocationsList({ points }: { points: readonly S2Point[] }) {
  const ranked = [...points]
    .sort((a, b) => {
      const byTier = S2_TIER_ORDER.indexOf(b.tier) - S2_TIER_ORDER.indexOf(a.tier);
      return byTier !== 0 ? byTier : b.n - a.n;
    })
    .slice(0, 8);

  if (ranked.length === 0) {
    return (
      <div className="bg-card px-3 py-6 text-center text-xs text-muted-foreground">
        No locations match these filters
      </div>
    );
  }

  return (
    <div className="bg-card">
      <p className="intel-label px-3 pb-1 pt-2.5">Top locations</p>
      <ul className="divide-y divide-border/30">
        {ranked.map((point) => (
          <li
            key={`${point.lat},${point.lng}`}
            className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40"
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", tierText(point.tier))} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">{point.place}</p>
              <p className="intel-numeral text-[10px] text-muted-foreground">
                {point.mentions.toLocaleString()} mentions · tone {point.tone.toFixed(1)}
              </p>
            </div>
            <span className="intel-numeral shrink-0 text-xs text-foreground">{point.n}</span>
            <GrowthChip growth={point.growth} growing={point.growing} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Growth against the previous window, per S2_GRID.md section 2.3's decay
 * model -- `growing` (λ < 0, media attention accelerating) is the signal to
 * watch, so it gets the rising-attention treatment regardless of `growth`'s
 * sign: a location can be `growing` on the fitted decay curve while its raw
 * window-over-window ratio is still catching up.
 */
function GrowthChip({ growth, growing }: { growth: number; growing: boolean }) {
  if (growth === 0 && !growing) {
    return (
      <span
        className="flex w-11 shrink-0 items-center justify-end gap-0.5 text-muted-foreground"
        title="No change vs. prior window"
      >
        <Minus className="h-3 w-3" aria-hidden />
        <span className="sr-only">No change</span>
      </span>
    );
  }
  const rising = growth > 0 || growing;
  const Icon = rising ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "flex w-11 shrink-0 items-center justify-end gap-0.5",
        growing ? "intel-tier-red" : "text-muted-foreground",
      )}
      title={growing ? "Media attention accelerating" : undefined}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span className="intel-numeral text-[10px]">{Math.round(Math.abs(growth) * 100)}%</span>
    </span>
  );
}
