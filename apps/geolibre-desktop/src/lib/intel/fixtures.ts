/**
 * Static sample data for the intelligence console.
 *
 * Chat and its map-location data are real now (`client.ts`'s `sendChatMessage`
 * calls the live News service and maps its `map_locations` field) -- what's
 * left here backs the panels still running on fixtures: Event Feed
 * (`FIXTURE_NEWS_TOPICS`, mirroring `GET /news/recent`) and the S2 Grid layer
 * and panel (`FIXTURE_S2_MAP` mirrors `GET /api/s2/map`'s per-cell/per-point
 * geometry; `FIXTURE_S2_SERIES` mirrors `GET /api/s2/series`'s aggregate
 * KPI rollup -- see `s2-contracts.ts` for why the panel is built against the
 * latter rather than re-deriving from the former), since the S2 module is
 * still an empty backend scaffold. They exist to make
 * the layout, density, and visual design reviewable at realistic volumes,
 * which an empty console cannot be.
 *
 * Rules for anything added here:
 *
 * 1. It must satisfy the types in `contracts.ts` (real mirrors) or
 *    `s2-contracts.ts` (provisional). Fixtures that do not typecheck against
 *    the contract are worse than no fixtures, because they design the UI
 *    around a shape the server will never send.
 * 2. No live-looking values. Timestamps are fixed strings, never `Date.now()`,
 *    so the UI is deterministic in tests and screenshots and nothing appears to
 *    be updating when it is not.
 * 3. Content is deliberately mundane, publicly-reported-looking material. This
 *    is placeholder text for a UI review, and inventing plausible-looking
 *    intelligence reporting would be a bad thing to leave lying around in a
 *    repository.
 *
 * Delete each fixture here once its panel's endpoint returns real data.
 */

import type { NewsTopic } from "./contracts";
import type { S2Cell, S2MapData, S2Point, S2Series } from "./s2-contracts";

/**
 * Builds a rectangular cell polygon in the doc's own `[lat, lng]` corner
 * order (SW, SE, NE, NW -- see `s2-contracts.ts`'s module docstring), sized
 * to roughly match the ~155km edge length S2_GRID.md's table gives level 6.
 */
function cellPoly(
  centerLat: number,
  centerLng: number,
  halfDegrees = 0.7,
): readonly [number, number][] {
  const south = centerLat - halfDegrees;
  const north = centerLat + halfDegrees;
  const west = centerLng - halfDegrees;
  const east = centerLng + halfDegrees;
  return [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];
}

export const FIXTURE_S2_MAP: S2MapData = {
  level: 6,
  cellKm: 155,
  nLocations: 14,
  nEvents: 1_284,
  truncated: false,
  cells: (
    [
      { token: "3f9c14", lat: 28.61, lng: 77.21, n: 214, sev: 0.74, tier: "red", growth: 0.42, growing: true },
      { token: "3f9c2b", lat: 19.08, lng: 72.88, n: 186, sev: 0.51, tier: "yellow", growth: 0.18, growing: true },
      { token: "3fa071", lat: 22.57, lng: 88.36, n: 143, sev: 0.48, tier: "yellow", growth: -0.06, growing: false },
      { token: "3fa0c8", lat: 13.08, lng: 80.27, n: 128, sev: 0.29, tier: "green", growth: 0.09, growing: false },
      { token: "3fb133", lat: 23.26, lng: 77.41, n: 97, sev: 0.22, tier: "green", growth: 0, growing: false },
      { token: "3fb1a4", lat: 17.39, lng: 78.49, n: 84, sev: 0.31, tier: "green", growth: -0.22, growing: false },
      { token: "3fc207", lat: 26.14, lng: 91.74, n: 61, sev: 0.18, tier: "green", growth: 0.03, growing: false },
      { token: "3fc2f9", lat: 15.5, lng: 80.05, n: 44, sev: 0.15, tier: "green", growth: -0.11, growing: false },
    ] as const
  ).map(
    (cell): S2Cell => ({
      token: cell.token,
      poly: cellPoly(cell.lat, cell.lng),
      n: cell.n,
      nLoc: Math.max(1, Math.round(cell.n / 12)),
      sev: cell.sev,
      tier: cell.tier,
      growth: cell.growth,
      growing: cell.growing,
    }),
  ),
  points: [
    {
      lat: 28.6139,
      lng: 77.209,
      place: "New Delhi, Delhi, India",
      n: 214,
      sev: 0.74,
      sevMax: 0.89,
      tier: "red",
      growing: true,
      growth: 0.42,
      mentions: 1_850,
      tone: -4.2,
    },
    {
      lat: 19.076,
      lng: 72.8777,
      place: "Mumbai, Maharashtra, India",
      n: 186,
      sev: 0.51,
      sevMax: 0.63,
      tier: "yellow",
      growing: true,
      growth: 0.18,
      mentions: 1_210,
      tone: -2.1,
    },
    {
      lat: 22.5726,
      lng: 88.3639,
      place: "Kolkata, West Bengal, India",
      n: 143,
      sev: 0.48,
      sevMax: 0.55,
      tier: "yellow",
      growing: false,
      growth: -0.06,
      mentions: 902,
      tone: -1.4,
    },
    {
      lat: 13.0827,
      lng: 80.2707,
      place: "Chennai, Tamil Nadu, India",
      n: 128,
      sev: 0.29,
      sevMax: 0.41,
      tier: "green",
      growing: false,
      growth: 0.09,
      mentions: 640,
      tone: 0.6,
    },
    {
      lat: 17.385,
      lng: 78.4867,
      place: "Hyderabad, Telangana, India",
      n: 84,
      sev: 0.31,
      sevMax: 0.38,
      tier: "green",
      growing: false,
      growth: -0.22,
      mentions: 410,
      tone: 1.2,
    },
  ] satisfies readonly S2Point[],
};

/**
 * A week of daily severity-composition buckets plus the derived KPI rollup,
 * mirroring `GET /api/s2/series` (S2_GRID.md section 4.3 #7) for the metrics
 * panel -- see `S2SeriesSummary`'s docstring for why this exists separately
 * from `FIXTURE_S2_MAP`. `summary` is hand-picked to be a *plausible* reading
 * of `buckets`' escalating red/yellow share, not arithmetically derived from
 * it -- exact derivation isn't worth chasing for placeholder data (S2_GRID.md
 * 2.4's acceleration is properly an hourly-bucket quantity; these are daily).
 */
export const FIXTURE_S2_SERIES: S2Series = {
  span: "7d",
  buckets: [
    { bucket: "2026-08-19T00:00:00Z", green: 62, yellow: 18, red: 4 },
    { bucket: "2026-08-20T00:00:00Z", green: 58, yellow: 21, red: 5 },
    { bucket: "2026-08-21T00:00:00Z", green: 60, yellow: 24, red: 6 },
    { bucket: "2026-08-22T00:00:00Z", green: 54, yellow: 27, red: 8 },
    { bucket: "2026-08-23T00:00:00Z", green: 50, yellow: 30, red: 10 },
    { bucket: "2026-08-24T00:00:00Z", green: 47, yellow: 33, red: 12 },
    { bucket: "2026-08-25T00:00:00Z", green: 44, yellow: 35, red: 15 },
  ],
  summary: {
    velocity: 3.9,
    acceleration: 0.4,
    meanTone: -3.1,
    conflictShare: 0.34,
    materialConflictShare: 0.14,
    anomalyBuckets: 2,
  },
};

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
