// UserRolesPanel — left-column "Roles" .card on /admin/users/:id.
//
// Visual contract: ARTPARK design system §6.4 — a list of all six roles
// with inline grant/revoke ghost buttons. No icons (the brief is explicit).
// Revoke triggers a confirmation modal per §5.5.

import { useEffect, useRef, useState } from "react";
import { adminApi } from "../../lib/adminApi.js";

const ROLES = [
  { id: "admin",      label: "Admin",      blurb: "Manages users + system settings." },
  { id: "leadership", label: "Leadership", blurb: "Sees every application, assigns reviewers, decides Gate 1." },
  { id: "reviewer",   label: "Reviewer",   blurb: "Scores applications assigned by leadership." },
  { id: "mentor",     label: "Mentor",     blurb: "Guides accepted founders. Phase 2." },
  { id: "founder",    label: "Founder",    blurb: "Post-acceptance milestones. Phase 2." },
  { id: "applicant",  label: "Applicant",  blurb: "Pre-acceptance wizard access. Self-granted on signup." },
];

function friendlyError(err, action) {
  const code = err?.details?.detail?.code ?? err?.details?.code ?? err?.code;
  if (code === "last_admin_protection") {
    return "Can't revoke — this is the last admin. Grant admin to another user first.";
  }
  if (code === "already_granted") return "This user already has this role.";
  return err?.message || `Couldn't ${action} role.`;
}

export default function UserRolesPanel({ userId, roles, onRolesChanged }) {
  const grantedSet = new Set((roles ?? []).map((r) => (typeof r === "string" ? r : r.role)));

  const [inflight, setInflight] = useState(() => new Set());
  const [panelError, setPanelError] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const [revokeFor, setRevokeFor] = useState(null);

  function flag(role, on) {
    setInflight((prev) => {
      const next = new Set(prev);
      if (on) next.add(role); else next.delete(role);
      return next;
    });
  }

  function showToast(msg, kind = "info") {
    const id = Date.now();
    setToast({ id, msg, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((t) => (t?.id === id ? null : t));
      toastTimerRef.current = null;
    }, 3000);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  async function grant(role) {
    if (inflight.has(role)) return;
    flag(role, true);
    setPanelError(null);
    try {
      await adminApi.grantRole(userId, role);
      await onRolesChanged?.();
      showToast(`${ROLES.find((r) => r.id === role)?.label} role granted.`);
    } catch (err) {
      setPanelError(friendlyError(err, "grant"));
    } finally {
      flag(role, false);
    }
  }

  async function confirmRevoke() {
    if (!revokeFor) return;
    const role = revokeFor;
    setRevokeFor(null);
    flag(role, true);
    setPanelError(null);
    try {
      await adminApi.revokeRole(userId, role);
      await onRolesChanged?.();
      showToast(`${ROLES.find((r) => r.id === role)?.label} role revoked.`);
    } catch (err) {
      setPanelError(friendlyError(err, "revoke"));
    } finally {
      flag(role, false);
    }
  }

  return (
    <section className="card">
      <div className="section-head" style={{ marginBottom: "var(--s-3)" }}>
        <span className="eyebrow">Roles</span>
        <h2 style={{ marginTop: "var(--s-2)" }}>Access &amp; capabilities.</h2>
        <p>Grant or revoke roles. Each role unlocks a different surface of the platform.</p>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ROLES.map((r) => {
          const granted = grantedSet.has(r.id);
          const busy = inflight.has(r.id);
          return (
            <li
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "var(--s-4)",
                alignItems: "center",
                padding: "var(--s-3) 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--s-2)" }}>
                  <span className={`dot ${granted ? "green" : "dim"}`} />
                  <strong style={{ fontSize: 15 }}>{r.label}</strong>
                </div>
                <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 2 }}>
                  {r.blurb}
                </div>
              </div>
              {granted ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => setRevokeFor(r.id)}
                >
                  {busy ? "Working…" : "Revoke"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => grant(r.id)}
                >
                  {busy ? "Working…" : "Grant"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {panelError && (
        <div className="inline-error" role="alert" style={{ marginTop: "var(--s-4)" }}>
          {panelError}
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind === "error" ? "error" : "info"}`} role="status">
          {toast.msg}
        </div>
      )}

      {revokeFor && (
        <div
          className="modal-scrim"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRevokeFor(null);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
            <span className="modal-eyebrow">Revoke role</span>
            <h2 id="revoke-title">Revoke {ROLES.find((r) => r.id === revokeFor)?.label}.</h2>
            <div className="modal-body">
              <p>
                The user will lose every capability tied to this role immediately.
                They keep their other roles. You can grant the role back at any time.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRevokeFor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-destructive"
                onClick={confirmRevoke}
              >
                Revoke <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
