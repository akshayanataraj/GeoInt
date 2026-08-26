/**
 * Static sample data for the intelligence console.
 *
 * The backend is a work in progress -- only the news module has routes, and
 * nothing is wired up from this app yet -- so every panel renders from these
 * fixtures. They exist to make the layout, density, and visual design
 * reviewable at realistic volumes, which an empty console cannot be.
 *
 * Rules for anything added here:
 *
 * 1. It must satisfy the types in `contracts.ts` (real mirrors) or
 *    `s2-contracts.ts` / `map-events-contract.ts` (provisional). Fixtures that
 *    do not typecheck against the contract are worse than no fixtures, because
 *    they design the UI around a shape the server will never send.
 * 2. No live-looking values. Timestamps are fixed strings, never `Date.now()`,
 *    so the UI is deterministic in tests and screenshots and nothing appears to
 *    be updating when it is not.
 * 3. Content is deliberately mundane, publicly-reported-looking material. This
 *    is placeholder text for a UI review, and inventing plausible-looking
 *    intelligence reporting would be a bad thing to leave lying around in a
 *    repository.
 *
 * Delete this file once the endpoints in `client.ts` return real data.
 */

import type { ChatResponse, NewsTopic } from "./contracts";
import type { ChatMapLocation } from "./map-events-contract";
import type { S2Cell, S2Summary } from "./s2-contracts";

/** Fixed reference instant for every timestamp below. */
const T0 = "2026-08-25T09:00:00Z";

export const FIXTURE_S2_SUMMARY: S2Summary = {
  totalEvents: 1_284,
  cellsActive: 37,
  bySeverity: { routine: 21, elevated: 9, high: 5, critical: 2 },
  asOf: T0,
  window: "24h",
};

export const FIXTURE_S2_CELLS: readonly S2Cell[] = [
  {
    token: "3f9c14",
    level: 6,
    label: "Northern plains",
    centroid: { lat: 28.61, lng: 77.21 },
    eventCount: 214,
    severity: "critical",
    trend: 0.42,
  },
  {
    token: "3f9c2b",
    level: 6,
    label: "Western coast",
    centroid: { lat: 19.08, lng: 72.88 },
    eventCount: 186,
    severity: "high",
    trend: 0.18,
  },
  {
    token: "3fa071",
    level: 6,
    label: "Eastern seaboard",
    centroid: { lat: 22.57, lng: 88.36 },
    eventCount: 143,
    severity: "high",
    trend: -0.06,
  },
  {
    token: "3fa0c8",
    level: 6,
    label: "Southern peninsula",
    centroid: { lat: 13.08, lng: 80.27 },
    eventCount: 128,
    severity: "elevated",
    trend: 0.09,
  },
  {
    token: "3fb133",
    level: 6,
    label: "Central highlands",
    centroid: { lat: 23.26, lng: 77.41 },
    eventCount: 97,
    severity: "elevated",
    trend: null,
  },
  {
    token: "3fb1a4",
    level: 6,
    label: "Deccan interior",
    centroid: { lat: 17.39, lng: 78.49 },
    eventCount: 84,
    severity: "elevated",
    trend: -0.22,
  },
  {
    token: "3fc207",
    level: 6,
    label: "North-eastern corridor",
    centroid: { lat: 26.14, lng: 91.74 },
    eventCount: 61,
    severity: "routine",
    trend: 0.03,
  },
  {
    token: "3fc2f9",
    level: 6,
    label: "Coastal delta",
    centroid: { lat: 15.5, lng: 80.05 },
    eventCount: 44,
    severity: "routine",
    trend: -0.11,
  },
];

export const FIXTURE_NEWS_TOPICS: readonly NewsTopic[] = [
  {
    id: "topic-1",
    headline: "Monsoon flooding disrupts freight rail across two districts",
    snippet:
      "Regional operators reported suspended services after track inspections, with diversions in place while water levels are monitored.",
    url: "https://example.org/reports/rail-monsoon-disruption",
    source: "Regional Wire",
    country: "India",
    published_at: "2026-08-25T06:40:00Z",
    timeline: [
      { date: "2026-08-23", event: "Heavy rainfall warning issued", url: "https://example.org/1" },
      { date: "2026-08-24", event: "Track inspection begins", url: "https://example.org/2" },
      { date: "2026-08-25", event: "Freight services suspended", url: "https://example.org/3" },
    ],
  },
  {
    id: "topic-2",
    headline: "Port authority publishes revised container throughput figures",
    snippet:
      "Quarterly figures were restated following a reconciliation of transshipment volumes; the authority described the change as procedural.",
    url: "https://example.org/reports/port-throughput",
    source: "Trade Monitor",
    country: "India",
    published_at: "2026-08-25T05:15:00Z",
    timeline: [
      { date: "2026-08-20", event: "Initial figures released", url: "https://example.org/4" },
      { date: "2026-08-25", event: "Revised figures published", url: "https://example.org/5" },
    ],
  },
  {
    id: "topic-3",
    headline: "Cross-border trade delegation talks conclude without joint statement",
    snippet:
      "Both delegations confirmed the sessions ended as scheduled. No joint communique was issued and no follow-up date was announced.",
    url: "https://example.org/reports/trade-delegation",
    source: "Wire Service",
    country: "China",
    published_at: "2026-08-24T18:30:00Z",
    timeline: [
      { date: "2026-08-22", event: "Delegation arrives", url: "https://example.org/6" },
      { date: "2026-08-24", event: "Talks conclude", url: "https://example.org/7" },
    ],
  },
  {
    id: "topic-4",
    headline: "Coastal weather advisory extended for fishing fleets",
    snippet:
      "The advisory was extended by 48 hours covering an additional stretch of coastline, with harbours asked to hold small craft.",
    url: "https://example.org/reports/coastal-advisory",
    source: "Maritime Bulletin",
    country: "India",
    published_at: "2026-08-24T14:05:00Z",
    timeline: [
      { date: "2026-08-24", event: "Advisory extended", url: "https://example.org/8" },
    ],
  },
  {
    id: "topic-5",
    headline: "Regional airport reports scheduling backlog after equipment fault",
    snippet:
      "A ground-handling equipment fault produced knock-on delays through the evening; the operator said normal scheduling resumed overnight.",
    url: "https://example.org/reports/airport-backlog",
    source: "Aviation Desk",
    country: "India",
    published_at: "2026-08-24T09:20:00Z",
    timeline: [
      { date: "2026-08-23", event: "Equipment fault reported", url: "https://example.org/9" },
      { date: "2026-08-24", event: "Scheduling normalised", url: "https://example.org/10" },
    ],
  },
];

/**
 * A sample chat turn, shaped exactly like `POST /news/chat` returns -- including
 * a populated `degradations` list and open-shaped `retrieval_metrics` /
 * `routing_diagnostics`, because rendering those well is most of what makes the
 * chat panel useful to an analyst rather than a toy.
 */
export const FIXTURE_CHAT_RESPONSE: ChatResponse = {
  session_id: "sample-session",
  turn_id: "sample-turn-1",
  query: "What disrupted rail freight in the northern districts this week?",
  answer: [
    "Freight rail services across two northern districts were suspended on 25 August after",
    "track inspections followed a heavy rainfall warning issued two days earlier [1]. Diversions",
    "are in place while water levels are monitored, and no restoration time has been published [2].",
    "",
    "Reporting is limited to operator statements; no independent assessment of track damage was",
    "available in the indexed sources.",
  ].join(" "),
  citations: [
    {
      id: "1",
      url: "https://example.org/reports/rail-monsoon-disruption",
      title: "Monsoon flooding disrupts freight rail across two districts",
      snippet:
        "Regional operators reported suspended services after track inspections, with diversions in place.",
    },
    {
      id: "2",
      url: "https://example.org/2",
      title: "Track inspection begins",
      snippet: "Inspection teams were dispatched following the rainfall warning.",
    },
  ],
  india_relevance: { level: 3, weight_guidance: "Weight Indian sources heavily" },
  retrieval_metrics: {
    candidates: 248,
    after_fusion: 60,
    after_rerank: 12,
    bm25_hits: 141,
    vector_hits: 107,
    latency_ms: 2840,
  },
  degradations: ["reranker unavailable, fell back to fusion order"],
  routing_diagnostics: {
    planner: "v3",
    route: "specialist:infrastructure",
    india_router: "matched",
  },
  timestamp: T0,
};

/**
 * A sample location sequence for the chat-driven map playback
 * (`ChatMapPlayback`, `chat-map-sequence.ts`), tied to the same
 * rail-disruption narrative as `FIXTURE_CHAT_RESPONSE` -- three real points
 * along the actual Amritsar-Ambala-Delhi rail corridor, each with several
 * items an analyst would actually find reported from that place, dated to
 * match `FIXTURE_NEWS_TOPICS[0]`'s timeline. Each location carries 4-5 items
 * (rather than the bare two or three a real citation list would give) so the
 * bento grid in `ChatMapPlayback` has enough tiles to actually show its
 * layout -- a 2-3 item card never exercises the "closing tile spans full
 * width" branch of `isFeaturedItem`. Only the first item or two per location
 * still lines up with `FIXTURE_CHAT_RESPONSE`'s citation ids; the rest are
 * additional, uncited items invented purely to fill out the grid for visual
 * review, matching this file's own rule against inventing anything that
 * *looks* like real intelligence reporting -- it stays mundane, publicly-
 * reported-looking material.
 *
 * This is the concrete case the plan's blocking dependency (§10) describes:
 * the real backend has these dates on a timeline with no coordinates, and
 * coordinates on a country centroid with no time -- and, per the same
 * section, no notion of "which items were found at which place" at all.
 * Nothing here is going to arrive from a live response until that is fixed,
 * so it is invented in full -- coordinates and item groupings included -- to
 * demonstrate the frontend half of the feature now rather than waiting on
 * that backend change.
 */
export const FIXTURE_CHAT_MAP_LOCATIONS: readonly ChatMapLocation[] = [
  {
    id: "loc-amritsar",
    lat: 31.634,
    lng: 74.8723,
    label: "Amritsar, Punjab",
    severity: "warning",
    items: [
      {
        id: "1",
        kind: "news",
        title: "Heavy rainfall warning issued for the northern rail corridor",
        snippet: "Regional meteorological office flagged sustained heavy rainfall through the weekend.",
        sourceUrl: "https://example.org/1",
        timestamp: "2026-08-23T05:00:00Z",
      },
      {
        id: "1b",
        kind: "social",
        title: "Commuters report standing water near the Amritsar rail yard",
        snippet: "Multiple posts from the same stretch of track over a two-hour window.",
        sourceUrl: "https://example.org/1b",
        timestamp: "2026-08-23T08:15:00Z",
      },
      {
        id: "1c",
        kind: "news",
        title: "Municipal drainage crews deployed to the low-lying yard approach",
        snippet: "Pumping equipment was moved in overnight ahead of the forecast second band of rain.",
        sourceUrl: "https://example.org/1c",
        timestamp: "2026-08-23T11:40:00Z",
      },
      {
        id: "1d",
        kind: "social",
        title: "Local transit account posts a platform closure notice",
        snippet: "Two platforms closed as a precaution; the rest of the station stayed open.",
        sourceUrl: "https://example.org/1d",
        timestamp: "2026-08-23T13:05:00Z",
      },
      {
        id: "1e",
        kind: "news",
        title: "District administration opens a helpline for delayed freight bookings",
        sourceUrl: "https://example.org/1e",
        timestamp: "2026-08-23T16:20:00Z",
      },
    ],
  },
  {
    id: "loc-ambala",
    lat: 30.3752,
    lng: 76.7821,
    label: "Ambala, Haryana",
    severity: "warning",
    items: [
      {
        id: "2",
        kind: "news",
        title: "Track inspection begins along the affected stretch",
        snippet: "Inspection teams were dispatched following the rainfall warning.",
        sourceUrl: "https://example.org/2",
        timestamp: "2026-08-24T07:30:00Z",
      },
      {
        id: "2b",
        kind: "social",
        title: "Photos circulating of inspection crews at the Ambala junction",
        sourceUrl: "https://example.org/2b",
        timestamp: "2026-08-24T09:00:00Z",
      },
      {
        id: "2c",
        kind: "news",
        title: "Junction signal maintenance extended by a further six hours",
        snippet: "Engineers cited standing water near the signal relay hut as the cause of the delay.",
        sourceUrl: "https://example.org/2c",
        timestamp: "2026-08-24T12:10:00Z",
      },
      {
        id: "2d",
        kind: "social",
        title: "Passengers describe a lengthy wait on a stalled express service",
        snippet: "Several posts from the same train report over an hour stopped short of the platform.",
        sourceUrl: "https://example.org/2d",
        timestamp: "2026-08-24T15:45:00Z",
      },
    ],
  },
  {
    id: "loc-delhi",
    lat: 28.6139,
    lng: 77.209,
    label: "New Delhi",
    severity: "critical",
    items: [
      {
        id: "3",
        kind: "news",
        title: "Freight services suspended pending further inspection",
        snippet: "Diversions are in place while water levels are monitored.",
        sourceUrl: "https://example.org/3",
        timestamp: "2026-08-25T04:00:00Z",
      },
      {
        id: "3b",
        kind: "social",
        title: "Freight operators' association acknowledges the suspension",
        sourceUrl: "https://example.org/3b",
        timestamp: "2026-08-25T05:20:00Z",
      },
      {
        id: "3c",
        kind: "news",
        title: "No restoration timeline published as of Tuesday evening",
        sourceUrl: "https://example.org/3c",
        timestamp: "2026-08-25T14:00:00Z",
      },
      {
        id: "3d",
        kind: "social",
        title: "Warehouse operators near the freight yard report a growing backlog",
        snippet: "Several accounts describe container storage nearing capacity by midday.",
        sourceUrl: "https://example.org/3d",
        timestamp: "2026-08-25T16:30:00Z",
      },
      {
        id: "3e",
        kind: "news",
        title: "Ministry statement expected Wednesday on a revised restoration plan",
        snippet: "An official said a schedule would be published once inspection reports are finalized.",
        sourceUrl: "https://example.org/3e",
        timestamp: "2026-08-25T19:10:00Z",
      },
    ],
  },
];
