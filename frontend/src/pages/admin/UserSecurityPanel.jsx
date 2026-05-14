// UserSecurityPanel — right-column .card-soft on /admin/users/:id.
//
// Visual contract: ARTPARK design system §6.4 — single .card-soft with two
// action rows (reset password, deactivate). Both open §5.5 confirmation
// modals before mutating. Destructive variant for the deactivate confirm.

import { useEffect, useRef, useState } from "react";
import { adminApi } from "../../lib/adminApi.js";
import { api } from "../../lib/api.js";

export default function UserSecurityPanel({ userId, email, onDeactivated }) {
  const [modal, setModal] = useState(null); // "reset" | "deactivate" | null
  const [resetBusy, setResetBusy] = useState(false);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [deactivateError, setDeactivateError] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

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

  async function confirmReset() {
    setModal(null);
    setResetBusy(true);
    setResetError(null);
    try {
      await adminApi.resetPassword(userId);
      showToast(`Reset email sent to ${email}.`);
    } catch (err) {
      setResetError(err?.message || "Couldn't send reset email.");
    } finally {
      setResetBusy(false);
    }
  }

  async function confirmDeactivate() {
    setDeactivateBusy(true);
    setDeactivateError(null);
    try {
      await api.post(`/admin/users/${userId}/deactivate`, null);
      setModal(null);
      onDeactivated?.();
    } catch (err) {
      setDeactivateError(err?.message || "Couldn't deactivate user.");
    } finally {
      setDeactivateBusy(false);
    }
  }

  return (
    <section className="card card-soft">
      <div className="section-head" style={{ marginBottom: "var(--s-3)" }}>
        <span className="eyebrow">Security</span>
        <h2 style={{ marginTop: "var(--s-2)" }}>Account actions.</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-5)" }}>
        <div>
          <strong style={{ fontSize: 14 }}>Reset password</strong>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: "var(--s-2) 0 var(--s-3)" }}>
            Sends a Supabase reset link to <strong>{email}</strong>. The current
            password remains valid until they use the link.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={resetBusy}
            onClick={() => { setResetError(null); setModal("reset"); }}
          >
            {resetBusy ? "Sending…" : "Send reset email"}
          </button>
          {resetError && <div className="inline-error" role="alert" style={{ marginTop: "var(--s-3)" }}>{resetError}</div>}
        </div>

        <div style={{ height: 1, background: "var(--line)" }} />

        <div>
          <strong style={{ fontSize: 14 }}>Deactivate account</strong>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: "var(--s-2) 0 var(--s-3)" }}>
            Blocks sign-in immediately. Reversible by an admin in Supabase.
            Existing sessions are invalidated.
          </p>
          <button
            type="button"
            className="btn btn-destructive btn-sm"
            disabled={deactivateBusy}
            onClick={() => { setDeactivateError(null); setModal("deactivate"); }}
          >
            {deactivateBusy ? "Deactivating…" : "Deactivate user"}
          </button>
          {deactivateError && <div className="inline-error" role="alert" style={{ marginTop: "var(--s-3)" }}>{deactivateError}</div>}
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.kind === "error" ? "error" : "info"}`} role="status">
          {toast.msg}
        </div>
      )}

      {modal === "reset" && (
        <div
          className="modal-scrim"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
            <span className="modal-eyebrow">Reset password</span>
            <h2 id="reset-title">Send a reset email?</h2>
            <div className="modal-body">
              <p>A Supabase reset link will be sent to <strong>{email}</strong>.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmReset}>
                Send reset email <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "deactivate" && (
        <div
          className="modal-scrim"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
            <span className="modal-eyebrow">Deactivate</span>
            <h2 id="deactivate-title">Deactivate {email}?</h2>
            <div className="modal-body">
              <p>
                They'll no longer be able to sign in. Their existing sessions are
                invalidated. This can be reversed by an admin in Supabase.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className="btn btn-destructive" onClick={confirmDeactivate}>
                Deactivate <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
