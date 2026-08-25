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
 * Not implemented, because the server does not offer it: streaming. The request
 * schema carries a `stream` flag, but the handler is a synchronous function
 * returning a complete response with no SSE, so a turn resolves once. Nothing
 * here should be restructured around incremental tokens until that changes.
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
  error: string | null;
}

export function IntelChatPanel() {
  const [source, setSource] = useState<ChatSource>("news");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);

  // Follow the tail as turns arrive. Depends on the turn count rather than the
  // array so a mutation within an existing turn (the response landing) also
  // scrolls, which is exactly when the newest content grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, pending]);

  const submit = async () => {
    const query = draft.trim();
    if (!query || pending) return;
    const key = nextKey.current++;
    setTurns((current) => [
      ...current,
      { key, query, response: null, error: null },
    ]);
    setDraft("");
    setPending(true);
    try {
      const response = await sendChatMessage(query);
      setTurns((current) =>
        current.map((turn) => (turn.key === key ? { ...turn, response } : turn))
      );
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
        <ResponseView response={turn.response} />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          <span className="geoint-pulse">Retrieving…</span>
        </p>
      )}
    </li>
  );
}

function ResponseView({ response }: { response: ChatResponse }) {
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

      <AnswerText text={response.answer} citations={response.citations} />

      {response.citations.length > 0 ? (
        <CitationList citations={response.citations} />
      ) : null}

      <Provenance response={response} />
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
