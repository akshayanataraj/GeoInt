import type { AppMode } from "@geolibre/core";
import { appModeMeta } from "../../lib/app-modes";

interface ModeScreenProps {
  mode: AppMode;
}

/**
 * Placeholder content for every mode except "map" (UI_REPURPOSE_PLAN.md §2,
 * §12 phase 1). The real News/Social chat, monitoring dashboards, admin
 * CRUD, and reports/digest forms are later phases -- this is deliberately
 * just a clean hero naming what's coming, so the mode switcher has somewhere
 * real to land today.
 */
export function ModeScreen({ mode }: ModeScreenProps) {
  const meta = appModeMeta(mode);
  const Icon = meta.icon;
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-card shadow-sm">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{meta.label}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
        </div>
        <p className="text-xs text-muted-foreground/70">Coming soon.</p>
      </div>
    </div>
  );
}
