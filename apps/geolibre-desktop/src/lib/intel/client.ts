/**
 * The single seam between the intelligence console UI and the media service.
 *
 * Nothing here performs a network request yet: the backend is still being built
 * and this app is not wired to it. Every function returns fixture data after a
 * short delay so panels exercise their real loading and error states instead of
 * rendering instantly from a constant.
 *
 * The point of routing every panel through this one module is that connecting
 * the backend later is a change *here* and nowhere else. Each function carries
 * the exact method and path it will call, taken from the service's README and
 * router modules, so there is no guessing at that point.
 *
 * Two contract facts that shape the UI and are easy to get wrong later:
 *
 * - **Every media endpoint needs a bearer token** from `user_service`, which
 *   does not exist in the backend repository yet. `AuthGate`'s sign-in is a
 *   client-side stub, so there is no token to send. Real calls cannot be
 *   switched on before that service and the gateway exist -- see
 *   {@link INTEL_API_BASE}.
 * - **Chat does not stream.** `ChatRequest` carries a `stream` field, but the
 *   handler is a synchronous `def` returning a whole `ChatResponse`; there is no
 *   SSE. So `sendChatMessage` resolves once with a complete answer and the UI
 *   must not be built around token-by-token rendering.
 */

import type { ChatResponse, CountryMention, NewsTopic } from "./contracts";
import type { ChatMapEvent } from "./map-events-contract";
import type { S2Cell, S2Summary } from "./s2-contracts";
import {
  FIXTURE_CHAT_MAP_EVENTS,
  FIXTURE_CHAT_RESPONSE,
  FIXTURE_NEWS_TOPICS,
  FIXTURE_S2_CELLS,
  FIXTURE_S2_SUMMARY,
} from "./fixtures";

/**
 * Public API prefix, from the service's `platform/config.py` (`API_PREFIX`).
 * Reached through the platform's single public origin (`edge_gateway`), so the
 * browser never addresses a service directly.
 *
 * Deliberately unused until there is something to call: it documents the target
 * and keeps the paths below honest.
 */
export const INTEL_API_BASE = "/api/v1/media";

/** True while the console is running on fixtures rather than the live service. */
export const INTEL_USING_FIXTURES = true;

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
 * `response` is the real `ChatResponse` mirror. `mapEvents` is **not** part of
 * that contract -- it does not exist on the wire today and never has, since
 * the real `/news/chat` endpoint has no notion of per-event coordinates (see
 * `map-events-contract.ts`). It is returned as a sibling field, deliberately
 * kept out of `ChatResponse` itself, so nothing mistakes this for a verified
 * mirror the way `contracts.ts`'s other types are.
 */
export interface ChatMessageResult {
  response: ChatResponse;
  mapEvents: readonly ChatMapEvent[];
}

/** `POST /api/v1/media/news/chat` */
export async function sendChatMessage(
  query: string,
  sessionId?: string,
): Promise<ChatMessageResult> {
  const response = await delay(
    {
      ...FIXTURE_CHAT_RESPONSE,
      query,
      session_id: sessionId ?? FIXTURE_CHAT_RESPONSE.session_id,
    },
    900,
  );
  // Every question resolves to the same fixture narrative and, with it, the
  // same three-stop map sequence -- this endpoint does not vary by query,
  // matching how the rest of `FIXTURE_CHAT_RESPONSE` is a fixed constant.
  return { response, mapEvents: FIXTURE_CHAT_MAP_EVENTS };
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
 * S2 cell aggregates. No endpoint yet -- the service's `modules/s2/` package is
 * an empty scaffold, so there is not even a path to write down here. See
 * `s2-contracts.ts` for why these shapes are provisional.
 */
export async function fetchS2Summary(): Promise<S2Summary> {
  return delay({ ...FIXTURE_S2_SUMMARY });
}

export async function fetchS2Cells(): Promise<S2Cell[]> {
  return delay(FIXTURE_S2_CELLS.map((cell) => ({ ...cell })));
}
