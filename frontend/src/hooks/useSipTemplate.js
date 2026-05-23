// useSipTemplate — SIP equivalent of useTemplate. Manages upload → poll →
// auto-apply for the SIP offline template. NULL-only apply semantics
// matter for the UI: the toast composer shows "kept (you'd already typed
// them)" from result.skipped_fields.
//
//   upload(file)   POST /sip-application-templates/upload, then auto-applies
//                  on parse_status='completed'. Polls GET /me up to 10×3s
//                  if the upload returns 'pending'/'processing'.
//   apply()        manual re-apply — surface only if the auto-apply failed.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useSipTemplate({ onApplied } = {}) {
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
      const result = await api.applySipTemplate();
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
        const latest = await api.getMySipTemplate();
        setTpl(latest);
        if (latest.parse_status === "completed") {
          setParsing(false);
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
        // eslint-disable-next-line no-console
        console.warn("[useSipTemplate] poll error:", err?.message);
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
        const response = await api.uploadSipTemplate(file, {});
        setTpl(response);
        if (response.parse_status === "completed") {
          setParsing(false);
          try {
            await apply();
          } catch {
            /* swallow — handled via error */
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
