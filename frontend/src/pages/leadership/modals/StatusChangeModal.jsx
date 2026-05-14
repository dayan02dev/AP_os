// StatusChangeModal — Phase 1 status state machine (spec §4.8).
//
// Renders only the legal next states for the application's current status,
// derived from the client-side mirror in `lib/statusMachine.js`. The backend
// re-validates on submit and 422s anything stale, so this dropdown is a
// usability hint, not the authority.
//
// Visual language matches the drawer: same overlay, same border + spacing
// tokens, same `eir-mono`/`eir-dim` classes. Inline styles only — keeps the
// modal self-contained without touching leadership.css.

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

  // a11y: Escape closes; focus the panel on mount; lock background scroll.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, submitting]);

  // Guard: no application or no legal transitions → render a small notice
  // instead of an empty dropdown. The drawer should never open this modal
  // for a terminal status, but defensive against future edits.
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
      // Surface the backend's `detail` if present so the user sees an
      // actionable message ("illegal_transition", "Phase 1.5 hint", …).
      const detail = err?.details;
      const code = detail?.code || err?.code;
      const message = detail?.hint || detail?.message || err?.message
        || "Failed to change status.";
      const extra = detail?.allowed?.length
        ? ` Allowed: ${detail.allowed.join(", ")}.`
        : "";
      setError(`${code ? `[${code}] ` : ""}${message}${extra}`);
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={!submitting ? onClose : undefined}>
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-change-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div style={headStyle}>
          <div>
            <div className="eir-mono eir-dim" style={kickerStyle}>
              § Change status
            </div>
            <h3 id="status-change-title" style={titleStyle}>
              {application.basic_full_name || application.id?.slice(0, 8)}
            </h3>
            <div className="eir-mono eir-dim" style={subStyle}>
              {(track || "").toUpperCase()} · current ·{" "}
              <strong>{labelFor(currentStatus)}</strong>
            </div>
          </div>
          <button
            type="button"
            className="eir-mono"
            style={closeBtnStyle}
            onClick={onClose}
            disabled={submitting}
          >
            close ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          {allowed.length === 0 ? (
            <p style={emptyStyle}>
              No further leadership-initiated transitions are available from
              <strong> {labelFor(currentStatus)} </strong> in Phase 1.
              {currentStatus !== "withdrawn" && (
                <> Phase 1.5 will add escalation paths (rewinds, re-screen).</>
              )}
            </p>
          ) : (
            <>
              <label style={labelStyle}>
                <span className="eir-mono eir-dim" style={fieldLabelStyle}>
                  New status
                </span>
                <select
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  style={selectStyle}
                  disabled={submitting}
                >
                  {allowed.map((s) => (
                    <option key={s} value={s}>
                      {labelFor(s)}
                    </option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                <span className="eir-mono eir-dim" style={fieldLabelStyle}>
                  Reason <span style={{ textTransform: "none" }}>(optional, shown in audit log)</span>
                </span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Strong fit on technical depth + commitment signal."
                  style={textareaStyle}
                  disabled={submitting}
                  maxLength={2000}
                />
              </label>
            </>
          )}

          {error && (
            <div className="lp-error" role="alert" style={errorStyle}>
              {error}
            </div>
          )}

          <div style={actionsStyle}>
            <button
              type="button"
              className="lp-drawer-action-btn"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="lp-drawer-action-btn is-primary"
              disabled={submitting || allowed.length === 0 || !toStatus}
            >
              {submitting ? "Saving…" : "Confirm change"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Inline style tokens (mirror leadership.css variables) ──────────────

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "color-mix(in srgb, var(--ink) 32%, transparent)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60, // above the drawer (which sits below this in modal stack)
  padding: 24,
};

const panelStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  width: "min(560px, 100%)",
  maxHeight: "calc(100vh - 48px)",
  display: "flex",
  flexDirection: "column",
  outline: "none",
};

const headStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: 20,
  borderBottom: "1px solid var(--line)",
};

const kickerStyle = {
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const titleStyle = {
  margin: "6px 0 4px",
  fontFamily: "var(--font-serif)",
  fontSize: 22,
  color: "var(--ink)",
};

const subStyle = {
  fontSize: 11,
  letterSpacing: "0.08em",
};

const closeBtnStyle = {
  background: "transparent",
  border: "1px solid var(--line)",
  padding: "4px 10px",
  fontSize: 11,
  cursor: "pointer",
  color: "var(--ink-dim)",
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 20,
  overflowY: "auto",
};

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const fieldLabelStyle = {
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const selectStyle = {
  fontFamily: "inherit",
  fontSize: 14,
  padding: "8px 10px",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink)",
};

const textareaStyle = {
  fontFamily: "inherit",
  fontSize: 13,
  padding: "10px 12px",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--ink)",
  resize: "vertical",
  minHeight: 64,
};

const emptyStyle = {
  fontSize: 13,
  color: "var(--ink-dim)",
  lineHeight: 1.5,
  margin: 0,
  padding: "12px 14px",
  border: "1px dashed var(--line)",
  background: "var(--bg-soft)",
};

const errorStyle = {
  fontSize: 12,
  padding: "8px 12px",
  border: "1px solid var(--line)",
  background: "var(--bg-soft)",
  color: "var(--ink)",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  paddingTop: 8,
  borderTop: "1px solid var(--line)",
  marginTop: 4,
};
