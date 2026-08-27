/**
 * The single seam between the intelligence console UI and the media service.
 *
 * `sendChatMessage` performs a real network request against the News chat
 * endpoint, following `Fotress_SNSF/docs/NEWS_SERVICE_INTEGRATION_GUIDE.md`
 * (the News module's own frontend-integration doc -- authoritative over
 * anything inferred from reading the backend's source directly). Every other
 * function here still returns fixture data after a short delay, matching
 * their module's actual backend state (Social/Monitoring/S2/Reporting/
 * Feedback are empty scaffolds per that same guide's §6) so panels exercise
 * their real loading and error states instead of rendering instantly from a
 * constant.
 *
 * The point of routing every panel through this one module is that wiring up
 * the rest of the backend later is a change *here* and nowhere else. Each
 * still-fixture function carries the exact method and path it will call, so
 * there is no guessing at that point.
 *
 * Two contract facts that shape the UI and are easy to get wrong later
 * (guide §2, §5.2):
 *
 * - **Every media endpoint needs a bearer token.** There is no real identity
 *   service (`user_service`) yet, so the backend accepts one fixed
 *   shared-secret dev token instead (`MEDIA_DEV_BEARER_TOKEN` on its side,
 *   `VITE_MEDIA_DEV_TOKEN`/the hardcoded default below on this one) -- every
 *   caller is the same synthetic `dev-user`, not real per-user auth. Replace
 *   this with a token from `AuthGate` once `user_service` exists.
 * - **Chat does not stream.** `ChatRequest` carries a `stream` field, but the
 *   handler is a synchronous `def` returning a whole `ChatResponse`; there is
 *   no SSE. So `sendChatMessage` resolves once with a complete answer and the
 *   UI must not be built around token-by-token rendering.
 */

import type { ChatResponse, CountryMention, MapLocation, NewsTopic } from "./contracts";
import type { ChatMapLocation } from "./map-events-contract";
import type { S2Filters } from "./s2-filters";
import type { S2MapData, S2Series } from "./s2-contracts";
import {
  FIXTURE_NEWS_TOPICS,
  FIXTURE_S2_MAP,
  FIXTURE_S2_SERIES,
} from "./fixtures";

/**
 * The media service's own origin plus `API_PREFIX` (`platform/config.py`),
 * called directly -- no dev-server proxy, no gateway, no nginx involvement on
 * this side. Per `Fotress_SNSF/docs/NEWS_SERVICE_INTEGRATION_GUIDE.md` §1:
 * "There is no `edge_gateway` in front of it yet... this is the service's own
 * origin." The service sets `MEDIA_CORS_ALLOWED_ORIGINS` permissively enough
 * for this (confirmed `*` on the running deployment), so a direct
 * cross-origin `fetch` from the browser is the intended integration path, not
 * a workaround.
 *
 * Overridable via `VITE_MEDIA_API_BASE_URL` for a deployment where the
 * service lives somewhere other than this default (this machine, container
 * `news-media-service`, published on host port 8093 -- *not* the `8000` the
 * guide's own generic example uses, which is the container's internal port).
 */
export const INTEL_API_BASE =
  import.meta.env.VITE_MEDIA_API_BASE_URL || "http://localhost:8093/api/v1/media";

/**
 * Shared-secret dev bearer token (guide §2) -- not real per-user auth, every
 * caller is the same synthetic `dev-user`. Defaults to this deployment's
 * actual configured value (confirmed via `docker inspect news-media-service`,
 * matching its `MEDIA_DEV_BEARER_TOKEN`), overridable via `VITE_MEDIA_DEV_TOKEN`
 * for a deployment using a different one. A wrong or missing token 401s every
 * call below (guide §2) -- there is no silent fallback to fixtures for chat.
 */
const MEDIA_DEV_TOKEN: string =
  import.meta.env.VITE_MEDIA_DEV_TOKEN || "local-dev-9f2c7a1e4b6d8035";

/**
 * True while a given panel is running on fixtures rather than the live
 * service. Chat is real; every other panel here is still a fixture.
 */
export const INTEL_USING_FIXTURES = {
  chat: false,
  recentTopics: true,
  countryMentions: true,
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
  const res = await fetch(`${INTEL_API_BASE}/news/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MEDIA_DEV_TOKEN}`,
    },
    body: JSON.stringify({
      query,
      session_id: sessionId ?? null,
    }),
  });

  if (!res.ok) {
    const code = await extractErrorCode(res);
    throw new Error(`News chat request failed (${res.status}): ${code}`);
  }

  const response = (await res.json()) as ChatResponse;
  return { response, locations: toChatMapLocations(response.map_locations, response.timestamp) };
}

/**
 * Pulls `{"detail": {"error": "<code>"}}` out of a failed response body, per
 * `contracts.ts`'s `INTEL_ERROR_CODES`. Falls back to the raw status text if
 * the body is not that shape (e.g. an upstream proxy error, not the service
 * itself).
 */
async function extractErrorCode(res: Response): Promise<string> {
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
      return String((body as { detail: { error: unknown } }).detail.error);
    }
  } catch {
    // Body was not JSON (or not readable) -- fall through to the status text.
  }
  return res.statusText || "unknown";
}

/** `GET /api/v1/media/news/recent?limit&country` */
export async function fetchRecentTopics(limit = 20): Promise<NewsTopic[]> {
  return delay(FIXTURE_NEWS_TOPICS.slice(0, limit).map((topic) => ({ ...topic })));
}

/**
 * `POST /api/v1/media/news/country/coordinates`
 *
 * Worth knowing before building on this: the server implementation is a regex
 * scan for country names over the answer text, resolved against a hardcoded
 * table of roughly seventy country centroids. So it returns one point per
 * *country*, not per event, and carries no time information at all. Country
 * bubbles are plottable from it; an event-level track is not.
 */
export async function extractCountryMentions(content: string): Promise<CountryMention[]> {
  void content;
  return delay([]);
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
