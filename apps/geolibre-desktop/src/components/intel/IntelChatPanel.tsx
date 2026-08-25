import { Button, Textarea, cn } from "@geolibre/ui";
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  MessageSquare,
  Send,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { sendChatMessage } from "../../lib/intel/client";
import type { ChatResponse, Citation } from "../../lib/intel/contracts";
import {
  setChatMapActiveIndex,
  setChatMapSequence,
} from "../../lib/intel/chat-map-sequence";
import type { ChatMapEvent } from "../../lib/intel/map-events-contract";
import { AnswerText } from "./AnswerText";

/**
 * The analyst chat panel -- this product's own chat surface, replacing
 * GeoLibre's built-in AI Assistant.
 *
 * GeoLibre's assistant is a *map-authoring* agent: it drives a tool-calling loop
 * against a user-supplied LLM endpoint to add layers, restyle, and move the
 * camera. This panel is the opposite shape. It asks an evidence-grounded
 * question of a retrieval pipeline the server owns, and its job is to present
 * the answer *with its provenance*: which sources support it, how the pipeline
 * routed it, and where coverage was thin. No client-side tool loop, no model
 * configuration, no client-held API key.
 *
 * Deliberately one component, not one per source. The platform's architecture
 * document is explicit that the per-module chatbots are transitional and
 * collapse into a single `/api/v1/assistant/chat`, listing "module chatbot
 * frontend components" as code to delete at that cutover. So the source
 * selector below chooses an endpoint; it does not select between separate chat
 * implementations. When unified chat lands, the selector goes away and the rest
 * of this file stays.
 *
 * Not implemented, because the server does not offer it: real streaming. The
 * request schema carries a `stream` flag, but the handler is a synchronous
 * function returning a complete response with no SSE, so `sendChatMessage`
 * resolves once with everything already in hand.
 *
 * What *is* implemented on top of that single round-trip is a client-side
 * *simulated* generation: once the fixture response lands, the answer text
 * reveals word by word and `ChatMapPlayback` flies the map through the
 * response's event sequence (see `chat-map-sequence.ts`), both driven off one
 * shared progress ramp so they finish together. This stands in for the real
 * tool-calling flow the plan drafted (`render_map_events`, UI_REPURPOSE_PLAN.md
 * §10): a model with native function-calling would call that tool mid-turn as
 * it resolves each event's coordinates, and the frontend executor would upsert
 * them into the map as they arrive. There is no such model in the loop here --
 * this chat is a plain fetch, not an agent loop, and GeoLibre's own tool-calling
 * machinery was removed with its AI Assistant -- so the reveal is played out
 * against the complete fixture response instead of real incremental tool
 * calls. The animation is genuine; the "generation" it is timed to is not.
 *
 * Renders as bare content, no header or close button of its own: this panel is
 * mounted inside GeoLibre's shared Style rail (see `useRegisterAnalystChatPanel`
 * and its portal in `DesktopShell.tsx`), which supplies the title, collapse,
 * move, and close chrome uniformly for every panel docked there -- adding a
 * second header here would duplicate it.
 */

/**
 * Which retrieval domain a question is put to.
 *
 * `social` is present and disabled rather than hidden: the module is a directory
 * of empty `__init__.py` files in the backend, so offering it would produce a
 * guaranteed failure, and hiding it would misrepresent the product's scope.
 */
const CHAT_SOURCES = [
  { id: "news", label: "News", available: true },
  { id: "social", label: "Social", available: false },
] as const;

type ChatSource = (typeof CHAT_SOURCES)[number]["id"];

interface Turn {
  /** Stable key. Sequence number, not a random id, so it is deterministic. */
  key: number;
  query: string;
  /** Null while the request is in flight. */
  response: ChatResponse | null;
  /** This turn's map sequence, empty until the response lands. */
  mapEvents: readonly ChatMapEvent[];
  /**
   * How many words of `response.answer` are shown so far. 0 the instant the
   * response lands, climbing to the full word count as the simulated
   * generation plays out; meaningless (and unused) while `response` is null.
   */
  revealedWords: number;
  error: string | null;
}

/** Roughly how long the simulated generation takes for an answer this long. */
function revealDurationMs(wordCount: number): number {
  return Math.max(2200, wordCount * 90);
}

export function IntelChatPanel() {
  const [source, setSource] = useState<ChatSource>("news");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);
  // Cancels whichever turn's reveal loop is currently running, so starting a
  // new question can never leave a stale rAF loop fighting the new one over
  // the shared chat-map-sequence store (only one turn should ever drive it).
  const cancelRevealRef = useRef<() => void>(() => {});

  // Follow the tail as turns arrive. Depends on the turn count rather than the
  // array so a mutation within an existing turn (the response landing) also
  // scrolls, which is exactly when the newest content grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, pending]);

  // Stop the reveal loop if the panel unmounts mid-animation (e.g. the user
  // collapses Chat back onto the shared rail -- GeoLibre unmounts a
  // shared-rail panel's content while collapsed, it is not just hidden).
  // Deliberately does not clear the map sequence: the sequence is meant to sit
  // on the map as standing context until the next question, not disappear the
  // moment the panel that started it closes.
  useEffect(() => () => cancelRevealRef.current(), []);

  /**
   * Plays the simulated generation for one turn: reveals `response.answer`
   * word by word while stepping `ChatMapPlayback` through `mapEvents`, both
   * driven off the same 0..1 progress ramp so they finish together. See the
   * module docstring for what this stands in for and why.
   */
  const playReveal = (key: number, answer: string, mapEvents: readonly ChatMapEvent[]) => {
    cancelRevealRef.current();
    setChatMapSequence(mapEvents);

    const words = answer.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const durationMs = revealDurationMs(words.length);
    const startedAt = performance.now();
    let cancelled = false;
    let frame = 0;

    const tick = () => {
      if (cancelled) return;
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      setTurns((current) =>
        current.map((turn) =>
          turn.key === key
            ? { ...turn, revealedWords: Math.round(progress * words.length) }
            : turn,
        ),
      );
      if (mapEvents.length > 0) {
        setChatMapActiveIndex(Math.min(mapEvents.length - 1, Math.floor(progress * mapEvents.length)));
      }
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    cancelRevealRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  };

  const submit = async () => {
    const query = draft.trim();
    if (!query || pending) return;
    const key = nextKey.current++;
    setTurns((current) => [
      ...current,
      { key, query, response: null, mapEvents: [], revealedWords: 0, error: null },
    ]);
    setDraft("");
    setPending(true);
    try {
      const { response, mapEvents } = await sendChatMessage(query);
      setTurns((current) =>
        current.map((turn) => (turn.key === key ? { ...turn, response, mapEvents } : turn)),
      );
      playReveal(key, response.answer, mapEvents);
    } catch (cause) {
      setTurns((current) =>
        current.map((turn) =>
          turn.key === key
            ? {
                ...turn,
                error:
                  cause instanceof Error ? cause.message : "Request failed",
              }
            : turn
        )
      );
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  // Enter sends, Shift+Enter breaks the line. Standard for a chat composer, and
  // worth the explicit handler because this is a Textarea (multi-line answers to
  // long analytical questions) rather than an Input.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="intel-hairline flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        {CHAT_SOURCES.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={!option.available}
            aria-pressed={source === option.id}
            onClick={() => setSource(option.id)}
            title={
              option.available
                ? undefined
                : `${option.label} retrieval is not built yet`
            }
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              source === option.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
              !option.available &&
                "cursor-not-allowed opacity-40 hover:text-muted-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/30">
            {turns.map((turn) => (
              <TurnView key={turn.key} turn={turn} />
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="intel-hairline shrink-0 border-t bg-card/60 p-2"
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={12000}
          placeholder="Ask about recent reporting…"
          aria-label="Question"
          className="min-h-0 resize-none border-0 bg-transparent px-1 py-1 text-xs shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          {/* Mirrors MAX_SUBMITTED_QUERY_CHARS in the service's chat schema.
                Shown only near the cap so it is a warning, not decoration. */}
          <span className="intel-numeral text-[10px] text-muted-foreground">
            {draft.length > 11_000 ? `${draft.length} / 12000` : ""}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={pending || draft.trim().length === 0}
            className="h-6 gap-1.5 px-2 text-[11px]"
          >
            <Send className="h-3 w-3" />
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MessageSquare className="h-5 w-5 text-muted-foreground/50" aria-hidden />
      <p className="text-xs text-muted-foreground">
        Ask a question about indexed reporting. Answers cite their sources.
      </p>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <li className="space-y-2 px-3 py-3">
      <p className="text-xs font-medium leading-snug text-foreground">
        {turn.query}
      </p>
      {turn.error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {turn.error}
        </p>
      ) : turn.response ? (
        <ResponseView response={turn.response} revealedWords={turn.revealedWords} />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          <span className="geoint-pulse">Retrieving…</span>
        </p>
      )}
    </li>
  );
}

function ResponseView({
  response,
  revealedWords,
}: {
  response: ChatResponse;
  revealedWords: number;
}) {
  // Sliced on whitespace, not characters, so a citation marker like "[1]" is
  // always revealed atomically -- never as a dangling "[" one frame before the
  // "1]" -- and so this can never split mid-word.
  const words = response.answer.split(/\s+/).filter(Boolean);
  const visibleText = words.slice(0, revealedWords).join(" ");
  const revealing = revealedWords < words.length;

  return (
    <div className="space-y-2">
      {/* Degradations first, above the answer. The service's contract is that a
          partial answer says so explicitly instead of looking complete, so
          burying this under the text would defeat the point of returning it. */}
      {response.degradations.length > 0 ? (
        <ul className="space-y-1 rounded border border-status-warning/30 bg-status-warning/10 px-2 py-1.5">
          {response.degradations.map((reason) => (
            <li
              key={reason}
              className="flex items-start gap-1.5 text-[10px] leading-snug"
            >
              <AlertTriangle
                className="intel-sev-high mt-px h-3 w-3 shrink-0"
                aria-hidden
              />
              <span className="text-foreground/90">{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <AnswerText text={visibleText} citations={response.citations} />
      {revealing ? (
        <span
          aria-hidden
          className="geoint-pulse inline-block h-3 w-1 translate-y-0.5 bg-primary"
        />
      ) : null}

      {/* Citations and provenance land once the reveal finishes, reading as
          "here is the answer, and here is what backs it up" rather than
          appearing fully formed while the answer above is still filling in. */}
      {!revealing && response.citations.length > 0 ? (
        <CitationList citations={response.citations} />
      ) : null}

      {!revealing ? <Provenance response={response} /> : null}
    </div>
  );
}

function CitationList({ citations }: { citations: readonly Citation[] }) {
  return (
    <ol className="space-y-1">
      {citations.map((citation) => (
        <li key={citation.id} className="flex gap-1.5">
          <span className="intel-numeral mt-px shrink-0 text-[10px] font-semibold text-primary">
            {citation.id}
          </span>
          <a
            href={citation.url}
            target="_blank"
            // `noreferrer` alongside `noopener`: these are third-party sources,
            // so the destination should not receive this console's URL.
            rel="noopener noreferrer"
            className="group min-w-0 flex-1"
          >
            <span className="flex items-start gap-1 text-[11px] leading-snug text-foreground group-hover:text-primary">
              <span className="min-w-0">{citation.title}</span>
              <ExternalLink
                className="mt-0.5 h-2.5 w-2.5 shrink-0 opacity-50"
                aria-hidden
              />
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
              {citation.snippet}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Pipeline provenance, collapsed by default.
 *
 * These are the `retrieval_metrics`, `routing_diagnostics`, and
 * `india_relevance` fields. They matter -- an analyst judging an answer wants to
 * know it came from 12 reranked candidates out of 248 and took the
 * infrastructure specialist route -- but they are not the answer, so they start
 * closed.
 *
 * Both metric objects are documented as open-shaped `dict[str, Any]`, so this
 * iterates whatever keys arrive instead of naming fields the pipeline is free to
 * change. Keys are de-snake-cased for display only; the raw key is never
 * assumed to exist.
 */
function Provenance({ response }: { response: ChatResponse }) {
  const entries: [string, unknown][] = [
    ...Object.entries(response.routing_diagnostics),
    ...Object.entries(response.retrieval_metrics),
  ];
  if (response.india_relevance) {
    entries.unshift(["india relevance", `L${response.india_relevance.level}`]);
  }
  if (entries.length === 0) return null;

  return (
    <details className="group">
      <summary className="intel-label flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
        {/* Points right when closed, down when open. `group-open:` reads the
            parent <details open> state, so the rotation needs no JS. */}
        <ChevronDown
          className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          aria-hidden
        />
        Provenance
      </summary>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {entries.map(([key, value]) => (
          <div key={key} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-[10px] text-muted-foreground">
              {key.replace(/_/g, " ")}
            </dt>
            <dd className="intel-numeral text-[10px] text-foreground">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
