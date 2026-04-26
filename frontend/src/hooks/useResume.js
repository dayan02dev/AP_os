// useResume — upload + polling + "apply parsed data to application".
//
//   upload(file)                kicks off POST /resume/upload; if the server
//                               responds with parse_status='processing', polls
//                               GET /resume/me every 3s up to 10 times.
//   applyToApplication()        POST /resume/me/apply-to-application; caller
//                               should then call useApplication.refetch().

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, UPLOAD_TIMEOUT_MS } from "../lib/api.js";
import { loadSession } from "../lib/session.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useResume() {
  const [resume, setResume] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);

  // Fetch any existing resume on mount so callers can skip the upload step
  // if the user already has one. 404 is expected (no resume yet) and
  // silently swallowed.
  useEffect(() => {
    if (!loadSession()) return;
    let cancelled = false;
    api
      .get("/resume/me")
      .then((latest) => {
        if (!cancelled) setResume(latest);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) return;
        // Non-404 errors just leave resume=null; the upload step still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    },
    [],
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollUntilDone = useCallback(async () => {
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise((r) => {
        pollTimerRef.current = setTimeout(r, POLL_INTERVAL_MS);
      });
      try {
        const latest = await api.get("/resume/me");
        setResume(latest);
        if (latest.parse_status === "completed" || latest.parse_status === "failed") {
          setParsing(false);
          return latest;
        }
      } catch (err) {
        // Polling is best-effort; keep trying until budget runs out.
        // eslint-disable-next-line no-console
        console.warn("[useResume] poll error:", err?.message);
      }
    }
    setParsing(false);
    return null;
  }, []);

  const upload = useCallback(
    async (file) => {
      setError(null);
      setUploading(true);
      // Clear any stale resume in state BEFORE the new upload starts.
      // Without this, downstream components (ParsedReviewScreen) can read
      // .parsed_data from the previous session's CV during the window
      // between "user clicked upload" and "backend returned" — leading to
      // the previous applicant's data being displayed for the new resume.
      setResume(null);
      setParsing(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post("/resume/upload", formData, {
          timeoutMs: UPLOAD_TIMEOUT_MS,
        });
        setResume(response);
        if (response.parse_status === "pending" || response.parse_status === "processing") {
          pollUntilDone();
        } else {
          setParsing(false);
        }
        return response;
      } catch (err) {
        setError(err);
        setParsing(false);
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [pollUntilDone],
  );

  const applyToApplication = useCallback(async () => {
    setError(null);
    try {
      return await api.post("/resume/me/apply-to-application", null);
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const latest = await api.get("/resume/me");
      setResume(latest);
      return latest;
    } catch (err) {
      // 404 here just means no resume uploaded yet — that's fine.
      return null;
    }
  }, []);

  return {
    resume,
    uploading,
    parsing,
    error,
    upload,
    applyToApplication,
    refresh,
    stopPolling,
  };
}
