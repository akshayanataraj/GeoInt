/**
 * The single seam between the intelligence console UI and the media service.
 *
 * News (chat, recent topics, country coordinates, session history/citations/
 * deletion) and Social (query, session deletion) are both real, following
 * `Fotress_SNSF/docs/MEDIA_SERVICE_FRONTEND_INTEGRATION_GUIDE.md` -- the
 * service's current frontend-integration doc, verified against its own
 * generated OpenAPI document. It **supersedes** the old
 * `NEWS_SERVICE_INTEGRATION_GUIDE.md` (predates user-service auth and the
 * Social module entirely; do not build against it, and do not add new
 * references to it below). News and Social are genuinely different
 * pipelines with different response envelopes (compare `ChatResponse` in
 * `contracts.ts` against `SocialQueryResponse` in `social-contracts.ts`) --
 * `IntelChatPanel.tsx`'s source switch calls one or the other, never both,
 * and each keeps its own session id.
 *
 * S2 Grid still returns fixture data after a short delay: `modules/s2/` on
 * the service is still a scaffold package with zero real routes (guide
 * §15.3), so there is nothing to call yet.
 *
 * The point of routing every panel through this one module is that wiring up
 * the rest of the backend later is a change *here* and nowhere else. Each
 * still-fixture function carries the exact method and path it will call, so
 * there is no guessing at that point.
 *
 * Two contract facts that shape the UI and are easy to get wrong later
 * (guide §3, §10.1):
 *
 * - **Every media endpoint needs a bearer token**, resolved three ways
 *   server-side (guide §3.1): a gateway-installed identity (inert, no gateway
 *   exists), a shared dev secret (every caller synthesized as `dev-user`), or
 *   real user-service verification (dormant on the currently-configured
 *   deployment). This client never holds that token: the deployment it talks
 *   to locks its CORS allowlist down to specific known origins (verified live
 *   -- every origin this app could plausibly be served from was rejected at
 *   the preflight), so a direct browser `fetch` cannot reach it at all
 *   regardless of the token. `nginx/default.conf`'s `/media/` location is
 *   what actually reaches it: a same-origin server-to-server proxy, which
 *   both sidesteps that CORS restriction (a browser-only mechanism -- the
 *   proxied request carries no Origin header) and injects the bearer token
 *   nginx-side (see `entrypoint.sh`'s `GEOLIBRE_MEDIA_API_URL`/
 *   `GEOLIBRE_MEDIA_API_TOKEN`), so it never enters the client bundle.
 * - **Chat does not stream, on either surface.** `ChatRequest` carries a
 *   `stream` field, but every handler is synchronous and returns a complete
 *   response; there is no SSE, no WebSocket, no chunked transfer anywhere in
 *   the service (guide §10.1). So `sendChatMessage` resolves once with a
 *   complete answer and the UI must not be built around token-by-token
 *   rendering. Both chat surfaces are also LLM-bound and routinely take tens
 *   of seconds, which is why every real call below carries
 *   `REQUEST_TIMEOUT_MS`.
 */

import type {
  ChatResponse,
  Citation,
  CountryMention,
  IntelErrorCode,
  MapLocation,
  NewsSessionHistory,
  NewsTopic,
} from "./contracts";
import { INTEL_ERROR_CODES } from "./contracts";
import type { ChatMapLocation } from "./map-events-contract";
import type { SocialQueryResponse } from "./social-contracts";
import type { S2Filters } from "./s2-filters";
import type { S2MapData, S2Series } from "./s2-contracts";
import { FIXTURE_S2_MAP, FIXTURE_S2_SERIES } from "./fixtures";

/**
 * The same-origin path `nginx/default.conf`'s `/media/` location proxies to
 * the media service (see this module's docstring for why a direct
 * cross-origin `fetch` cannot reach it at all on the currently-configured
 * deployment). Overridable via `VITE_MEDIA_API_BASE_URL` for a local
 * workflow that bypasses the proxy entirely -- e.g. a standalone deployment
 * with a permissive CORS allowlist, reachable directly -- in which case pair
 * it with `VITE_MEDIA_DEV_TOKEN` below, since nginx is not in the loop to
 * inject one.
 */
export const INTEL_API_BASE = import.meta.env.VITE_MEDIA_API_BASE_URL || "/media";

/**
 * Bearer token sent directly from the client -- only set when
 * `VITE_MEDIA_DEV_TOKEN` is provided, for the `VITE_MEDIA_API_BASE_URL`
 * bypass case above. The normal path (the same-origin proxy) needs no token
 * here at all: nginx injects it server-side, so this stays `undefined` and
 * `mediaFetch` sends no `Authorization` header of its own -- shipping one in
 * the client bundle regardless would defeat the entire reason the proxy
 * exists.
 */
const MEDIA_DEV_TOKEN: string | undefined = import.meta.env.VITE_MEDIA_DEV_TOKEN || undefined;

/**
 * True while a given panel is running on fixtures rather than the live
 * service. Only S2 is still a fixture; both chat pipelines (News and
 * Social) and everything else News-shaped below are real.
 */
export const INTEL_USING_FIXTURES = {
  chat: false,
  socialChat: false,
  recentTopics: false,
  countryMentions: false,
  s2: true,
} as const;

/**
 * Fixture latency. Long enough that a skeleton state is visibly exercised,
 * short enough not to be annoying in review.
 */
const FIXTURE_DELAY_MS = 450;

function delay<T>(value: T, ms = FIXTURE_DELAY_MS): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms);
  });
}

/**
 * Both chat surfaces are LLM-bound. The guide's §10.1 suggests 120s as a
 * starting point, but a real measured chat call against the currently-
 * configured deployment took ~180s end to end -- comfortably past that, and
 * past what "tens of seconds" implies. Set generously above the worst case
 * actually observed rather than the guide's generic floor; every non-fixture
 * call below is still aborted past this so a genuinely hung upstream request
 * cannot leave a turn spinning forever with no way to recover but a reload.
 * `nginx/default.conf`'s media-proxy `proxy_read_timeout` (entrypoint.sh) is
 * matched to the same value -- either one alone would still cut the request
 * off if the other were shorter.
 */
const REQUEST_TIMEOUT_MS = 600_000;

/**
 * A human-readable fallback per stable error code (`contracts.ts`'s
 * `INTEL_ERROR_CODES`), used as `IntelApiError.message` so every caller --
 * `IntelChatPanel`'s explicit catch, or a panel reading `useIntelResource`'s
 * generic `error.message` -- gets a message an analyst can read without
 * knowing the wire format. `unknown` and any code without an explicit entry
 * fall through to a generic message built from the raw code, matching this
 * guide's own framing of `unknown` as "a new server-side code cannot crash
 * the client" -- new codes degrade to plain text, not a blank error.
 */
const ERROR_MESSAGES: Partial<Record<IntelErrorCode, string>> = {
  authentication_required:
    "The media service rejected the configured access token. Check VITE_MEDIA_DEV_TOKEN.",
  authentication_not_configured:
    "The media service has no authentication configured on this deployment.",
  authentication_unavailable:
    "Couldn't verify access to the media service right now -- this is usually transient.",
  news_chat_not_configured: "The News assistant isn't configured on this deployment yet.",
  news_session_store_not_configured: "Conversation history isn't available on this deployment yet.",
  recent_news_not_configured: "Recent topics aren't configured on this deployment yet.",
  news_chat_failed: "The News assistant hit an unexpected error. Try again.",
  news_query_failed: "That request failed. Try again in a moment.",
  session_forbidden: "This conversation isn't available.",
  citations_not_found: "No sources are stored for this turn.",
};

function toIntelErrorCode(raw: string): IntelErrorCode {
  return (INTEL_ERROR_CODES as readonly string[]).includes(raw) ? (raw as IntelErrorCode) : "unknown";
}

/**
 * Thrown by every real (non-fixture) call below on a non-2xx response.
 * `code` is the parsed `detail.error` (guide §12.1's decision tree -- key off
 * this, never off `status` alone, since several distinct causes share `503`)
 * and `status` is kept alongside for a caller that does need the raw HTTP
 * status (e.g. a `422` validation body, which has no `detail.error` at all
 * and always coerces to `code: "unknown"`).
 */
export class IntelApiError extends Error {
  readonly code: IntelErrorCode;
  readonly status: number;

  constructor(status: number, code: IntelErrorCode) {
    super(ERROR_MESSAGES[code] ?? `Media service request failed (${status}): ${code}`);
    this.name = "IntelApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * `fetch` against `INTEL_API_BASE` with a `REQUEST_TIMEOUT_MS` abort -- every
 * real endpoint below goes through this rather than repeating the timeout
 * boilerplate per call site. Only attaches an `Authorization` header when
 * `MEDIA_DEV_TOKEN` is actually set (the `VITE_MEDIA_API_BASE_URL` bypass
 * case) -- on the normal same-origin-proxy path there is nothing to send;
 * nginx injects the real token itself.
 */
async function mediaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${INTEL_API_BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(MEDIA_DEV_TOKEN ? { Authorization: `Bearer ${MEDIA_DEV_TOKEN}` } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

/** `mediaFetch`, throwing `IntelApiError` on a non-2xx response and returning the parsed JSON body otherwise. */
async function mediaFetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await mediaFetch(path, init);
  if (!res.ok) throw new IntelApiError(res.status, await extractErrorCode(res));
  return res.json();
}

/**
 * `sendChatMessage`'s result.
 *
 * `response` is the real `ChatResponse` mirror, `map_locations` included.
 * `locations` is a separate, *mapped* field rather than just re-exposing
 * `response.map_locations` directly: the wire shape (`MapLocation`/
 * `MapMediaItem`, snake_case, no `kind`) is a mirror of the service's
 * Pydantic models, while `ChatMapPlayback`/`chat-map-sequence.ts` are built
 * against this app's own internal shape (`ChatMapLocation`/`ChatMediaItem`,
 * camelCase, `kind` required) -- keeping the boundary explicit here means
 * the wire mirror can track the service's actual field names verbatim
 * without leaking them into the playback code. See `toChatMapLocations`.
 */
export interface ChatMessageResult {
  response: ChatResponse;
  locations: readonly ChatMapLocation[];
}

/**
 * Maps the wire `MapLocation[]` onto this app's `ChatMapLocation[]`.
 *
 * - `kind` is always `"news"`: the service has no news/social distinction on
 *   a map item (`MapMediaItemOut` carries no `kind` field) because this
 *   pipeline is the News module only -- Social is still an empty scaffold.
 *   Revisit once a social-sourced item can appear here.
 * - `snippet`/`sourceUrl` fall back to `undefined` on an empty string so the
 *   UI's `if (item.snippet)`/`if (item.sourceUrl)` conditionals (which
 *   expect "field absent", not "field blank") behave correctly against the
 *   service's `_safe_text` default of `""` for a missing value.
 * - `timestamp` falls back to the *response's* own timestamp when a specific
 *   item has none (`_hit_timestamp` on the service returns `""` when no
 *   timestamp field exists on that hit at all) -- an approximation, but a
 *   real date beats rendering `Invalid Date`.
 * - `label` falls back to the coordinates themselves on the rare case every
 *   grouped item's location label was blank too (`_map_locations` on the
 *   service already prefers `action_location` over `action_country` over
 *   `""`) -- so a location is never shown with no visible name at all.
 */
function toChatMapLocations(
  wireLocations: readonly MapLocation[],
  responseTimestamp: string,
): ChatMapLocation[] {
  return wireLocations.map((location) => ({
    id: location.id,
    lat: location.lat,
    lng: location.lng,
    label: location.label || `${location.lat.toFixed(2)}, ${location.lng.toFixed(2)}`,
    items: location.items.map((item) => ({
      id: item.id,
      kind: "news",
      title: item.title,
      snippet: item.snippet || undefined,
      sourceUrl: item.source_url || undefined,
      timestamp: item.timestamp || responseTimestamp,
      cited: item.cited,
    })),
  }));
}

/** `POST /api/v1/media/news/chat` */
export async function sendChatMessage(
  query: string,
  sessionId?: string,
): Promise<ChatMessageResult> {
  const response = (await mediaFetchJson("/news/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId ?? null }),
  })) as ChatResponse;
  return { response, locations: toChatMapLocations(response.map_locations, response.timestamp) };
}

/**
 * `GET /api/v1/media/news/sessions/{session_id}/history` -- the prior turns
 * of an existing session, for restoring a conversation across a reload. See
 * `NewsSessionHistory`'s docstring for what does and does not survive: only
 * `answer_markdown` per turn, no citations/map/diagnostics. Two stores exist
 * server-side with different wrong-owner behavior (guide §5.5) -- an
 * in-memory deployment raises `403 session_forbidden`, a Postgres one
 * returns `200` with `turn_count: 0`. Callers should treat both the same
 * way: "this conversation isn't available", not distinguish them.
 */
export async function fetchNewsSessionHistory(sessionId: string): Promise<NewsSessionHistory> {
  return (await mediaFetchJson(`/news/sessions/${encodeURIComponent(sessionId)}/history`)) as NewsSessionHistory;
}

/**
 * `GET /api/v1/media/news/sessions/{session_id}/turns/{turn_id}/citations` --
 * a restored turn's citations, fetched lazily since `fetchNewsSessionHistory`
 * does not carry them. `404 citations_not_found` means "the turn has none
 * stored" (or does not exist -- the two are indistinguishable server-side),
 * which the guide is explicit is not an error state, so it resolves to `[]`
 * here rather than throwing -- callers do not need a special case for it.
 */
export async function fetchNewsTurnCitations(sessionId: string, turnId: string): Promise<Citation[]> {
  const res = await mediaFetch(
    `/news/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/citations`,
  );
  if (res.status === 404) {
    const code = await extractErrorCode(res);
    if (code === "citations_not_found") return [];
  }
  if (!res.ok) throw new IntelApiError(res.status, await extractErrorCode(res));
  const body = (await res.json()) as { citations: Citation[] };
  return body.citations;
}

/**
 * `DELETE /api/v1/media/news/sessions/{session_id}` -- idempotent, always
 * `200`; `cleared: false` means nothing matched (already gone, or not this
 * caller's). Best-effort from the UI's point of view: the local session id
 * is discarded either way once this resolves.
 */
export async function deleteNewsSession(sessionId: string): Promise<{ cleared: boolean }> {
  return (await mediaFetchJson(`/news/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  })) as { cleared: boolean };
}

/**
 * `DELETE /api/v1/media/news/sessions/{session_id}/turns/{turn_id}` --
 * idempotent; also removes the turn from the pipeline's own conversation
 * memory, which is the point: it is how a user retracts a bad follow-up
 * rather than just hiding it client-side while the server still "remembers"
 * it on the next turn.
 */
export async function deleteNewsTurn(
  sessionId: string,
  turnId: string,
): Promise<{ deleted: boolean }> {
  return (await mediaFetchJson(
    `/news/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
    { method: "DELETE" },
  )) as { deleted: boolean };
}

/**
 * `POST /api/v1/media/social/query` -- a genuinely different pipeline from
 * News, not a variant of it (see `social-contracts.ts`'s module docstring).
 * Unlike `sendChatMessage`, a normal (non-2xx-throwing) resolution here can
 * still be an in-band failure: check `response.success` before treating
 * `response.answer` as present (guide §12.1: "HTTP 200 + Social success ===
 * false -> inline error bubble"). Real HTTP-level errors (401/403/503/422)
 * still throw `IntelApiError` as usual via `mediaFetchJson`.
 */
export async function sendSocialQuery(
  query: string,
  sessionId?: string,
): Promise<SocialQueryResponse> {
  return (await mediaFetchJson("/social/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId ?? null }),
  })) as SocialQueryResponse;
}

/** `DELETE /api/v1/media/social/sessions/{session_id}` -- same idempotent shape as `deleteNewsSession`, a distinct route since Social owns its own session store. */
export async function deleteSocialSession(sessionId: string): Promise<{ cleared: boolean }> {
  return (await mediaFetchJson(`/social/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  })) as { cleared: boolean };
}

/** `DELETE /api/v1/media/social/sessions/{session_id}/turns/{turn_id}` -- same idempotent shape as `deleteNewsTurn`. */
export async function deleteSocialTurn(
  sessionId: string,
  turnId: string,
): Promise<{ deleted: boolean }> {
  return (await mediaFetchJson(
    `/social/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
    { method: "DELETE" },
  )) as { deleted: boolean };
}

/**
 * Pulls `{"detail": {"error": "<code>"}}` out of a failed response body, per
 * `contracts.ts`'s `INTEL_ERROR_CODES` (coerced through `toIntelErrorCode`, so
 * a code this client doesn't recognize yet -- the service is free to add one
 * -- lands on `"unknown"` rather than a `string` a caller might mis-type as a
 * known one). Falls back to `"unknown"` when the body is not that shape at
 * all (e.g. a `422` FastAPI validation body, which is a `detail` array, not
 * `{error: ...}` -- see the guide's §12.1 on why that shape must be
 * type-narrowed before reading `detail.error`, not assumed).
 */
async function extractErrorCode(res: Response): Promise<IntelErrorCode> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof (body as { detail?: unknown }).detail === "object" &&
      (body as { detail?: unknown }).detail !== null &&
      "error" in (body as { detail: Record<string, unknown> }).detail
    ) {
      return toIntelErrorCode(String((body as { detail: { error: unknown } }).detail.error));
    }
  } catch {
    // Body was not JSON (or not readable) -- fall through.
  }
  return "unknown";
}

/**
 * `GET /api/v1/media/news/recent?limit&country` -- independent of the chat
 * pipeline (this can work while `/chat` is `503`, and vice versa), and the
 * caller is discarded server-side, so results are identical for every user
 * (guide §6) -- safe to cache client-side per `(limit, country)` if that
 * becomes worth doing.
 */
export async function fetchRecentTopics(limit = 20, country?: string): Promise<NewsTopic[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (country) params.set("country", country);
  const body = (await mediaFetchJson(`/news/recent?${params}`)) as { topics: NewsTopic[] };
  return body.topics;
}

/**
 * `POST /api/v1/media/news/country/coordinates`
 *
 * Worth knowing before building on this: the server implementation is a regex
 * scan for country names over the given text, resolved against a compiled
 * offline table of 84 country aliases with hardcoded centroids -- no network,
 * no LLM, no database, and it never raises on unmatched text (blank or
 * unmatched input just yields zero countries). So it returns one point per
 * *country*, not per event, and carries no time information at all. Country
 * bubbles are plottable from it; an event-level track is not. Purely
 * deterministic and effectively instant (guide §12.5) -- no spinner needed.
 */
export async function extractCountryMentions(content: string): Promise<CountryMention[]> {
  const body = (await mediaFetchJson("/news/country/coordinates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  })) as { countries: CountryMention[] };
  return body.countries;
}

/**
 * `GET /api/s2/map` (target shape -- no endpoint yet, the service's
 * `modules/s2/` package is an empty scaffold). See `s2-contracts.ts`'s module
 * docstring for how closely this mirrors S2_GRID.md's documented response,
 * and its one deliberate deviation (`poly`'s coordinate order).
 *
 * `filters` (`s2-filters.ts`) stands in for the real `n`/`s`/`e`/`w`/`zoom`/
 * `date`/`roots`/`codes`/`countries` viewport-and-taxonomy query params --
 * simplified to what the fixture data can actually support (tier, a place
 * substring) rather than fabricating filterable taxonomy/country fields the
 * fixture cells/points don't carry. Applied client-side here as a stand-in
 * for what a real backend would do server-side; a cell has no place name of
 * its own to match `place` against, so that filter narrows `points` only --
 * `tiers` narrows both, since every cell and point already carries one.
 */
export async function fetchS2Map(filters: S2Filters): Promise<S2MapData> {
  const cells = FIXTURE_S2_MAP.cells.filter((cell) => filters.tiers.has(cell.tier)).map((cell) => ({ ...cell }));
  const placeQuery = filters.place.trim().toLowerCase();
  const points = FIXTURE_S2_MAP.points
    .filter((point) => filters.tiers.has(point.tier))
    .filter((point) => !placeQuery || point.place.toLowerCase().includes(placeQuery))
    .map((point) => ({ ...point }));
  return delay({
    ...FIXTURE_S2_MAP,
    cells,
    points,
    nLocations: points.length,
    nEvents: cells.reduce((sum, cell) => sum + cell.n, 0),
  });
}

/**
 * `GET /api/s2/series` -- the metrics panel's KPI/trend source, distinct from
 * `fetchS2Map`'s per-cell geometry (see `S2SeriesSummary`'s docstring). Only
 * `span` is threaded into the fixture response (it has nothing else to vary
 * against, being one static dataset); still accepts the full `S2Filters` so
 * the call site doesn't need a second, narrower parameter type for what is
 * conceptually "the same current selection" `fetchS2Map` reads.
 */
export async function fetchS2Series(filters: S2Filters): Promise<S2Series> {
  return delay({
    ...FIXTURE_S2_SERIES,
    span: filters.span,
    buckets: FIXTURE_S2_SERIES.buckets.map((bucket) => ({ ...bucket })),
  });
}
