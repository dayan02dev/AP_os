import { useState, useRef, useCallback, useEffect } from "react";

// Generic async hook used by every reviewer screen (ported from the
// REVIEWER-UI prototype seam). Returns { loading, data, error, reload }.
// Re-runs whenever `deps` change; guards against out-of-order resolution.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const idRef = useRef(0);
  const run = useCallback(() => {
    const id = ++idRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (idRef.current === id) setState({ loading: false, data, error: null }); },
      (error) => { if (idRef.current === id) setState({ loading: false, data: null, error }); },
    );
  }, deps || []);
  useEffect(run, deps || []);
  return { ...state, reload: run };
}
