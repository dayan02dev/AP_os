// useTemplate — offline template upload + parse + auto-apply.
//
// Mirrors useResume but for the second auto-fill mechanism: applicants
// download a Word .docx, fill it offline, upload it here. On successful
// parse we immediately call apply-to-application (NULL-only fill) so the
// wizard already has the answers when the applicant gets there.
//
//   upload(file)     POST /application-templates/upload, then auto-applies
//                    on parse_status='completed'. Polls GET /me up to 10×3s
//                    if the upload returns 'pending'/'processing'.
//   apply()          manual re-apply hook — surface an action only if the
//                    initial auto-apply failed for some reason.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, UPLOAD_TIMEOUT_MS } from "../lib/api.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useTemplate({ onApplied } = {}) {
  // Local state only: the upload widget always starts empty when a user
  // lands on it. The previous template (and its parsed answers) live in
  // the DB and have already been applied to the application row, so
  // there's nothing to recover into the UI — pre-populating the widget
  // with a stale "✓ parsed" chip just confused users who clicked
  // "Start new application" expecting a clean slate.
  const [tpl, setTpl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    },
    [],
  );

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const result = await api.post(
        "/application-templates/me/apply-to-application",
        null,
      );
      setApplyResult(result);
      if (onApplied) onApplied(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setApplying(false);
    }
  }, [onApplied]);

  const pollUntilDone = useCallback(async () => {
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise((r) => {
        pollTimerRef.current = setTimeout(r, POLL_INTERVAL_MS);
      });
      try {
        const latest = await api.get("/application-templates/me");
        setTpl(latest);
        if (latest.parse_status === "completed") {
          setParsing(false);
          // Auto-apply on first completion. Errors here are surfaced via
          // the `error` state but don't prevent the UI from settling.
          try {
            await apply();
          } catch {
            /* swallow — apply() already set error */
          }
          return latest;
        }
        if (latest.parse_status === "failed") {
          setParsing(false);
          return latest;
        }
      } catch (err) {
        // best-effort polling
        // eslint-disable-next-line no-console
        console.warn("[useTemplate] poll error:", err?.message);
      }
    }
    setParsing(false);
    return null;
  }, [apply]);

  const upload = useCallback(
    async (file) => {
      setError(null);
      setApplyResult(null);
      setUploading(true);
      setTpl(null);
      setParsing(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await api.post(
          "/application-templates/upload",
          formData,
          { timeoutMs: UPLOAD_TIMEOUT_MS },
        );
        setTpl(response);
        if (response.parse_status === "completed") {
          setParsing(false);
          try {
            await apply();
          } catch {
            /* swallow — handled in `error` */
          }
        } else if (
          response.parse_status === "pending" ||
          response.parse_status === "processing"
        ) {
          pollUntilDone();
        } else {
          // failed inline
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
    [apply, pollUntilDone],
  );

  return {
    template: tpl,
    uploading,
    parsing,
    applying,
    applyResult,
    error,
    upload,
    apply,
  };
}
