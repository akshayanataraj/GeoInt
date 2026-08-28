/**
 * TypeScript mirrors of the media service's Social HTTP contract.
 *
 * A genuinely different pipeline from News (`contracts.ts`), not a variant of
 * it: different retrieval (platform-native social evidence, not GDELT news
 * chunks), a different response envelope (`success: boolean` discriminates
 * an in-band failure rather than an HTTP error status), and citation markers
 * are already linkified server-side (see `citation_check.linkify_markers` --
 * `AnswerText` needs no doc-id join for Social the way it does for News's
 * `[Cn]`/Sources-block scheme). Source of truth:
 * `Fotress_SNSF/docs/MEDIA_SERVICE_FRONTEND_INTEGRATION_GUIDE.md` §8-9,
 * cross-checked directly against
 * `src/media_service/modules/social/pipeline/contracts.py` (the `Citation`
 * Pydantic model) and `application/analyst.py`'s `_enrich_notable_quotes`
 * (`QueryResponse.citations`/`notable_quotes` are untyped `list[dict]` at the
 * Pydantic layer, so their real shape lives in whichever function builds
 * them, not in a schema FastAPI enforces).
 */

/** `Citation` -- `platform`/`pk`/`quote_or_summary` are always present; the rest come straight from raw evidence fields and can be absent. */
export interface SocialCitation {
  platform: string;
  pk: string;
  url: string | null;
  author: string | null;
  timestamp: string | null;
  quote_or_summary: string;
}

/** One `_enrich_notable_quotes` entry -- same "always/sometimes present" split as `SocialCitation`, plus the model's own optional `reason`. */
export interface SocialNotableQuote {
  platform: string;
  pk: string;
  url: string | null;
  author: string | null;
  timestamp: string | null;
  quote: string;
  reason: string | null;
}

export interface SocialVolumeTrendDailyTotal {
  date: string;
  count: number;
}

/** `_build_volume_trend`'s dict -- `null` on the response entirely when the enrichment call fails or returns no daily totals (never answer-critical, per that function's own docstring). */
export interface SocialVolumeTrend {
  keyword_query: string;
  total_matches: number;
  daily_totals: SocialVolumeTrendDailyTotal[];
  daily_bucket_count: number;
  growth_rate_pct: number;
  by_platform_totals: Record<string, number>;
}

export const SOCIAL_ROUTES = ["analysis", "listing", "chitchat"] as const;

export type SocialRoute = (typeof SOCIAL_ROUTES)[number];

export const SOCIAL_EVIDENCE_SUFFICIENCY = ["sufficient", "thin", "insufficient"] as const;

export type SocialEvidenceSufficiency = (typeof SOCIAL_EVIDENCE_SUFFICIENCY)[number];

/**
 * `QueryResponse` from `POST /api/v1/media/social/query`.
 *
 * `success` is the discriminator, not the HTTP status -- this endpoint
 * answers `200` either way (guide §12.1's decision tree: "HTTP 200 + Social
 * success === false -> inline error bubble"). When `false`, `answer` is
 * `null` and `error`/`error_id` carry a fixed, user-safe message plus a
 * correlation id for support; every other content field is empty. `route`
 * distinguishes three shapes worth rendering differently: `"chitchat"` (a
 * canned reply, no evidence at all -- same idea as News's guardrail
 * short-circuit), `"listing"` (direct post enumeration, `evidence_sufficiency`
 * absent), and `"analysis"` (the full reasoned path, everything populated).
 */
export interface SocialQueryResponse {
  success: boolean;
  session_id: string;
  turn_id: string | null;
  /** GitHub-flavored Markdown, `[n]` markers already linkified to real links. Null when `success` is false. */
  answer: string | null;
  citations: SocialCitation[];
  elapsed_seconds: number;
  route: SocialRoute | null;
  needs_analysis: boolean | null;
  /** Human-readable notes on what the verifier stripped/adjusted -- a "how this answer was checked" disclosure, not the answer itself. */
  revisions_made: string[];
  unsupported_claims_removed: string[];
  notable_quotes: SocialNotableQuote[];
  /** Absent (`null`) for `"listing"`/`"chitchat"`; a first-class UI signal for `"analysis"` -- `"thin"`/`"insufficient"` should read as a visible caveat above the answer, not buried. */
  evidence_sufficiency: SocialEvidenceSufficiency | null;
  volume_trend: SocialVolumeTrend | null;
  /** Debug-only, present only when requested/configured server-side (`MEDIA_SOCIAL_API_DEBUG`). Opaque; never parsed. */
  run_stats: Record<string, unknown> | null;
  /** Which stage failed, when `success` is false. */
  stage: "scout" | "analysis" | null;
  error: string | null;
  error_id: string | null;
}
