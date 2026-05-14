// StatusChangeModal — Phase 1 status state machine (spec §4.8).
//
// Visual contract: ARTPARK design system §5.5 .modal. Lists only the
// legal next states for the current status (mirror of LEGAL_TRANSITIONS
// in lib/statusMachine.js). Backend re-validates on submit and 422s
// anything stale.

import { useEffect, useMemo, useRef, useState } from "react";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { labelFor, legalNextStates } from "../../../lib/statusMachine.js";

export default function StatusChangeModal({ application, onClose, onSuccess }) {
  const currentStatus = application?.status || null;
  const track = application?.track || null;
  const allowed = useMemo(() => legalNextStates(currentStatus), [currentStatus]);

  const [toStatus, setToStatus] = useState(allowed[0] || "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, submitting]);

  if (!application) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!toStatus || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await leadershipApi.changeStatus(
        application.id,
        track,
        toStatus,
        reason.trim() || null,
      );
      onSuccess?.();
    } catch (err) {
      const detail = err?.details;
      const code = detail?.code || err?.code;
      const hint = detail?.hint;
      const allowedList = detail?.allowed;
      let msg = hint || detail?.message || err?.message || "Failed to change status.";
      if (allowedList?.length) {
        msg = `${msg} Allowed: ${allowedList.join(", ")}.`;
      }
      setError(`${code ? `[${code}] ` : ""}${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onClick={(e) => { if (!submitting && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-change-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div>
          <span className="modal-eyebrow">Change status</span>
          <h2 id="status-change-title">
            Move {application.basic_full_name || application.id?.slice(0, 8)}.
          </h2>
        </div>

        <div className="modal-body">
          <p>
            Currently <strong style={{ textTransform: "capitalize" }}>
              {labelFor(currentStatus)}
            </strong> on the {(track || "").toUpperCase()} track. Pick the next state —
            only legal transitions per spec §4.8 are shown.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="modal-fields">
          {allowed.length === 0 ? (
            <div className="card card-soft">
              <span className="eyebrow">No moves available</span>
              <p style={{ marginTop: "var(--s-2)", color: "var(--ink-soft)", fontSize: 14 }}>
                No further leadership-initiated transitions are available from
                <strong> {labelFor(currentStatus)} </strong> in Phase 1.
                Phase 1.5 will add escalation paths.
              </p>
            </div>
          ) : (
            <>
              <div className="form-row">
                <label className="field-label" htmlFor="status-to">Move to</label>
                <select
                  id="status-to"
                  className="field"
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  disabled={submitting}
                >
                  {allowed.map((s) => (
                    <option key={s} value={s}>{labelFor(s)}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label className="field-label" htmlFor="status-reason">
                  Reason <span style={{ textTransform: "none", color: "var(--ink-dim)", fontWeight: 400 }}>
                    (optional — written to the audit log)
                  </span>
                </label>
                <textarea
                  id="status-reason"
                  className="field"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Strong fit on technical depth + commitment signal."
                  maxLength={2000}
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {error && <div className="inline-error" role="alert">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || allowed.length === 0 || !toStatus}
            >
              {submitting ? "Saving…" : (
                <>Confirm change <span className="arrow">→</span></>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
