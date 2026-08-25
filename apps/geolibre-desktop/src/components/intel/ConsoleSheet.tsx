import { useAppStore, type IntelConsoleSheet } from "@geolibre/core";
import { Button, cn } from "@geolibre/ui";
import { X } from "lucide-react";
import { useEffect } from "react";
import { sheetMeta } from "../../lib/intel/panels";

/**
 * Overlay surface for the non-spatial console areas: collection health, reports,
 * digest settings, administration.
 *
 * These get an overlay rather than a dock panel because they have nothing to put
 * on a map -- a connector's run history is a table, not a place -- so cramming
 * them into a 320px column would be worse than giving them the screen. The map
 * stays mounted underneath and comes back untouched on close; it is dimmed, not
 * unmounted, which is the whole reason this is an overlay and not a route.
 *
 * Deliberately not the shared `Dialog` primitive. That is a focus-trapping modal
 * built for decisions -- confirm, cancel, dismiss -- whereas these are working
 * surfaces an analyst may sit in for a while, sized to the viewport and closed
 * from the rail button that opened them. Using a modal would also fight the rail
 * for focus every time one is toggled.
 *
 * The content is a placeholder for every sheet, and says so specifically: each
 * of these four backend modules is an empty directory of `__init__.py` files
 * today, so there is no data to lay out and any layout invented now would be
 * designed against a guess.
 */
export function ConsoleSheet() {
  const sheet = useAppStore((s) => s.ui.intel.sheet);
  const setSheet = useAppStore((s) => s.setIntelSheet);

  // Escape closes, matching the rail toggle. Bound only while a sheet is open so
  // the console does not carry a permanent global key listener.
  useEffect(() => {
    if (!sheet) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheet, setSheet]);

  if (!sheet) return null;

  const meta = sheetMeta(sheet);
  const Icon = meta.icon;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-sm">
      <header className="intel-hairline flex h-11 shrink-0 items-center gap-2.5 border-b px-4">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
            {meta.label}
          </h2>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{meta.hint}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close ${meta.label}`}
          onClick={() => setSheet(null)}
          className="-me-1 ms-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="geoint-sheet-in intel-grid min-h-0 flex-1 overflow-y-auto motion-reduce:animate-none">
        <SheetPlaceholder sheet={sheet} />
      </div>
    </div>
  );
}

/**
 * What each sheet will hold, and what is blocking it.
 *
 * Naming the blocker rather than showing a generic "coming soon" is the point:
 * during integration the only useful information on these screens is which
 * backend module has to exist first.
 */
const SHEET_PLAN: Readonly<Record<IntelConsoleSheet, { plans: string[]; blocked: string }>> = {
  monitoring: {
    plans: [
      "Per-platform connector status, last successful run, and failure counts",
      "Collection run history with logs and retry state",
      "Keyword, channel, and profile configuration per platform",
    ],
    blocked: "the media service's monitoring module, which has no routes yet",
  },
  reports: {
    plans: [
      "Compose a report from a saved search or a chat session's evidence",
      "Generated report history with re-run and export",
      "Recipient selection and send",
    ],
    blocked: "the media service's reporting module, which has no routes yet",
  },
  digest: {
    plans: [
      "Digest filters — regions, severity floor, source allowlist",
      "Schedule and delivery window",
      "Run-now, plus a history of previous digests",
    ],
    blocked: "the media service's reporting module, which owns digests",
  },
  admin: {
    plans: [
      "Accounts, roles, and scope assignment",
      "Alert recipient lists",
      "The feedback inbox",
    ],
    blocked:
      "user_service, which does not exist in the backend repository yet — accounts, roles, and scopes are all owned there, not by this app",
  },
};

function SheetPlaceholder({ sheet }: { sheet: IntelConsoleSheet }) {
  const { plans, blocked } = SHEET_PLAN[sheet];
  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className={cn("rounded-lg border bg-card/80 p-5", "intel-hairline")}>
        <p className="intel-label">Planned contents</p>
        <ul className="mt-2 space-y-1.5">
          {plans.map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-relaxed text-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <p className="intel-hairline mt-4 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Waiting on {blocked}.
        </p>
      </div>
    </div>
  );
}
