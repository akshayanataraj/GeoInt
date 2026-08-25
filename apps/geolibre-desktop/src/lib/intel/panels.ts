/**
 * Display metadata for the console rail.
 *
 * Replaces the old `app-modes.ts`, which described one full-screen page per
 * feature area. The rail no longer switches pages: dock entries toggle a panel
 * beside the live map, and sheet entries raise an overlay over it.
 *
 * Labels are plain English rather than i18n keys for the same reason the old
 * file gave: these surfaces are placeholders pending real backends, and wiring
 * nineteen locale catalogues to copy that is about to be rewritten is wasted
 * work. The strings move into `en.json` when the panels get real content.
 */

import type { IntelConsoleSheet, IntelDockPanel } from "@geolibre/core";
import {
  Activity,
  Grid3x3,
  Mail,
  MessageSquare,
  Radio,
  ShieldCheck,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface IntelDockPanelMeta {
  id: IntelDockPanel;
  label: string;
  /** Tooltip second line: what the panel is for, in one clause. */
  hint: string;
  icon: LucideIcon;
}

export interface IntelSheetMeta {
  id: IntelConsoleSheet;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const INTEL_DOCK_PANEL_META: readonly IntelDockPanelMeta[] = [
  {
    id: "s2",
    label: "S2 Grid",
    hint: "Cell aggregates, severity bands, and trend",
    icon: Grid3x3,
  },
  {
    id: "events",
    label: "Event Feed",
    hint: "Recent indexed topics and their timelines",
    icon: Radio,
  },
  {
    id: "chat",
    label: "Analyst Chat",
    hint: "Ask across news and social sources",
    icon: MessageSquare,
  },
];

export const INTEL_SHEET_META: readonly IntelSheetMeta[] = [
  {
    id: "monitoring",
    label: "Collection Health",
    hint: "Platform connectors, runs, and failures",
    icon: Activity,
  },
  {
    id: "reports",
    label: "Reports",
    hint: "Generate and send summary reports",
    icon: FileText,
  },
  {
    id: "digest",
    label: "Daily Digest",
    hint: "Digest filters, schedule, and history",
    icon: Mail,
  },
  {
    id: "admin",
    label: "Administration",
    hint: "Accounts, roles, recipients, feedback inbox",
    icon: ShieldCheck,
  },
];

export function dockPanelMeta(id: IntelDockPanel): IntelDockPanelMeta {
  const meta = INTEL_DOCK_PANEL_META.find((entry) => entry.id === id);
  if (!meta) throw new Error(`Unknown intel dock panel: ${id}`);
  return meta;
}

export function sheetMeta(id: IntelConsoleSheet): IntelSheetMeta {
  const meta = INTEL_SHEET_META.find((entry) => entry.id === id);
  if (!meta) throw new Error(`Unknown intel console sheet: ${id}`);
  return meta;
}
