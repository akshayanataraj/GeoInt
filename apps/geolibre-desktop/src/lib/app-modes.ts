import type { AppMode } from "@geolibre/core";
import {
  BarChart3,
  Map as MapIcon,
  Mail,
  Newspaper,
  ShieldCheck,
  ShieldQuestion,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * Display metadata for the single-screen mode switcher (UI_REPURPOSE_PLAN.md
 * §2). Labels/descriptions are plain English for now, not run through i18n:
 * every non-map mode is a placeholder (see `ModeScreen.tsx`) that will be
 * replaced by real, translated screens in a later phase, so wiring 19 locale
 * catalogs for throwaway copy would be wasted work. Descriptions are pulled
 * from FRONTEND_FEATURE_REQUIREMENTS.md §3.1's area table. Feedback is
 * deliberately absent here -- it's a persistent floating action, not a mode.
 */
export interface AppModeMeta {
  id: AppMode;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

export const APP_MODE_META: readonly AppModeMeta[] = [
  {
    id: "map",
    label: "Map",
    description: "Layers, analysis, and the S2 Grid / satellite / flight-tracking workspace.",
    icon: MapIcon,
  },
  {
    id: "news",
    label: "News Media",
    description: "News RAG chat, recent topics, citations, map enrichment.",
    icon: Newspaper,
  },
  {
    id: "social",
    label: "Social Intelligence",
    description: "Social RAG chat, evidence metadata, trend and quote panels.",
    icon: Users,
  },
  {
    id: "monitoring",
    label: "Monitoring",
    description: "Platform health, runs, failures, logs, tracking configuration.",
    icon: ShieldQuestion,
  },
  {
    id: "reports",
    label: "Reports",
    description: "On-demand summary/report generation and sending.",
    icon: BarChart3,
  },
  {
    id: "digest",
    label: "Daily Digest",
    description: "Filtered digest settings, run-now, history.",
    icon: Mail,
  },
  {
    id: "admin",
    label: "Admin",
    description: "Accounts, roles, alert recipients, and the feedback inbox.",
    icon: ShieldCheck,
  },
];

export function appModeMeta(mode: AppMode): AppModeMeta {
  const meta = APP_MODE_META.find((entry) => entry.id === mode);
  if (!meta) throw new Error(`Unknown app mode: ${mode}`);
  return meta;
}
