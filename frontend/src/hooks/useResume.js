// useResume — upload + polling + "apply parsed data to application".
//
//   upload(file)                kicks off POST /resume/upload; if the server
//                               responds with parse_status='processing', polls
//                               GET /resume/me every 3s up to 10 times.
//   applyToApplication()        POST /resume/me/apply-to-application; caller
//                               should then call useApplication.refetch().

import { useCallback, useEffect, useRef, useState } from "react";
import { api, UPLOAD_TIMEOUT_MS } from "../lib/api.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useResume() {
  const [resume, setResume] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);

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
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post("/resume/upload", formData, {
          timeoutMs: UPLOAD_TIMEOUT_MS,
        });
        setResume(response);
        if (response.parse_status === "pending" || response.parse_status === "processing") {
          setParsing(true);
          pollUntilDone();
        }
        return response;
      } catch (err) {
        setError(err);
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
