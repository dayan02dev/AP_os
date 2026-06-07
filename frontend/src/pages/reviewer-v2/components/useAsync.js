import { useCallback, useEffect, useRef, useState } from "react";

// Generic async data hook — loading / data / error states.
// Re-runs whenever deps change. Returns { loading, data, error, reload }.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const idRef = useRef(0);
  const run = useCallback(() => {
    const id = ++idRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then(
        (data) => {
          if (idRef.current === id) setState({ loading: false, data, error: null });
        },
        (error) => {
          if (idRef.current === id) setState({ loading: false, data: null, error });
        },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps || []);
  useEffect(run, deps || []); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: run };
}
