import { useEffect, useState } from "react";

/**
 * Load-state wrapper for the fixture-backed calls in `lib/intel/client.ts`.
 *
 * Small on purpose. It exists so every console panel shows the same three
 * states (loading / failed / loaded) from the same code path, rather than each
 * panel inventing its own `useState` triple and drifting. It is not a
 * general-purpose data layer and should not grow into one: when the real
 * endpoints arrive they will need caching, retry, and token refresh, and that
 * belongs in a proper query library rather than here.
 *
 * The `load` function is intentionally *not* in the effect's dependency list.
 * Callers pass an inline arrow (`() => fetchS2Cells()`), which is a new function
 * identity on every render; depending on it would refetch forever. `deps` is the
 * explicit refetch trigger instead, so a caller states when a reload is wanted
 * rather than having it inferred from an unstable identity.
 */
export interface IntelResource<T> {
  data: T | null;
  loading: boolean;
  /** Message suitable for display. Null when there is no error. */
  error: string | null;
}

export function useIntelResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
): IntelResource<T> {
  const [state, setState] = useState<IntelResource<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // Guards against a late resolve writing over a newer request's result, and
    // against setting state after unmount.
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    load().then(
      (data) => {
        if (active) setState({ data, loading: false, error: null });
      },
      (cause: unknown) => {
        if (!active) return;
        setState({
          data: null,
          loading: false,
          error: cause instanceof Error ? cause.message : "Request failed",
        });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above
    // on why `load` is excluded and `deps` is the refetch trigger.
  }, deps);

  return state;
}
