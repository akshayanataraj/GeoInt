import { useAppStore } from "@geolibre/core";
import { useLayoutEffect } from "react";
import { readLastBasemap, writeLastBasemap } from "../lib/last-basemap";

/** Restore the last basemap into the empty startup workspace and track changes. */
export function useLastBasemapPersistence(): void {
  useLayoutEffect(() => {
    const state = useAppStore.getState();
    const storedBasemap = readLastBasemap();

    // Never replace a project that another startup source already loaded.
    if (
      storedBasemap !== null &&
      state.projectGeneration === 0 &&
      state.projectPath === null &&
      !state.isDirty
    ) {
      // Upstream also re-derived the ellipsoid from the stored basemap here,
      // since a planetary basemap implied a celestial body. Earth is the only
      // body now, so the basemap is all there is to restore.
      useAppStore.setState({ basemapStyleUrl: storedBasemap });
    }

    writeLastBasemap(useAppStore.getState().basemapStyleUrl);
    return useAppStore.subscribe((next, previous) => {
      if (next.basemapStyleUrl !== previous.basemapStyleUrl) {
        writeLastBasemap(next.basemapStyleUrl);
      }
    });
  }, []);
}
