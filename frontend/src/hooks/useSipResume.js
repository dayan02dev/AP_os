// useSipResume — mirror of useResume but hits /sip-resume/* endpoints.
//
// Backend uses the same parser logic; only the storage bucket and table
// differ (sip-resumes / sip_resume_uploads). Track guard means a wrong-
// track user gets 403 here too — surfaced as a regular error so the page
// can still render the parent track-mismatch screen via useSipApplication.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, UPLOAD_TIMEOUT_MS } from "../lib/api.js";
import { loadSession } from "../lib/session.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useSipResume() {
  const [resume, setResume] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    if (!loadSession()) return;
    let cancelled = false;
    api
      .get("/sip-resume/me")
      .then((latest) => {
        if (!cancelled) setResume(latest);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) return;
        // Wrong-track / network errors quietly leave resume=null.
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
        const latest = await api.get("/sip-resume/me");
        setResume(latest);
        if (
          latest.parse_status === "completed" ||
          latest.parse_status === "failed"
        ) {
          setParsing(false);
          return latest;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useSipResume] poll error:", err?.message);
      }
    }
    setParsing(false);
    return null;
  }, []);

  const upload = useCallback(
    async (file) => {
      setError(null);
      setUploading(true);
      setResume(null);
      setParsing(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post("/sip-resume/upload", formData, {
          timeoutMs: UPLOAD_TIMEOUT_MS,
        });
        setResume(response);
        if (
          response.parse_status === "pending" ||
          response.parse_status === "processing"
        ) {
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
      return await api.post("/sip-resume/me/apply-to-application", null);
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const latest = await api.get("/sip-resume/me");
      setResume(latest);
      return latest;
    } catch (err) {
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
