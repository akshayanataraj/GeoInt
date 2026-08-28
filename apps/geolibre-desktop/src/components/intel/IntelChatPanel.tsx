import { Button, Textarea, cn } from "@geolibre/ui";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ExternalLink,
  Send,
  Trash2,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  deleteNewsSession,
  deleteNewsTurn,
  deleteSocialSession,
  deleteSocialTurn,
  sendChatMessage,
  sendSocialQuery,
} from "../../lib/intel/client";
import type { ChatResponse, Citation } from "../../lib/intel/contracts";
import type {
  SocialCitation,
  SocialEvidenceSufficiency,
  SocialNotableQuote,
  SocialQueryResponse,
  SocialVolumeTrend,
} from "../../lib/intel/social-contracts";
import {
  advanceToLocation,
  beginMerge,
  clearChatMapSequence,
  finishToOverview,
  revealNextItem,
  setChatMapSequence,
} from "../../lib/intel/chat-map-sequence";
import type { ChatMapLocation } from "../../lib/intel/map-events-contract";
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
 * One component, not one per source, but the source selector genuinely picks
 * between two different pipelines today (News and Social), not a cosmetic
 * split -- `submit()` branches on `source` to call `sendChatMessage` or
 * `sendSocialQuery`, each with its own session id, its own response envelope
 * (`ChatResponse` vs `SocialQueryResponse` -- see `social-contracts.ts`'s
 * module docstring for how differently shaped they are), and its own render
 * path (`NewsResponseView`/`SocialResponseView` below). The platform's
 * architecture document is explicit that this is transitional: the per-module
 * chatbots collapse into a single `/api/v1/assistant/chat` eventually, listing
 * "module chatbot frontend components" as code to delete at that cutover. When
 * that lands, the selector and the per-pipeline branching go away and the rest
 * of this file (the reveal animation, the map playback, the turn list) stays.
 *
 * Not implemented, because the server does not offer it: real streaming. The
 * request schema carries a `stream` flag, but the handler is a synchronous
 * function returning a complete response with no SSE, so `sendChatMessage`/
 * `sendSocialQuery` resolve once with everything already in hand.
 *
 * What *is* implemented on top of that single round-trip is a client-side
 * *simulated* generation, run as two independent timelines once the response
 * lands (the answer text is real; the reveal's pacing is not -- there is
 * nothing to actually stream against):
 *
 * - The answer text reveals word by word (throttled to actual word-count
 *   changes, not every animation frame -- see `playTextReveal`).
 * - `ChatMapPlayback` plays the location sequence: fly to a location, fade in
 *   its items one at a time, merge them into one badge, fly to the next, and
 *   once every location has been visited, zoom out to fit them all with every
 *   badge clickable (see `chat-map-sequence.ts`'s `PlaybackPhase` and
 *   `playMapSequence` below). News-only: `locations` comes from the response's
 *   real `map_locations` field (`client.ts`'s `toChatMapLocations`), sourced
 *   from GDELT's already-resolved event coordinates on each cited hit -- see
 *   `contracts.ts`'s `MapLocation` for exactly what is and isn't guaranteed
 *   (not every citation resolves to a place, so this can legitimately be
 *   shorter than `citations`, or empty for a source-less/guardrail answer).
 *   Social carries no location data at all, so a Social turn never calls
 *   `playMapSequence` and the map's standing context is whatever the last
 *   News turn left there.
 *
 * The two run concurrently rather than off one shared progress number: the
 * map's sequence is a genuine state machine (reveal → merge → next location →
 * … → overview) with its own natural pacing, and forcing it to fit a single
 * 0..1 ramp shared with word count fought both animations at once. This
 * stands in for the real tool-calling flow the plan drafted
 * (`render_map_events`, UI_REPURPOSE_PLAN.md §10): a model with native
 * function-calling would call that tool mid-turn as it resolves each
 * location's evidence, and the frontend executor would upsert it into the map
 * as it arrives. There is no such model in the loop here -- this chat is a
 * plain fetch, not an agent loop, and GeoLibre's own tool-calling machinery
 * was removed with its AI Assistant -- so the reveal is played out against
 * the complete response instead of real incremental tool calls. The
 * animations are genuine; the "generation" they are timed to is not.
 *
 * Renders as bare content, no header or close button of its own: this panel is
 * mounted inside GeoLibre's shared Style rail (see `useRegisterAnalystChatPanel`
 * and its portal in `DesktopShell.tsx`), which supplies the title, collapse,
 * move, and close chrome uniformly for every panel docked there -- adding a
 * second header here would duplicate it.
 */

/** Which retrieval domain a question is put to -- News or Social, each a real, independently-wired pipeline (see this file's module docstring). */
const CHAT_SOURCES = [
  { id: "news", label: "News" },
  { id: "social", label: "Social" },
] as const;

type ChatSource = (typeof CHAT_SOURCES)[number]["id"];

/**
 * Tags a turn's response by which pipeline produced it, so `TurnView` can
 * dispatch to the right render path without re-deriving the source from the
 * response shape itself (both envelopes happen to carry a `session_id` and a
 * nullable `turn_id`, so a shape-only guard would be fragile).
 */
type TurnResponse =
  | { source: "news"; data: ChatResponse }
  | { source: "social"; data: SocialQueryResponse };

interface Turn {
  /** Stable key. Sequence number, not a random id, so it is deterministic. */
  key: number;
  /** Which pipeline this turn was submitted to -- fixed at submission time, independent of whatever `source` the selector is on by the time the response lands. */
  source: ChatSource;
  query: string;
  /** Null while the request is in flight. */
  response: TurnResponse | null;
  /** This turn's location sequence, empty until the response lands. Always empty for a Social turn -- see the module docstring. */
  locations: readonly ChatMapLocation[];
  /**
   * How many words of the answer are shown so far. 0 the instant the response
   * lands, climbing to the full word count as the simulated generation plays
   * out; meaningless (and unused) while `response` is null, or while a Social
   * turn's `response.data.success` is false (nothing to reveal).
   */
  revealedWords: number;
  error: string | null;
}

/** Roughly how long the simulated generation takes for an answer this long. */
function revealDurationMs(wordCount: number): number {
  return Math.max(2200, wordCount * 90);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * How long each phase of the map sequence holds, in milliseconds.
 * `settleBeforeReveal` is deliberately a little longer than
 * `ChatMapPlayback`'s `CAMERA_FLY_MS` (1100ms): items should start fading in
 * just after the camera actually lands, not while it is still mid-flight.
 *
 * A location's total dwell time is `settleBeforeReveal + betweenItems *
 * item-count + beforeMerge + mergeHold`, so it grows with how many items a
 * location has (fixtures now carry 4-5 each, see `fixtures.ts`). These values
 * were briefly halved (400/400/300/400) to fight a perceived "line moving
 * faster than the screen," which turned out to actually be this dwell time
 * dwarfing a much shorter flight -- that overcorrected into feeling rushed
 * once the flight itself (`CAMERA_FLY_MS`) was also slowed back down, so both
 * are back to a deliberate, readable pace together.
 */
const MAP_TIMING = {
  /** After flying to a location, before its first item fades in. */
  settleBeforeReveal: 1250,
  /** Between one item fading in and the next. */
  betweenItems: 550,
  /** After the last item, before the merge-into-one-badge transition starts. */
  beforeMerge: 600,
  /** How long the merge transition itself holds before moving on. */
  mergeHold: 800,
} as const;

export function IntelChatPanel() {
  const [source, setSource] = useState<ChatSource>("news");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);
  // Cancels whichever turn's text reveal is currently running, so starting a
  // new question can never leave a stale rAF loop writing into a turn that is
  // no longer the latest one.
  const cancelTextRevealRef = useRef<() => void>(() => {});
  // Cancels whichever turn's map sequence is currently mid-playback, so two
  // sequences can never fight over the shared chat-map-sequence store.
  const cancelMapSequenceRef = useRef<() => void>(() => {});
  // The backend's own session ids (guide §10.2), null until each pipeline's
  // first response assigns one. Passed back on that pipeline's later calls so
  // follow-up questions reuse its server-side conversation memory instead of
  // each one starting fresh -- omitting it is not "no session," it is "always
  // a new one." Two separate refs, not one: News and Social are genuinely
  // different pipelines with their own session stores (guide §3.3), so a
  // session id from one is meaningless to the other -- switching the source
  // selector mid-conversation must not smuggle one pipeline's session id into
  // a request against the other. In-memory only (not persisted to
  // localStorage): a reload starts genuinely new sessions rather than
  // attempting to restore them, since the guide's own §5.1 is explicit that a
  // restored News turn recovers only `answer_markdown` -- no citations, map
  // locations, or diagnostics -- so silently rehydrating would present old
  // turns as if they were as complete as a live one.
  const newsSessionIdRef = useRef<string | null>(null);
  const socialSessionIdRef = useRef<string | null>(null);

  // Follow the tail as turns arrive. Depends on the turn count rather than the
  // array so a mutation within an existing turn (the response landing) also
  // scrolls, which is exactly when the newest content grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, pending]);

  // Stop both timelines if the panel unmounts mid-animation (e.g. the user
  // collapses Chat back onto the shared rail -- GeoLibre unmounts a
  // shared-rail panel's content while collapsed, it is not just hidden).
  // Deliberately does not clear the map sequence itself: it is meant to sit on
  // the map as standing context until the next question, not disappear the
  // moment the panel that started it closes.
  useEffect(() => {
    return () => {
      cancelTextRevealRef.current();
      cancelMapSequenceRef.current();
    };
  }, []);

  /**
   * Reveals `answer` word by word for turn `key`. Throttled to only write
   * state when the *rounded* word count actually changes -- word count climbs
   * far slower than 60fps for any answer this short, so updating on every
   * animation frame regardless (the previous version's bug) re-rendered the
   * whole turn list dozens of times for no visible change, which is what made
   * the panel feel laggy.
   */
  const playTextReveal = (key: number, answer: string) => {
    cancelTextRevealRef.current();
    const words = answer.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const durationMs = revealDurationMs(words.length);
    const startedAt = performance.now();
    let cancelled = false;
    let frame = 0;
    let lastRevealed = 0;

    const tick = () => {
      if (cancelled) return;
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      const revealed = Math.round(progress * words.length);
      if (revealed !== lastRevealed) {
        lastRevealed = revealed;
        setTurns((current) =>
          current.map((turn) => (turn.key === key ? { ...turn, revealedWords: revealed } : turn)),
        );
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    cancelTextRevealRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  };

  /**
   * Plays the location sequence: fly to each location, reveal its items one
   * at a time, merge them into one badge, move on -- then, once every
   * location has been visited, settle into the zoomed-out overview. See
   * `chat-map-sequence.ts`'s module docstring for the state machine this
   * drives and `ChatMapPlayback` for how each phase actually renders.
   */
  const playMapSequence = (locations: readonly ChatMapLocation[]) => {
    cancelMapSequenceRef.current();
    setChatMapSequence(locations);
    if (locations.length === 0) return;

    let cancelled = false;
    cancelMapSequenceRef.current = () => {
      cancelled = true;
    };

    (async () => {
      for (let index = 0; index < locations.length; index++) {
        if (cancelled) return;
        advanceToLocation(index);
        await sleep(MAP_TIMING.settleBeforeReveal);
        const location = locations[index];
        for (let item = 0; item < location.items.length; item++) {
          if (cancelled) return;
          revealNextItem();
          await sleep(MAP_TIMING.betweenItems);
        }
        if (cancelled) return;
        await sleep(MAP_TIMING.beforeMerge);
        beginMerge();
        await sleep(MAP_TIMING.mergeHold);
      }
      if (!cancelled) finishToOverview();
    })();
  };

  const submit = async () => {
    const query = draft.trim();
    if (!query || pending) return;
    const key = nextKey.current++;
    const turnSource = source;
    setTurns((current) => [
      ...current,
      { key, source: turnSource, query, response: null, locations: [], revealedWords: 0, error: null },
    ]);
    setDraft("");
    setPending(true);
    try {
      if (turnSource === "news") {
        const { response, locations } = await sendChatMessage(query, newsSessionIdRef.current ?? undefined);
        newsSessionIdRef.current = response.session_id;
        setTurns((current) =>
          current.map((turn) =>
            turn.key === key ? { ...turn, response: { source: "news", data: response }, locations } : turn,
          ),
        );
        playTextReveal(key, response.answer);
        playMapSequence(locations);
      } else {
        const response = await sendSocialQuery(query, socialSessionIdRef.current ?? undefined);
        socialSessionIdRef.current = response.session_id;
        setTurns((current) =>
          current.map((turn) => (turn.key === key ? { ...turn, response: { source: "social", data: response } } : turn)),
        );
        // `success: false` is an in-band failure, not a thrown error (guide
        // §12.1) -- `SocialResponseView` renders `response.error` itself, so
        // there is nothing to reveal or animate in that case.
        if (response.success && response.answer) {
          playTextReveal(key, response.answer);
        }
        // No map sequence for Social: it carries no location data at all
        // (see this file's module docstring), so the map's standing context
        // is left exactly as the last News turn left it.
      }
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

  /**
   * Retracts one turn (News guide §5.4 / Social guide §9.3) -- both from
   * this list and, best-effort, from the pipeline's own conversation memory
   * server-side, which is the actual point: an un-retracted turn would still
   * be read as context on the next chat call even after it disappeared from
   * the screen. Routes to whichever pipeline the turn actually belongs to
   * (`turn.response.source`), not the selector's *current* position -- a
   * turn submitted to News stays a News turn to delete even if the analyst
   * has since switched the source selector to Social. The server call's
   * failure is not surfaced -- a session already gone (403/404-shaped
   * outcomes both resolve the same way per the guide's §5.5) still means the
   * turn is exactly as gone from the user's point of view, so the local
   * removal proceeds either way.
   */
  const handleDeleteTurn = async (turn: Turn) => {
    setTurns((current) => current.filter((candidate) => candidate.key !== turn.key));
    if (!turn.response?.data.turn_id) return;
    try {
      if (turn.response.source === "news") {
        await deleteNewsTurn(turn.response.data.session_id, turn.response.data.turn_id);
      } else {
        await deleteSocialTurn(turn.response.data.session_id, turn.response.data.turn_id);
      }
    } catch {
      // Best-effort -- see docstring above.
    }
  };

  /**
   * Starts a fresh conversation: clears the local turn list and the
   * standing map sequence, and best-effort deletes *both* pipelines'
   * sessions server-side (News guide §5.3 / Social guide §9.2) so their
   * `session_id`s are released rather than left to expire on their own --
   * both, not just the currently-selected source, since a conversation may
   * have used both pipelines by the time the analyst resets it. Unlike the
   * panel-unmount cleanup above, this is a *user* decision to reset, so
   * clearing the map's standing context here (which that cleanup
   * deliberately does not do) is correct.
   */
  const handleNewConversation = async () => {
    const newsSessionId = newsSessionIdRef.current;
    const socialSessionId = socialSessionIdRef.current;
    newsSessionIdRef.current = null;
    socialSessionIdRef.current = null;
    cancelTextRevealRef.current();
    cancelMapSequenceRef.current();
    setTurns([]);
    clearChatMapSequence();
    await Promise.allSettled([
      newsSessionId ? deleteNewsSession(newsSessionId) : Promise.resolve(),
      socialSessionId ? deleteSocialSession(socialSessionId) : Promise.resolve(),
    ]);
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
            aria-pressed={source === option.id}
            onClick={() => setSource(option.id)}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              source === option.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
        {turns.length > 0 ? (
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            className="intel-label ms-auto rounded px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            New conversation
          </button>
        ) : null}
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
              <TurnView key={turn.key} turn={turn} onDelete={handleDeleteTurn} />
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
      <Bot className="h-5 w-5 text-muted-foreground/50" aria-hidden />
      <p className="text-xs text-muted-foreground">
        Ask a question about indexed reporting. Answers cite their sources.
      </p>
    </div>
  );
}

function TurnView({ turn, onDelete }: { turn: Turn; onDelete: (turn: Turn) => void }) {
  // Disabled while the turn has no `turn_id` yet (still in flight) or the
  // service never persisted one (News guide §4.2 / Social guide §10.3: "treat
  // null as this turn was not persisted, and disable the per-turn
  // citation/delete affordances for that bubble") -- there is nothing
  // server-side for the button to retract.
  const canDelete = Boolean(turn.response?.data.turn_id);
  return (
    <li className="group/turn space-y-2 px-3 py-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xs font-medium leading-snug text-foreground">
          {turn.query}
        </p>
        {canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(turn)}
            aria-label="Delete this turn"
            title="Delete this turn"
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/turn:opacity-100"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>
      {turn.error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {turn.error}
        </p>
      ) : turn.response?.source === "news" ? (
        <NewsResponseView response={turn.response.data} revealedWords={turn.revealedWords} />
      ) : turn.response?.source === "social" ? (
        <SocialResponseView response={turn.response.data} revealedWords={turn.revealedWords} />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          <span className="geoint-pulse">Retrieving…</span>
        </p>
      )}
    </li>
  );
}

/**
 * The original answer text truncated after its `count`-th whitespace-
 * separated word, preserving the source's own newlines and blank lines
 * exactly -- unlike `words.slice(0, count).join(" ")` (the previous
 * approach), which collapses every paragraph break, heading newline, and
 * list-item boundary into a single flat line. That destroys the Markdown
 * structure `AnswerText` needs to tell a heading from a paragraph from a
 * list item, permanently -- not just mid-reveal: `.join(" ")` is what the
 * caller kept using even once `count` reached the full word count, so the
 * *finished* answer never actually reached `AnswerText` as real Markdown
 * either, which is why headings/lists/paragraphs kept rendering as a single
 * flattened blob.
 */
function revealedPrefix(text: string, count: number): string {
  if (count <= 0) return "";
  const wordPattern = /\S+/g;
  let seen = 0;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    seen++;
    if (seen >= count) {
      return text.slice(0, match.index + match[0].length);
    }
  }
  return text;
}

/**
 * Whether this turn is the guardrail short-circuit path (guide §4.3):
 * a deterministic, network-free canned reply for a greeting/refusal/etc.,
 * with no retrieval having run at all. Only the first segment is checked --
 * `degradations` is an open-ended, colon-delimited list (guide §12.2), so
 * this must never be a full-string comparison against one exact value.
 */
function isGuardrailShortCircuit(response: ChatResponse): boolean {
  return response.degradations[0]?.startsWith("guardrail:direct_") ?? false;
}

/**
 * `routing_diagnostics.as_of`, read defensively -- the field is documented
 * as open-shaped (guide §12.3) and only *currently* guaranteed to be exactly
 * `{query_type, as_of}`, so this does not assume the key exists or is a
 * string even though it is today.
 */
function asOfLabel(response: ChatResponse): string | null {
  const value = response.routing_diagnostics.as_of;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function NewsResponseView({
  response,
  revealedWords,
}: {
  response: ChatResponse;
  revealedWords: number;
}) {
  // Word count only -- so a citation marker like "[1]" is always revealed
  // atomically, never as a dangling "[" one frame before the "1]" -- but the
  // actual visible slice comes from `revealedPrefix`, which walks the same
  // word boundaries without discarding the original whitespace between them.
  const words = response.answer.split(/\s+/).filter(Boolean);
  const visibleText = revealedPrefix(response.answer, revealedWords);
  const revealing = revealedWords < words.length;
  const guardrail = isGuardrailShortCircuit(response);
  const asOf = asOfLabel(response);

  // Which citation a clicked inline `[Cn]` chip (`AnswerText`'s
  // `onCitationClick`) most recently resolved to, so `CitationList` can
  // highlight and scroll to the matching entry below -- see that
  // component's docstring for why the two lists can legitimately disagree
  // on which *number* a given source is.
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null);
  const citationRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const registerCitationRef = (id: string, el: HTMLLIElement | null) => {
    if (el) citationRefs.current.set(id, el);
    else citationRefs.current.delete(id);
  };
  const handleCitationClick = (citationId: string) => {
    setHighlightedCitationId(citationId);
    citationRefs.current.get(citationId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="space-y-2">
      {/* Guardrail short-circuits are a normal answer, not a degraded one
          (guide §4.3) -- no warning styling, no partial-retrieval badge, no
          citation/provenance sections (both are empty anyway for this path,
          but skipping them here says so explicitly rather than relying on
          their own length checks below to make the point silently). */}
      {!guardrail && response.degradations.length > 0 ? (
        <DegradationsBadge degradations={response.degradations} />
      ) : null}

      <AnswerText
        text={visibleText}
        citations={response.citations}
        onCitationClick={handleCitationClick}
      />
      {revealing ? (
        <span
          aria-hidden
          className="geoint-pulse inline-block h-3 w-1 translate-y-0.5 bg-primary"
        />
      ) : null}

      {/* "As of <date>" is the planner's own recency anchor (guide §12.3) --
          cheap and honest to show next to the answer rather than buried in
          the collapsed Provenance disclosure below. */}
      {!revealing && asOf ? (
        <p className="intel-numeral text-[10px] text-muted-foreground">As of {asOf}</p>
      ) : null}

      {/* Citations and provenance land once the reveal finishes, reading as
          "here is the answer, and here is what backs it up" rather than
          appearing fully formed while the answer above is still filling in. */}
      {!revealing && response.citations.length > 0 ? (
        <NewsCitationList
          citations={response.citations}
          highlightedId={highlightedCitationId}
          registerRef={registerCitationRef}
        />
      ) : null}

      {!revealing ? <NewsProvenance response={response} /> : null}
    </div>
  );
}

/**
 * A collapsed disclosure rather than an always-open alert box: the guide's
 * §12.2 recommendation is explicit that a non-empty `degradations` "does not
 * mean the answer is invalid... Recommended treatment: a subtle 'partial
 * retrieval' badge that expands to the raw list... Never render these
 * strings as a user-facing error." The raw entries are pipeline-internal
 * shorthand (e.g. `vector_search:skipped:disabled`) an analyst may still
 * want to see, but they should not compete with the answer for attention by
 * default.
 */
function DegradationsBadge({ degradations }: { degradations: readonly string[] }) {
  return (
    <details className="group rounded border border-status-warning/25 bg-status-warning/5 px-2 py-1">
      <summary className="intel-label flex cursor-pointer list-none items-center gap-1.5 text-status-warning">
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
        Partial retrieval
        <ChevronDown
          className="ms-auto h-3 w-3 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <ul className="mt-1 space-y-0.5">
        {degradations.map((reason) => (
          <li key={reason} className="intel-numeral text-[10px] leading-snug text-foreground/80">
            {reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function NewsCitationList({
  citations,
  highlightedId,
  registerRef,
}: {
  citations: readonly Citation[];
  /** The citation an inline `[Cn]` chip most recently resolved to, or null. */
  highlightedId: string | null;
  registerRef: (id: string, el: HTMLLIElement | null) => void;
}) {
  return (
    <ol className="space-y-1">
      {citations.map((citation, index) => (
        <li
          key={citation.id}
          ref={(el) => registerRef(citation.id, el)}
          className={cn(
            "flex gap-1.5 rounded transition-colors",
            highlightedId === citation.id && "bg-primary/10 ring-1 ring-primary/30",
          )}
        >
          {/* Position in this list, 1-based -- not the inline `[Cn]` marker
              number. The two can legitimately differ: `citations` is the
              full evidence pool in prompt order (guide §4.2), while a
              marker's number comes from the Sources block's own citation
              order, so the same source can be "first cited" but third in
              this list. Clicking a marker still scrolls/highlights the
              right entry regardless of what number is shown here. */}
          <span className="intel-numeral mt-px shrink-0 text-[10px] font-semibold text-primary">
            {index + 1}
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
 * closed. `india_relevance.weight_guidance` gets its own prose line above the
 * key/value grid rather than folding into it: it is free text explaining how
 * heavily the router asked for India-specific sources to be weighted, not a
 * short scalar like everything else here, so cramming it into the same
 * numeral-styled `dl` row would wrap badly and read as a stray value.
 *
 * Both metric objects are documented as open-shaped `dict[str, Any]`, so this
 * iterates whatever keys arrive instead of naming fields the pipeline is free to
 * change. Keys are de-snake-cased for display only; the raw key is never
 * assumed to exist.
 */
function NewsProvenance({ response }: { response: ChatResponse }) {
  const entries: [string, unknown][] = [
    ...Object.entries(response.routing_diagnostics),
    ...Object.entries(response.retrieval_metrics),
  ];
  if (response.india_relevance) {
    entries.unshift(["india relevance level", `L${response.india_relevance.level}`]);
  }
  const weightGuidance = response.india_relevance?.weight_guidance || null;
  if (entries.length === 0 && !weightGuidance) return null;

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
      {weightGuidance ? (
        <p className="mt-1.5 text-[10px] leading-snug text-foreground/80">{weightGuidance}</p>
      ) : null}
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

function SocialResponseView({
  response,
  revealedWords,
}: {
  response: SocialQueryResponse;
  revealedWords: number;
}) {
  // `success: false` is an in-band failure (guide §12.1), not a thrown
  // error -- `error`/`error_id` are a fixed, user-safe message plus a
  // correlation id for support, and every content field is otherwise empty.
  if (!response.success) {
    return (
      <p role="alert" className="text-[11px] text-destructive">
        {response.error ?? "Something went wrong handling that request."}
        {response.error_id ? (
          <span className="intel-numeral ms-1 text-muted-foreground">({response.error_id})</span>
        ) : null}
      </p>
    );
  }

  const answer = response.answer ?? "";
  const words = answer.split(/\s+/).filter(Boolean);
  const visibleText = revealedPrefix(answer, revealedWords);
  const revealing = revealedWords < words.length;

  return (
    <div className="space-y-2">
      {/* Absent (null) for "listing"/"chitchat" routes; a first-class
          caveat for "analysis" (guide §8's own framing: "the pipeline
          telling you the conclusion is weakly supported"). */}
      {response.evidence_sufficiency && response.evidence_sufficiency !== "sufficient" ? (
        <SocialEvidenceCaveat sufficiency={response.evidence_sufficiency} />
      ) : null}

      {/* Social pre-linkifies every `[n]` marker into a real Markdown link
          server-side (`citation_check.linkify_markers`, guide §11.3) --
          `citations={[]}` here is deliberate, not a gap: unlike News there is
          no Sources-block doc-id join to do, so AnswerText's own
          citation-marker rewrite has nothing to resolve and the pre-existing
          links render through its plain "real link in the answer body"
          branch as-is. */}
      <AnswerText text={visibleText} citations={[]} />
      {revealing ? (
        <span
          aria-hidden
          className="geoint-pulse inline-block h-3 w-1 translate-y-0.5 bg-primary"
        />
      ) : null}

      {!revealing && response.citations.length > 0 ? (
        <SocialCitationList citations={response.citations} />
      ) : null}
      {!revealing && response.notable_quotes.length > 0 ? (
        <SocialNotableQuotes quotes={response.notable_quotes} />
      ) : null}
      {!revealing && response.volume_trend ? <SocialVolumeTrendSection trend={response.volume_trend} /> : null}
      {!revealing ? <SocialProvenance response={response} /> : null}
    </div>
  );
}

function SocialEvidenceCaveat({ sufficiency }: { sufficiency: SocialEvidenceSufficiency }) {
  return (
    <p className="rounded border border-status-warning/25 bg-status-warning/5 px-2 py-1 text-[10px] leading-snug text-status-warning">
      {sufficiency === "insufficient" ? "Insufficient evidence" : "Thin evidence"} -- the pipeline
      flagged this conclusion as weakly supported by what it found.
    </p>
  );
}

/**
 * Social's own evidence list, a distinct component from News's
 * `NewsCitationList` rather than a shared one: the fields are genuinely
 * different (`platform`/`pk`/`author`/`quote_or_summary`, no `id`/`title`),
 * and `url`/`author`/`timestamp` are nullable here in a way News's `Citation`
 * never is (`social-contracts.ts`'s `SocialCitation` mirrors the Pydantic
 * model exactly, including that gap). No click-to-highlight wiring like
 * News's list has: Social's markers are already real links in the answer
 * body (see `SocialResponseView`'s docstring), so there is no marker click
 * to bind a highlight to here.
 */
function SocialCitationList({ citations }: { citations: readonly SocialCitation[] }) {
  return (
    <ol className="space-y-1">
      {citations.map((citation, index) => (
        <li key={citation.pk} className="flex gap-1.5">
          <span className="intel-numeral mt-px shrink-0 text-[10px] font-semibold text-primary">
            {index + 1}
          </span>
          {citation.url ? (
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group min-w-0 flex-1"
            >
              <SocialCitationBody citation={citation} className="group-hover:text-primary" />
            </a>
          ) : (
            <div className="min-w-0 flex-1">
              <SocialCitationBody citation={citation} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function SocialCitationBody({
  citation,
  className,
}: {
  citation: SocialCitation;
  className?: string;
}) {
  return (
    <>
      <span className={cn("flex items-start gap-1 text-[11px] leading-snug text-foreground", className)}>
        <span className="min-w-0">
          {citation.author ?? "Unknown"} · {citation.platform}
        </span>
        {citation.url ? (
          <ExternalLink className="mt-0.5 h-2.5 w-2.5 shrink-0 opacity-50" aria-hidden />
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
        {citation.quote_or_summary}
      </span>
    </>
  );
}

/**
 * A collapsed disclosure, same reasoning as News's evidence -- useful for
 * analyst trust, noise in the main flow (guide §8's own framing for
 * `notable_quotes` specifically).
 */
function SocialNotableQuotes({ quotes }: { quotes: readonly SocialNotableQuote[] }) {
  return (
    <details className="group rounded border border-border/40 bg-card/60 px-2 py-1">
      <summary className="intel-label flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground">
        Notable quotes
        <ChevronDown
          className="ms-auto h-3 w-3 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <ul className="mt-1.5 space-y-1.5">
        {quotes.map((quote, index) => (
          <li key={`${quote.platform}-${quote.pk}-${index}`} className="text-[10px] leading-snug">
            <p className="italic text-foreground/90">&ldquo;{quote.quote}&rdquo;</p>
            <p className="mt-0.5 text-muted-foreground">
              {quote.author ?? "Unknown"} · {quote.platform}
              {quote.reason ? ` -- ${quote.reason}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Social's own provenance disclosure -- `route` and the "how this answer was
 * checked" notes (`revisions_made`/`unsupported_claims_removed`, guide §8's
 * own suggested placement for both). The volume-trend numbers get their own
 * visible section (`SocialVolumeTrendSection`) rather than living here --
 * they are a real chartable dataset, not a debug metric, so burying them in
 * a collapsed disclosure would undersell them. `needs_analysis` is
 * deliberately not shown at all: it is `true` iff `route === "analysis"`
 * (`orchestrator.py`'s own construction), so a separate field for it would
 * just repeat what `route` already says.
 */
function SocialProvenance({ response }: { response: SocialQueryResponse }) {
  const entries: [string, string][] = [];
  if (response.route) entries.push(["route", response.route]);
  const checks = [...response.revisions_made, ...response.unsupported_claims_removed];
  if (entries.length === 0 && checks.length === 0) return null;

  return (
    <details className="group">
      <summary className="intel-label flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
        <ChevronDown
          className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          aria-hidden
        />
        Provenance
      </summary>
      {entries.length > 0 ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {entries.map(([key, value]) => (
            <div key={key} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-[10px] text-muted-foreground">{key}</dt>
              <dd className="intel-numeral text-[10px] text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {checks.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {checks.map((item) => (
            <li key={item} className="text-[10px] leading-snug text-foreground/80">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/**
 * Headline numbers plus the two Social volume charts: a day-by-day trend
 * (`SocialVolumeTrendChart`) and a per-platform breakdown
 * (`SocialPlatformBreakdown`). A visible section, not a collapsed
 * disclosure -- unlike `SocialProvenance`'s debug-flavoured entries, this is
 * itself the answer to a class of question ("is this growing, and where"),
 * so it stays open by default.
 */
function SocialVolumeTrendSection({ trend }: { trend: SocialVolumeTrend }) {
  const platformEntries = Object.entries(trend.by_platform_totals).filter(([, count]) => count > 0);
  return (
    <div className="space-y-2 rounded border border-border/40 bg-card/60 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="intel-label text-muted-foreground">Volume trend</p>
        <p className="intel-numeral text-[10px] text-muted-foreground">
          {trend.total_matches.toLocaleString()} matches
          {trend.growth_rate_pct !== 0 ? (
            <span className={trend.growth_rate_pct > 0 ? "text-status-warning" : ""}>
              {" "}
              ({trend.growth_rate_pct > 0 ? "+" : ""}
              {trend.growth_rate_pct.toFixed(1)}%)
            </span>
          ) : null}
        </p>
      </div>
      {trend.daily_totals.length > 0 ? <SocialVolumeTrendChart daily={trend.daily_totals} /> : null}
      {platformEntries.length > 0 ? <SocialPlatformBreakdown entries={platformEntries} /> : null}
    </div>
  );
}

/**
 * Day-by-day activity, charted with a real date-based x-axis rather than one
 * point per index -- `daily_totals` is capped to the earliest
 * `MAX_DAILY_BUCKETS_RETURNED` (60, `tools/analytics_tools.py`) active days
 * server-side, so it very often spans years with long silent gaps between
 * points (confirmed against a live response: 60 points from 2011 through
 * 2017, out of `daily_bucket_count` active days total across the whole
 * corpus). Spacing points evenly by index would flatten those gaps into
 * looking like a continuous recent trend, which is exactly wrong; an honest
 * chart has to let the gaps show. The caption below states the truncation
 * explicitly rather than let "60 points" read as "the whole trend."
 *
 * Single series, one hue (`text-primary`) -- per the dataviz method, a
 * magnitude-over-time series with no second series to distinguish needs no
 * categorical palette, and the panel title already names what it is, so no
 * legend. A pointer-tracked crosshair + tooltip is the interaction the
 * method calls for on any line/area chart; exact values are also always
 * available via the tooltip since the SVG shape alone only communicates
 * relative magnitude, not precise counts.
 */
function SocialVolumeTrendChart({ daily }: { daily: readonly { date: string; count: number }[] }) {
  const VIEW_WIDTH = 300;
  const VIEW_HEIGHT = 56;
  const PAD = 4;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const timestamps = daily.map((point) => new Date(`${point.date}T00:00:00Z`).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const spanT = Math.max(1, maxT - minT);
  const maxCount = Math.max(1, ...daily.map((point) => point.count));

  const xFor = (t: number) => PAD + ((t - minT) / spanT) * (VIEW_WIDTH - PAD * 2);
  const yFor = (count: number) => VIEW_HEIGHT - PAD - (count / maxCount) * (VIEW_HEIGHT - PAD * 2);
  const coords = timestamps.map((t, i): [number, number] => [xFor(t), yFor(daily[i].count)]);

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const areaPath =
    coords.length > 1
      ? `${linePath} L${coords[coords.length - 1][0].toFixed(2)} ${VIEW_HEIGHT - PAD} ` +
        `L${coords[0][0].toFixed(2)} ${VIEW_HEIGHT - PAD} Z`
      : "";

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || coords.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach(([x], index) => {
      const dist = Math.abs(x - relX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = index;
      }
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex !== null ? daily[hoverIndex] : null;
  const hoveredCoord = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="h-14 w-full cursor-crosshair touch-none"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Activity by day, ${daily.length} sample days from ${daily[0]?.date} to ${daily[daily.length - 1]?.date}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {areaPath ? <path d={areaPath} className="fill-primary/15" /> : null}
          <path
            d={linePath}
            className="fill-none stroke-primary"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {hoveredCoord ? (
            <>
              <line
                x1={hoveredCoord[0]}
                x2={hoveredCoord[0]}
                y1={PAD}
                y2={VIEW_HEIGHT - PAD}
                className="stroke-border"
                strokeWidth={1}
              />
              <circle
                cx={hoveredCoord[0]}
                cy={hoveredCoord[1]}
                r={2.5}
                className="fill-primary stroke-card"
                strokeWidth={1}
              />
            </>
          ) : null}
        </svg>
        {hovered && hoveredCoord ? (
          <div
            aria-hidden
            className="intel-hairline pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded border bg-card px-1.5 py-1 shadow-md"
            style={{
              left: `${(hoveredCoord[0] / VIEW_WIDTH) * 100}%`,
              top: `${(hoveredCoord[1] / VIEW_HEIGHT) * 100}%`,
            }}
          >
            <p className="intel-numeral text-[10px] font-semibold text-foreground">
              {hovered.count.toLocaleString()}
            </p>
            <p className="text-[9px] text-muted-foreground">{hovered.date}</p>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
        {daily.length} active days shown, earliest first -- the service caps this series server-side.
      </p>
    </div>
  );
}

/**
 * Per-platform share of the same volume-trend query, ranked highest first.
 * One hue, not a categorical palette per platform: every bar encodes the
 * same measure (mention count) against the same category axis (the label
 * text), so distinguishing bars by color would encode nothing the label
 * doesn't already -- textbook case for a single-hue ranked bar list per the
 * dataviz method, and it sidesteps needing 10 distinguishable categorical
 * hues for what the platform registry could grow past anyway.
 */
function SocialPlatformBreakdown({ entries }: { entries: readonly [string, number][] }) {
  const ranked = [...entries].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 1;
  return (
    <ul className="space-y-1">
      {ranked.map(([table, count]) => (
        <li key={table} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-[10px] text-muted-foreground">
            {table.replace(/_/g, " ")}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="intel-numeral w-12 shrink-0 text-end text-[10px] text-foreground">
            {count.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
