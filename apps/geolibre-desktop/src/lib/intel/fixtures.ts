/**
 * Static sample data for the intelligence console.
 *
 * Chat and its map-location data are real now (`client.ts`'s `sendChatMessage`
 * calls the live News service and maps its `map_locations` field) -- what's
 * left here backs the panels still running on fixtures: Event Feed
 * (`FIXTURE_NEWS_TOPICS`, mirroring `GET /news/recent`) and the S2 Grid
 * panels (`FIXTURE_S2_SUMMARY`/`FIXTURE_S2_CELLS`), since S2 is still an
 * empty backend scaffold. They exist to make the layout, density, and visual
 * design reviewable at realistic volumes, which an empty console cannot be.
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
