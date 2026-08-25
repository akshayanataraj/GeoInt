/**
 * TypeScript mirrors of the media service's HTTP contract.
 *
 * Source of truth is the FastAPI service at
 * `Fotress_SNSF/services/news_and_social_media_service`, specifically the
 * Pydantic models under `src/media_service/modules/news/schemas/`. These are
 * hand-written mirrors rather than generated types because the service is still
 * being built and does not publish an OpenAPI artifact yet; when it does,
 * generate from that and delete this file.
 *
 * Field names and optionality are copied exactly, including the parts that look
 * like they should be tidied:
 *
 * - `lat`/`lng` (not `lon`/`longitude`), per `schemas/country.py`.
 * - `answer_markdown` on a history turn but `answer` on a chat response --
 *   `schemas/chat.py` has both spellings and they are different endpoints.
 * - Timestamps are `string`, not `Date`: the service emits ISO-8601 text and
 *   several of these fields are nullable or empty-string rather than absent.
 *
 * Renaming any of these on the client would silently break the wire format on
 * the day the real endpoints are connected, so they stay verbatim.
 */

/** `CitationOut` -- one piece of evidence backing an answer. */
export interface Citation {
  id: string;
  url: string;
  title: string;
  snippet: string;
}

/**
 * `IndiaRelevanceOut`. `level` is an integer band from the pipeline's India
 * router and `weight_guidance` is free text explaining how heavily the router
 * asked for India-specific sources to be weighted.
 */
export interface IndiaRelevance {
  level: number;
  weight_guidance: string;
}

/** `ChatResponse` from `POST /api/v1/media/news/chat`. */
export interface ChatResponse {
  session_id: string;
  turn_id: string | null;
  query: string;
  /** Markdown. */
  answer: string;
  citations: Citation[];
  india_relevance: IndiaRelevance | null;
  /**
   * Free-form pipeline counters (candidates retrieved, fusion/rerank sizes,
   * stage timings). Deliberately untyped: the service documents this as an open
   * `dict[str, Any]`, so the UI renders whatever keys arrive rather than
   * pinning a shape that the pipeline is free to change.
   */
  retrieval_metrics: Record<string, unknown>;
  /**
   * Explicit degradation reasons -- a missing feed, a skipped rerank, a
   * truncated time range. The service's contract is that a partial answer says
   * so here instead of quietly looking complete, so the UI must surface these
   * rather than treat them as debug noise.
   */
  degradations: string[];
  /** Which planner/router/specialist path the query took. Also open-shaped. */
  routing_diagnostics: Record<string, unknown>;
  timestamp: string;
}

/** `ConversationTurnOut` from the session-history endpoint. */
export interface ConversationTurn {
  turn_id: string;
  submitted_query: string;
  /** The planner's normalized rewrite of `submitted_query`. */
  resolved_query: string;
  answer_markdown: string;
  ok: boolean;
  failed_stage: string | null;
  error_text: string;
  created_at: string;
}

/** `TimelineEventOut` -- one dated step within a recent topic. */
export interface TimelineEvent {
  date: string | null;
  event: string;
  url: string;
}

/**
 * `NewsTopicOut` from `GET /api/v1/media/news/recent`.
 *
 * Note what is *not* here: no coordinates, on the topic or on its timeline
 * events. `country` is a name string. Placing a topic on the map today means
 * resolving that name to a centroid (see {@link CountryMention}), which is why
 * the event feed can plot a country bubble but cannot yet draw an event-to-event
 * track. See UI_REPURPOSE_PLAN.md §10.
 */
export interface NewsTopic {
  id: string;
  headline: string;
  snippet: string;
  url: string;
  source: string;
  country: string;
  published_at: string | null;
  timeline: TimelineEvent[];
}

/** `CountryOut` from `POST /api/v1/media/news/country/coordinates`. */
export interface CountryMention {
  name: string;
  display_name: string;
  coordinates: { lat: number; lng: number };
  mention_count: number;
}

/**
 * Error bodies are `{"detail": {"error": "<code>"}}`. The codes below are the
 * ones the news module actually raises today; `unknown` covers anything else so
 * a new server-side code cannot crash the client.
 *
 * `*_not_configured` (HTTP 503) is the common case during integration, not an
 * exceptional one: most of this platform's modules are unconfigured scaffolds,
 * so the UI treats it as a first-class "not wired up yet" state rather than an
 * error toast.
 */
export const INTEL_ERROR_CODES = [
  "news_chat_not_configured",
  "news_session_store_not_configured",
  "recent_news_not_configured",
  "authentication_not_configured",
  "authentication_required",
  "authentication_unavailable",
  "news_chat_failed",
  "news_query_failed",
  "session_forbidden",
  "citations_not_found",
  "unknown",
] as const;

export type IntelErrorCode = (typeof INTEL_ERROR_CODES)[number];

/**
 * Whether a failure means "this module has no backend configured yet" as
 * opposed to "the request went wrong". The distinction drives which of the two
 * empty states a panel shows, so it is derived from the code rather than
 * guessed from the HTTP status at each call site.
 */
export function isNotConfigured(code: IntelErrorCode): boolean {
  return code.endsWith("_not_configured");
}
