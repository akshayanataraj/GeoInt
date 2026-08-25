import { MessageCircle, MessageSquare, type LucideIcon } from "lucide-react";
import { COMMENTS_PANEL_ID } from "../hooks/useRegisterCommentsPanel";
import { ANALYST_CHAT_PANEL_ID } from "../hooks/useRegisterAnalystChatPanel";

/**
 * Rail icons for the two app-owned right panels that share GeoLibre's Style
 * rail (Comments, Analyst Chat).
 *
 * The registry's own `icon` field on `registerRightPanel()` only accepts a
 * URL/`data:` string -- rendered as a plain `<img>` -- because it is a
 * plugin-facing API a non-React plugin can also call, so it cannot take a
 * Lucide component. Encoding these two as data-URI SVGs to fit that field
 * would work but adds indirection for no benefit outside this app, so instead
 * `SharedSidebar` and `PluginRightPanel` (the two places that draw a panel's
 * rail icon) special-case these two known ids through this lookup and fall
 * through to the registry's normal image-or-default behaviour for every other
 * panel, including third-party plugins.
 *
 * `MessageSquare` for Comments matches the icon GeoLibre's own "Add comment"
 * command already uses elsewhere in the toolbar (see `TopToolbar.tsx`), so a
 * comment reads as the same concept wherever it appears. Analyst Chat gets the
 * rounder `MessageCircle` specifically so the two are never confusable sitting
 * side by side in the same rail.
 */
export const RIGHT_PANEL_ICONS: Readonly<Record<string, LucideIcon>> = {
  [COMMENTS_PANEL_ID]: MessageSquare,
  [ANALYST_CHAT_PANEL_ID]: MessageCircle,
};
