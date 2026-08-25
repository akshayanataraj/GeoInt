import { cn } from "@geolibre/ui";
import { ChevronRight, Radio } from "lucide-react";
import { useState } from "react";
import { useIntelResource } from "../../hooks/useIntelResource";
import { fetchRecentTopics } from "../../lib/intel/client";
import type { NewsTopic } from "../../lib/intel/contracts";
import { PanelFrame, PanelSkeleton } from "./PanelFrame";

/**
 * Recent indexed topics, each expandable to its reported timeline.
 *
 * Mirrors `GET /api/v1/media/news/recent`, so what is displayed is exactly what
 * that endpoint returns and no more. Two consequences worth stating, because
 * both look like omissions:
 *
 * - **No map interaction.** A topic carries a `country` *name* and nothing else
 *   positional; there are no coordinates on a topic or on any of its timeline
 *   events. Clicking a topic therefore cannot fly the map to it. The only
 *   available geocoding is a separate endpoint that regex-matches country names
 *   to a table of ~70 country centroids, which would put every Indian topic on
 *   the same point in central India -- worse than not moving the map at all.
 * - **No event track.** Timeline events have a date but no position, so the
 *   event-to-event route animation in UI_REPURPOSE_PLAN.md §10 cannot be built
 *   from this contract. It needs per-event coordinates from the backend.
 *
 * Until then the timeline is presented as what it actually is: a dated, sourced
 * list.
 */
export function EventFeedPanel({ onClose }: { onClose: () => void }) {
  const topics = useIntelResource(() => fetchRecentTopics(20), []);

  return (
    <PanelFrame
      icon={Radio}
      label="Event Feed"
      meta={topics.data ? String(topics.data.length) : undefined}
      onClose={onClose}
    >
      {topics.loading ? (
        <PanelSkeleton rows={6} />
      ) : topics.data && topics.data.length > 0 ? (
        <ul className="divide-y divide-border/30">
          {topics.data.map((topic) => (
            <TopicRow key={topic.id} topic={topic} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No topics in the current window.
        </p>
      )}
    </PanelFrame>
  );
}

function TopicRow({ topic }: { topic: NewsTopic }) {
  const [expanded, setExpanded] = useState(false);
  const hasTimeline = topic.timeline.length > 0;

  return (
    <li className="bg-card">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        disabled={!hasTimeline}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2.5 text-start transition-colors",
          hasTimeline ? "hover:bg-accent/40" : "cursor-default",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
            hasTimeline ? "text-muted-foreground" : "opacity-0",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug text-foreground">{topic.headline}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="truncate">{topic.source}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{topic.country}</span>
            {topic.published_at ? (
              <>
                <span aria-hidden>·</span>
                <time className="intel-numeral shrink-0" dateTime={topic.published_at}>
                  {formatTime(topic.published_at)}
                </time>
              </>
            ) : null}
          </p>
        </div>
      </button>
      {expanded ? <Timeline topic={topic} /> : null}
    </li>
  );
}

/**
 * The topic's reported timeline, as a vertical dated list.
 *
 * The connecting rule is drawn with a left border on the list and a dot per
 * item, rather than a per-item pseudo-element, so the line is continuous
 * between items and terminates cleanly at the last one.
 */
function Timeline({ topic }: { topic: NewsTopic }) {
  return (
    <div className="geoint-fade-in px-3 pb-3 ps-8 motion-reduce:animate-none">
      <p className="intel-label pb-1.5">Reported sequence</p>
      <ol className="space-y-2 border-s border-border/60 ps-3">
        {topic.timeline.map((event, index) => (
          <li key={`${event.url}-${index}`} className="relative">
            {/* Pulled out onto the rule itself; -0.9375rem is the 12px ps-3
                inset plus half the 6px dot. */}
            <span
              aria-hidden
              className="absolute -start-[0.9375rem] top-1 h-1.5 w-1.5 rounded-full bg-primary/70"
            />
            <p className="text-[11px] leading-snug text-foreground">{event.event}</p>
            {event.date ? (
              <time className="intel-numeral text-[10px] text-muted-foreground" dateTime={event.date}>
                {event.date}
              </time>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
        Timeline events carry no coordinates, so this sequence cannot be plotted.
      </p>
    </div>
  );
}

/**
 * Time-of-day only. The feed is a recent window, so the date is nearly always
 * today and repeating it on every row is noise; the full timestamp stays
 * available in the `datetime` attribute.
 *
 * Falls back to the raw string if parsing fails rather than showing "Invalid
 * Date" -- the server sends ISO-8601 text and a malformed value should still
 * display something truthful.
 */
function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
