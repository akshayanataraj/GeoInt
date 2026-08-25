import { useAppStore } from "@geolibre/core";
import { cn, DirectionProvider } from "@geolibre/ui";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { AuthGate } from "./components/layout/AuthGate";
import { DesktopShell } from "./components/layout/DesktopShell";
import { ModeDock } from "./components/layout/ModeDock";
import { ModeScreen } from "./components/layout/ModeScreen";
import { OnboardingDialog } from "./components/layout/OnboardingDialog";
import { UpdateNotificationModal } from "./components/layout/UpdateNotificationModal";
import { useDesktopSettingsPersistence } from "./hooks/useDesktopSettings";
import { useLayoutOptions } from "./hooks/useLayoutOptions";
import { useProjectUrlLoader } from "./hooks/useProjectUrlLoader";
import { useDataUrlLoader } from "./hooks/useDataUrlLoader";
import { useBeforeUnloadGuard } from "./hooks/useBeforeUnloadGuard";
import { useRecentProjectsPersistence } from "./hooks/useRecentProjectsPersistence";
import { useLayerLibraryPersistence } from "./hooks/useLayerLibraryPersistence";
import { useLastBasemapPersistence } from "./hooks/useLastBasemapPersistence";
import { useStyleLibraryPersistence } from "./hooks/useStyleLibraryPersistence";
import { useTemplateLibraryPersistence } from "./hooks/useTemplateLibraryPersistence";
import { useRuntimeEnvironmentVariables } from "./hooks/useRuntimeEnvironmentVariables";
import { useStartupUpdateCheck } from "./hooks/useStartupUpdateCheck";
import { useStartupProject } from "./hooks/useStartupProject";
import { useThemeMode } from "./hooks/useThemeMode";
import { useThemeScheme } from "./hooks/useThemeScheme";
import { useUiProfileBootstrap } from "./hooks/useUiProfileBootstrap";
import { useUndoRedoShortcuts } from "./hooks/useUndoRedoShortcuts";
import { useWhiteboxToolUrl } from "./hooks/useWhiteboxToolUrl";
import { createAppAPI } from "./hooks/usePlugins";
import { languageDirection } from "./i18n/languages";

export default function App() {
  useLastBasemapPersistence();
  const activeMode = useAppStore((s) => s.ui.activeMode);
  // Re-renders on language change, so Radix primitives (menus, sliders, tabs)
  // pick up the right-to-left direction together with the document `dir`.
  const { i18n, t } = useTranslation();
  const layoutOptions = useLayoutOptions();
  const { themeMode, toggleThemeMode } = useThemeMode();
  // `onMapReady` fires again on every basemap swap (MapCanvas re-emits
  // controller-ready from its `style.load` handler) and hands back a freshly
  // built API object each time. Keep the first one: the identity feeds the
  // `?data=` loader's effect deps, and a changing identity would re-run that
  // one-shot import and duplicate its layers.
  const [mapAppAPI, setMapAppAPI] = useState<ReturnType<typeof createAppAPI> | null>(null);
  const handleMapReady = useCallback((api: ReturnType<typeof createAppAPI>) => {
    setMapAppAPI((current) => current ?? api);
  }, []);
  const projectUrlLoadState = useProjectUrlLoader();
  const dataUrlLoadState = useDataUrlLoader(mapAppAPI);
  const { showOnboarding, dismissOnboarding } = useUiProfileBootstrap();
  const { pending: pendingUpdate, remindLater, skipVersion } = useStartupUpdateCheck();
  useDesktopSettingsPersistence();
  useThemeScheme();
  useRecentProjectsPersistence();
  const { warning: startupProjectWarning, restoring: restoringStartupProject } =
    useStartupProject();
  useStyleLibraryPersistence();
  useLayerLibraryPersistence();
  useTemplateLibraryPersistence();
  useRuntimeEnvironmentVariables();
  useUndoRedoShortcuts();
  useBeforeUnloadGuard();
  useWhiteboxToolUrl();
  return (
    <DirectionProvider dir={languageDirection(i18n.language)}>
      <AuthGate>
      {restoringStartupProject ? (
        // The shell is deliberately unmounted while the startup project loads
        // (see `useStartupProject`), so say what the window is waiting on rather
        // than leaving it blank. `useStartupProject` bounds this state, so it
        // cannot become a permanent splash screen.
        <div
          role="status"
          className="flex h-screen w-screen items-center justify-center gap-3 bg-background text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("settings.startup.restoring")}
        </div>
      ) : (
        <>
          <div className="flex h-screen w-screen flex-row overflow-hidden">
            {/* A real flex column, not an overlay: it reserves its own width, so it
                cannot visually collide with anything DesktopShell docks at its
                own edges (Layers/Browser panels, the map's own controls). */}
            <ModeDock />
            <div className="relative min-h-0 flex-1">
              {/* DesktopShell stays mounted across every mode switch -- unmounting
                  it would tear down the live MapLibre instance and every layer/
                  panel state it holds. Non-"map" modes just hide it (opacity +
                  inert to input/AT) behind the placeholder screen instead. */}
              <div
                className={cn(
                  "absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
                  activeMode === "map" ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                aria-hidden={activeMode !== "map"}
                inert={activeMode !== "map" ? true : undefined}
              >
                <DesktopShell
                  layoutOptions={layoutOptions}
                  projectUrlLoadState={projectUrlLoadState}
                  dataUrlLoadState={dataUrlLoadState}
                  mapAppAPI={mapAppAPI}
                  themeMode={themeMode}
                  onToggleThemeMode={toggleThemeMode}
                  onMapReady={handleMapReady}
                />
              </div>
              {activeMode !== "map" ? (
                <div
                  key={activeMode}
                  className="geoint-mode-fade-in absolute inset-0 motion-reduce:animate-none"
                >
                  <ModeScreen mode={activeMode} />
                </div>
              ) : null}
            </div>
          </div>
          <OnboardingDialog open={showOnboarding} onClose={dismissOnboarding} />
        </>
      )}
      </AuthGate>
      <UpdateNotificationModal
        pending={pendingUpdate}
        onRemindLater={remindLater}
        onSkipVersion={skipVersion}
      />
      {startupProjectWarning ? (
        <div
          role="alert"
          className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-background px-4 py-3 text-sm shadow-lg"
        >
          {startupProjectWarning}
        </div>
      ) : null}
    </DirectionProvider>
  );
}
