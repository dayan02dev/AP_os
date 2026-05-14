// UserRolesPanel — shows all 6 roles as cards with grant / revoke buttons.
//
// Props:
//   userId         string   — target user's id
//   roles          object[] — array of { role, granted_at, granted_by } from GET /admin/users/{id}
//   onRolesChanged fn       — called after a successful grant or revoke so the
//                             parent can re-fetch and pass fresh props

import { useEffect, useRef, useState } from "react";
import { adminApi } from "../../lib/adminApi.js";

const ROLE_META = {
  applicant:  { label: "Applicant",  icon: "✏",  sub: "submit & track applications" },
  founder:    { label: "Founder",    icon: "★",  sub: "post-acceptance milestones" },
  reviewer:   { label: "Reviewer",   icon: "▣",  sub: "evaluate assigned apps" },
  mentor:     { label: "Mentor",     icon: "◇",  sub: "guide cohort founders" },
  leadership: { label: "Leadership", icon: "✦",  sub: "oversight & approvals" },
  admin:      { label: "Admin",      icon: "⚙",  sub: "manage users & program" },
};

const ALL_ROLES = Object.keys(ROLE_META);

function friendlyError(err, action) {
  const code = err?.details?.detail?.code ?? err?.details?.code ?? err?.code;
  if (code === "last_admin_protection") {
    return "Can't revoke — this is the last admin. Grant admin to another user first.";
  }
  if (code === "already_granted") {
    return "This user already has this role.";
  }
  return err?.message || `Couldn't ${action} role.`;
}

export default function UserRolesPanel({ userId, roles, onRolesChanged }) {
  // Set of role strings currently held by the user
  const grantedSet = new Set((roles ?? []).map((r) => r.role));

  // Per-role loading flags — Set of role strings currently in flight.
  // Using a Set allows concurrent grants/revokes on different roles without
  // a panel-wide guard that would silently no-op other buttons.
  const [inflightRoles, setInflightRoles] = useState(() => new Set());

  const setInflight = (role, on) => {
    setInflightRoles((prev) => {
      const next = new Set(prev);
      if (on) next.add(role); else next.delete(role);
      return next;
    });
  };

  // Toast: { msg, id } — id lets us clear the right one
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Confirmation modal for revoke
  const [revokeModal, setRevokeModal] = useState(null); // { role } | null

  // Inline error (shown below cards)
  const [panelError, setPanelError] = useState(null);

  function showToast(msg) {
    const id = Date.now();
    setToast({ msg, id });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((t) => (t?.id === id ? null : t));
      toastTimerRef.current = null;
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  async function handleGrant(role) {
    if (inflightRoles.has(role)) return;
    setInflight(role, true);
    setPanelError(null);
    try {
      await adminApi.grantRole(userId, role);
      await onRolesChanged();
      showToast(`${ROLE_META[role].label} role granted.`);
    } catch (err) {
      setPanelError(friendlyError(err, "grant"));
    } finally {
      setInflight(role, false);
    }
  }

  function openRevokeModal(role) {
    setRevokeModal({ role });
    setPanelError(null);
  }

  function closeRevokeModal() {
    setRevokeModal(null);
    setPanelError(null);
  }

  async function confirmRevoke() {
    if (!revokeModal) return;
    const { role } = revokeModal;
    setRevokeModal(null);
    setInflight(role, true);
    setPanelError(null);
    try {
      await adminApi.revokeRole(userId, role);
      await onRolesChanged();
      showToast(`${ROLE_META[role].label} role revoked.`);
    } catch (err) {
      setPanelError(friendlyError(err, "revoke"));
    } finally {
      setInflight(role, false);
    }
  }

  return (
    <section className="user-roles-panel">
      <div className="user-detail-panel-heading eir-mono">Roles</div>

      <div className="user-roles-grid">
        {ALL_ROLES.map((role) => {
          const meta = ROLE_META[role];
          const granted = grantedSet.has(role);
          const busy = inflightRoles.has(role);

          return (
            <div
              key={role}
              className={`user-role-card${granted ? " user-role-card-granted" : ""}`}
            >
              <div className="user-role-card-top">
                <span className="user-role-card-icon" aria-hidden="true">
                  {meta.icon}
                </span>
                <span className="user-role-card-label eir-mono">{meta.label}</span>
              </div>
              <span className="user-role-card-sub eir-dim">{meta.sub}</span>
              {granted ? (
                <button
                  type="button"
                  className="eir-chip-btn user-role-card-btn user-role-card-btn-revoke"
                  disabled={busy}
                  onClick={() => openRevokeModal(role)}
                  aria-label={`Revoke ${meta.label} role`}
                >
                  {busy ? "Revoking…" : "Revoke"}
                </button>
              ) : (
                <button
                  type="button"
                  className="eir-chip-btn user-role-card-btn user-role-card-btn-grant"
                  disabled={busy}
                  onClick={() => handleGrant(role)}
                  aria-label={`Grant ${meta.label} role`}
                >
                  {busy ? "Granting…" : "Grant"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {panelError && (
        <div className="user-roles-error" role="alert">
          {panelError}
        </div>
      )}

      {toast && (
        <div className="user-toast" role="status">
          {toast.msg}
        </div>
      )}

      {/* ── Revoke confirmation modal ── */}
      {revokeModal && (
        <div
          className="user-modal-back"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRevokeModal();
          }}
        >
          <div className="user-modal">
            <p id="revoke-modal-title" className="user-modal-title">
              Revoke{" "}
              <strong>{ROLE_META[revokeModal.role]?.label}</strong> role?
            </p>
            <p className="user-modal-body eir-dim">
              The user will lose access to features tied to this role immediately.
            </p>
            <div className="user-modal-actions">
              <button
                type="button"
                className="eir-chip-btn"
                onClick={closeRevokeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eir-chip-btn user-modal-confirm-btn"
                onClick={confirmRevoke}
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
