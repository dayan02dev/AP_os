// useSipApplication — owns the draft SIP application row.
// Mirrors useApplication.jsx but hits /sip-applications/* endpoints.
//
// Track-mismatch detection: if /sip-applications/me returns 403 with
// code "wrong_track", the hook surfaces `wrongTrack=true` so the
// router can render the dedicated mismatch page.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "../lib/api.js";
import {
  collapseFromRowSip,
  expandForPatchSip,
} from "../lib/fieldMap-sip.js";
import { useAuth } from "./useAuth.jsx";

const SipApplicationContext = createContext(null);

const DEBOUNCE_MS = 800;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

export function SipApplicationProvider({ children }) {
  const { isAuthed } = useAuth();

  const [row, setRow] = useState(null);
  const [submittedApps, setSubmittedApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wrongTrack, setWrongTrack] = useState(false);
  const [savingState, setSavingState] = useState("idle");
  const [completion, setCompletion] = useState({
    completion_pct: 0,
    missing_required_fields: [],
    current_section: null,
  });

  const pendingPatchRef = useRef({});
  const debounceRef = useRef(null);
  const locked = row ? row.status !== "draft" : false;

  useEffect(() => {
    if (!isAuthed) {
      setRow(null);
      setSubmittedApps([]);
      setWrongTrack(false);
      setCompletion({
        completion_pct: 0,
        missing_required_fields: [],
        current_section: null,
      });
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWrongTrack(false);
    async function load() {
      try {
        const [r, past] = await Promise.all([
          api.get("/sip-applications/me"),
          api.get("/sip-applications/me/submitted").catch(() => []),
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
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403 && err.code === "wrong_track") {
          setWrongTrack(true);
        } else {
          setError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const flush = useCallback(async () => {
    const patch = pendingPatchRef.current;
    if (!patch || Object.keys(patch).length === 0) return;
    pendingPatchRef.current = {};

    setSavingState("saving");
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
      try {
        const updated = await api.patch("/sip-applications/me", patch);
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
        if (err instanceof ApiError && err.status === 409) {
          setError(err);
          setSavingState("error");
          try {
            const fresh = await api.get("/sip-applications/me");
            setRow(fresh);
          } catch {
            /* ignore */
          }
          return;
        }
        if (err instanceof ApiError && [400, 422].includes(err.status)) {
          setError(err);
          setSavingState("error");
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          setError(err);
          setSavingState("error");
          return;
        }
        if (attempt < RETRY_BACKOFF_MS.length) {
          await new Promise((r) =>
            setTimeout(r, RETRY_BACKOFF_MS[attempt]),
          );
        }
      }
    }
    setError(lastErr);
    setSavingState("error");
  }, []);

  const save = useCallback(
    (updates) => {
      if (!updates || typeof updates !== "object") return;
      if (locked) return;

      setRow((prev) => {
        const next = { ...(prev || {}) };
        const dbPatch = expandForPatchSip(updates);
        Object.assign(next, dbPatch);
        if ("current_section" in updates)
          next.current_section = updates.current_section;
        return next;
      });

      Object.assign(pendingPatchRef.current, expandForPatchSip(updates));
      if ("current_section" in updates) {
        pendingPatchRef.current.current_section = updates.current_section;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush, locked],
  );

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
      const result = await api.post("/sip-applications/me/submit", null);
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
        const past = await api.get("/sip-applications/me/submitted");
        setSubmittedApps(Array.isArray(past) ? past : []);
      } catch {
        /* ignore */
      }
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [flushNow]);

  const startNew = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fresh, past] = await Promise.all([
        api.get("/sip-applications/me"),
        api.get("/sip-applications/me/submitted").catch(() => []),
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

  const saveSubmittedField = useCallback(async (appId, questionId, value) => {
    const patch = expandForPatchSip({ [questionId]: value });
    const updated = await api.editSubmitted("sip", appId, patch);
    setSubmittedApps((prev) => prev.map((a) => (a.id === appId ? updated : a)));
    return updated;
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const answers = useMemo(() => collapseFromRowSip(row), [row]);

  const value = {
    application: row,
    answers,
    loading,
    saving: savingState,
    error,
    locked,
    completion,
    submittedApps,
    wrongTrack,
    save,
    flushNow,
    submit,
    startNew,
    saveSubmittedField,
    refetch: async () => {
      try {
        const r = await api.get("/sip-applications/me");
        setRow(r);
        return r;
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && err.code === "wrong_track") {
          setWrongTrack(true);
        } else {
          setError(err);
        }
        return null;
      }
    },
  };

  return (
    <SipApplicationContext.Provider value={value}>
      {children}
    </SipApplicationContext.Provider>
  );
}

export function useSipApplication() {
  const ctx = useContext(SipApplicationContext);
  if (!ctx)
    throw new Error(
      "useSipApplication must be used within <SipApplicationProvider>",
    );
  return ctx;
}
