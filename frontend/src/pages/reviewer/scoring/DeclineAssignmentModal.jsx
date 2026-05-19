import { useState } from "react";

const MIN_REASON_CHARS = 10;

export default function DeclineAssignmentModal({ assignmentId, onConfirm, onCancel, isPending }) {
  const [reason, setReason] = useState("");
  const tooShort = reason.trim().length < MIN_REASON_CHARS;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="decline-title">
      <div className="modal">
        <span className="modal-eyebrow">Assignment</span>
        <h2 id="decline-title">Decline this assignment.</h2>
        <div className="modal-body">
          <p>
            Leadership will be notified and may reassign this application. Tell them
            why so they pick someone better next time.
          </p>
          <label className="field-label" htmlFor={`decline-reason-${assignmentId}`}>Reason</label>
          <textarea
            id={`decline-reason-${assignmentId}`}
            className="field"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="At least 10 characters, please."
          />
          <p className="field-help">{reason.trim().length}/{MIN_REASON_CHARS} characters</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: "var(--accent-coral)" }}
            disabled={tooShort || isPending}
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? "Declining…" : "Decline assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
