import { useState, useRef, useCallback, useEffect } from "react";

// Generic async hook used by every reviewer screen (ported from the
// REVIEWER-UI prototype seam). Returns { loading, data, error, reload }.
// Re-runs whenever `deps` change; guards against out-of-order resolution.
//
// reload({ background: true }) is for refetches the user did not ask for
// (window focus): it is skipped while a request is already in flight, and if
// it fails the previous data stays on screen instead of an error state.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const idRef = useRef(0);
  const inFlight = useRef(false);
  const run = useCallback((opts) => {
    const background = opts?.background === true;
    if (background && inFlight.current) return;
    const id = ++idRef.current;
    inFlight.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => {
        if (idRef.current !== id) return;
        inFlight.current = false;
        setState({ loading: false, data, error: null });
      },
      (error) => {
        if (idRef.current !== id) return;
        inFlight.current = false;
        setState((s) => (background && s.data != null
          ? { loading: false, data: s.data, error: null }
          : { loading: false, data: null, error }));
      },
    );
  }, deps || []);
  useEffect(run, deps || []);
  return { ...state, reload: run };
}
