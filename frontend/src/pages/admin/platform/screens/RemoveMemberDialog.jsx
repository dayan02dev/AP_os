// RemoveMemberDialog — the confirm step behind every "Delete" on the reviewer
// and jury rosters.
//
// Deleting a panel member is destructive and asymmetric, so the dialog spells
// out what actually happens rather than asking a bare "are you sure?":
//   · their applications are RELEASED (from them only — co-reviewers, the
//     batch, and the applications themselves are untouched)
//   · a reviewer's submitted reviews and scores are KEPT
//   · the account itself survives; only this one role is revoked
// Typing the member's name is required, matching the weight of the action.
//
// `kind` is "reviewer" | "jury". `onConfirm` returns the API result so the
// caller can report the counters back to the admin.

import React, { useState } from "react";

const COPY = {
  reviewer: {
    title: "Remove reviewer",
    role: "reviewer",
    effects: [
      "Every application assigned to them is released — from this reviewer only. Co-reviewers, the batch, and the applications themselves are untouched.",
      "Their submitted reviews, scores and recommendations are KEPT, and stay visible on each application.",
      "They are removed from every batch and from the reviewer roster.",
    ],
  },
  jury: {
    title: "Remove jury member",
    role: "jury",
    effects: [
      "Every application assigned to them is released — from this juror only. Other jurors keep theirs.",
      "Their picks and AI recommendations are removed.",
      "Their invite is cleared, so this address can be invited again.",
    ],
  },
};

export function RemoveMemberDialog({ kind, member, onClose, onConfirm }) {
  const copy = COPY[kind] || COPY.reviewer;
  const name = member?.name || member?.email || "this member";
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const matches = typed.trim().toLowerCase() === String(name).trim().toLowerCase();

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Remove failed.");
      setBusy(false);
    }
  };

  return (
    <div
      className="os-modal-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.55)", backdropFilter: "blur(4px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="os-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4, boxShadow: "0 20px 60px rgba(36,36,36,0.2)" }}
      >
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "#b3262b" }}>{copy.title}</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }} aria-label="Close">&times;</button>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="os-text-sm">
            Remove <strong>{name}</strong>
            {member?.email && member?.name ? <span className="os-text-soft"> ({member.email})</span> : null}
            {" "}from the {copy.role} roster.
          </div>

          <ul className="os-text-sm os-text-soft" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            {copy.effects.map((t, i) => <li key={i}>{t}</li>)}
          </ul>

          <div className="os-text-xs os-text-dim">
            Their sign-in account is not deleted — only the {copy.role} role is
            revoked, so any other access they hold is unaffected.
          </div>

          <div>
            <label className="os-text-xs os-text-dim os-uppercase" htmlFor="rm-confirm" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
              Type <code>{name}</code> to confirm
            </label>
            <input
              id="rm-confirm"
              className="os-input os-w-100"
              aria-label="Confirm member name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
          </div>

          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }} role="alert">{err}</div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className="os-btn"
              style={{
                background: matches ? "#d23b40" : "var(--bg-soft)",
                borderColor: matches ? "#d23b40" : "var(--line)",
                color: matches ? "#fff" : "var(--ink-dim)",
                cursor: matches ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
              onClick={run}
              disabled={!matches || busy}
            >
              {busy ? "Removing…" : copy.title}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Message an admin sees after a successful removal — states what was released
// and, for reviewers, that the scored work survived.
export function removalSummary(kind, name, result) {
  const r = result || {};
  if (kind === "jury") {
    return `${name} removed from the jury roster · ${r.assignments_removed ?? 0} application(s) released` +
      `, ${r.picks_removed ?? 0} pick(s) cleared${r.invite_removed ? ", invite cleared" : ""}.`;
  }
  return `${name} removed from the reviewer roster · ${r.assignments_removed ?? 0} application(s) released` +
    `, ${r.reviews_kept ?? 0} review(s) kept.`;
}

export default RemoveMemberDialog;
