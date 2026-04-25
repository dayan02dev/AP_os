// useApplication — owns the draft application row.
//
//   application      Normalised answers dict keyed by question-id, plus
//                    system fields (id, status, completion_pct, ...).
//   saving           'idle' | 'saving' | 'saved' | 'error'
//   error            Last ApiError (cleared on successful save)
//   locked           true when status !== 'draft' (backend says read-only)
//   save(updates)    { questionId: value, ... } — debounced 800ms, optimistic
//   submit()         resolves to the backend's response; rejects with
//                    ApiError if 422 (error.details carries missing/invalid)
//   completion       { completion_pct, missing_required_fields, current_section }
//
// All network calls go through lib/api.js, so 401s are handled transparently
// via refresh.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { collapseFromRow, expandForPatch } from "../lib/fieldMap.js";
import { useAuth } from "./useAuth.jsx";

const ApplicationContext = createContext(null);

const DEBOUNCE_MS = 800;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

export function ApplicationProvider({ children }) {
  const { isAuthed } = useAuth();

  // `row` is the raw DB shape (keys like basic_full_name).
  // `answers` is the UI shape (keys like fullName) — derived via fieldMap.
  const [row, setRow] = useState(null);
  // Submitted applications history (multi-app). Loaded lazily via
  // refreshSubmitted() — usually when ReturningChoiceScreen mounts.
  const [submittedApps, setSubmittedApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savingState, setSavingState] = useState("idle");
  const [completion, setCompletion] = useState({
    completion_pct: 0,
    missing_required_fields: [],
    current_section: null,
  });

  const pendingPatchRef = useRef({}); // { dbColumn: value } accumulated since last flush
  const debounceRef = useRef(null);
  const locked = row ? row.status !== "draft" : false;

  // Rehydrate on auth. Loads the open draft (the backend auto-creates one
  // if none exists, so first-time users get an empty form) AND the user's
  // submitted history in parallel — the latter powers the Past tab on
  // ReturningChoiceScreen.
  useEffect(() => {
    if (!isAuthed) {
      setRow(null);
      setSubmittedApps([]);
      setCompletion({ completion_pct: 0, missing_required_fields: [], current_section: null });
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const [r, past] = await Promise.all([
          api.get("/applications/me"),
          api.get("/applications/me/submitted").catch(() => []),
        ]);
        if (cancelled) return;
        setRow(r);
        setSubmittedApps(Array.isArray(past) ? past : []);
        setCompletion({
          completion_pct: r.completion_pct ?? 0,
          missing_required_fields: [],
          current_section: r.current_section ?? null,
        });
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  // Flushes the pending patch buffer to the backend with retry.
  const flush = useCallback(async () => {
    const patch = pendingPatchRef.current;
    if (!patch || Object.keys(patch).length === 0) return;
    pendingPatchRef.current = {};

    setSavingState("saving");
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
      try {
        const updated = await api.patch("/applications/me", patch);
        setRow(updated);
        setCompletion((prev) => ({
          ...prev,
          completion_pct: updated.completion_pct ?? prev.completion_pct,
          current_section: updated.current_section ?? prev.current_section,
        }));
        setSavingState("saved");
        setError(null);
        return;
      } catch (err) {
        lastErr = err;
        // 409 → application is no longer editable. Stop retrying.
        if (err instanceof ApiError && err.status === 409) {
          setError(err);
          setSavingState("error");
          // Re-fetch so `locked` flips via the new status.
          try {
            const fresh = await api.get("/applications/me");
            setRow(fresh);
          } catch {
            /* ignore */
          }
          return;
        }
        // 400/422 → validation issue. No point retrying with the same body.
        if (err instanceof ApiError && [400, 422].includes(err.status)) {
          setError(err);
          setSavingState("error");
          return;
        }
        // 401 was already handled inside apiCall (refresh + retry). If it
        // reaches here, session is truly gone — nothing more we can do.
        if (err instanceof ApiError && err.status === 401) {
          setError(err);
          setSavingState("error");
          return;
        }
        // Transient — back off then retry.
        if (attempt < RETRY_BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
        }
      }
    }
    setError(lastErr);
    setSavingState("error");
  }, []);

  // save({questionId: value, ...}) — optimistic, debounced, coalesces.
  const save = useCallback(
    (updates) => {
      if (!updates || typeof updates !== "object") return;
      if (locked) return;

      // Optimistic local update so the UI reflects the change immediately.
      setRow((prev) => {
        const next = { ...(prev || {}) };
        const dbPatch = expandForPatch(updates);
        Object.assign(next, dbPatch);
        if ("current_section" in updates) next.current_section = updates.current_section;
        return next;
      });

      // Accumulate into pending patch.
      Object.assign(pendingPatchRef.current, expandForPatch(updates));
      if ("current_section" in updates) {
        pendingPatchRef.current.current_section = updates.current_section;
      }

      // Debounce the flush.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush, locked],
  );

  // Immediate flush (e.g. before navigation).
  const flushNow = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await flush();
  }, [flush]);

  const submit = useCallback(async () => {
    await flushNow();
    try {
      const result = await api.post("/applications/me/submit", null);
      // Multi-app: GET /applications/me would auto-create a NEW empty
      // draft now (the just-submitted row no longer matches status='draft'),
      // which would clobber the DoneScreen state. Patch the existing row
      // locally so `locked` flips and DoneScreen renders, and refresh the
      // submitted-history list so the Past tab includes this submission.
      setRow((prev) =>
        prev
          ? {
              ...prev,
              status: "submitted",
              submitted_at: result?.submitted_at || new Date().toISOString(),
              completion_pct: 100,
            }
          : prev,
      );
      try {
        const past = await api.get("/applications/me/submitted");
        setSubmittedApps(Array.isArray(past) ? past : []);
      } catch {
        /* ignore — the Past tab will reload on next mount */
      }
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [flushNow]);

  // Multi-app: explicitly start a fresh application. Hits GET /me which
  // auto-creates a new draft (because the previous one is now submitted),
  // and refreshes the submitted list so the prior application shows up
  // in the Past tab. Caller is responsible for resetting wizard phase.
  const startNew = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fresh, past] = await Promise.all([
        api.get("/applications/me"),
        api.get("/applications/me/submitted").catch(() => []),
      ]);
      setRow(fresh);
      setSubmittedApps(Array.isArray(past) ? past : []);
      setCompletion({
        completion_pct: fresh.completion_pct ?? 0,
        missing_required_fields: [],
        current_section: fresh.current_section ?? null,
      });
      return fresh;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSubmitted = useCallback(async () => {
    try {
      const past = await api.get("/applications/me/submitted");
      const list = Array.isArray(past) ? past : [];
      setSubmittedApps(list);
      return list;
    } catch (err) {
      setError(err);
      return [];
    }
  }, []);

  const fetchCompletion = useCallback(async () => {
    try {
      const c = await api.get("/applications/me/completion");
      setCompletion(c);
      return c;
    } catch (err) {
      setError(err);
      return null;
    }
  }, []);

  // Cleanup debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const answers = useMemo(() => collapseFromRow(row), [row]);

  const value = {
    application: row,
    answers,
    loading,
    saving: savingState,
    error,
    locked,
    completion,
    submittedApps,
    save,
    flushNow,
    submit,
    startNew,
    refreshSubmitted,
    fetchCompletion,
    refetch: async () => {
      try {
        const r = await api.get("/applications/me");
        setRow(r);
        return r;
      } catch (err) {
        setError(err);
        return null;
      }
    },
  };

  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication() {
  const ctx = useContext(ApplicationContext);
  if (!ctx) throw new Error("useApplication must be used within <ApplicationProvider>");
  return ctx;
}
