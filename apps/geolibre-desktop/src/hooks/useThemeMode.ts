import { useCallback, useLayoutEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

/**
 * Dark-first by design (UI_REPURPOSE_PLAN.md §2a: a dark command-console
 * product, not a generic light/dark toggle), so unlike the upstream default
 * this ignores `prefers-color-scheme` -- a user on a light-themed OS still
 * gets the product's actual identity on first load. `?theme=` and the
 * in-app Settings toggle remain the only ways to get light mode.
 */
export function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  // An explicit `?theme=dark` / `?theme=light` overrides the default on load
  // (handy for embeds); the in-app toggle still works afterwards.
  const themeParam = new URLSearchParams(window.location.search).get("theme")?.trim().toLowerCase();
  if (themeParam === "dark" || themeParam === "light") {
    return themeParam;
  }

  return "dark";
}

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

  useLayoutEffect(() => {
    const isDark = themeMode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((currentThemeMode) => (currentThemeMode === "dark" ? "light" : "dark"));
  }, []);

  return { themeMode, toggleThemeMode };
}
