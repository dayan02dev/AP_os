// UserSecurityPanel — password reset + deactivate actions.
//
// Props:
//   userId       string  — target user's id
//   email        string  — displayed in confirmation copy and toast text
//   onDeactivated fn     — called after successful deactivation so the parent
//                          can navigate away

import { useEffect, useRef, useState } from "react";
import { adminApi } from "../../lib/adminApi.js";
import { api } from "../../lib/api.js";

export default function UserSecurityPanel({ userId, email, onDeactivated }) {
  // Which modal is open: "reset" | "deactivate" | null
  const [modal, setModal] = useState(null);

  // Per-action busy flags
  const [resetBusy, setResetBusy] = useState(false);
  const [deactivateBusy, setDeactivateBusy] = useState(false);

  // Inline errors per section
  const [resetError, setResetError] = useState(null);
  const [deactivateError, setDeactivateError] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

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

  function closeModal() {
    setModal(null);
  }

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
      // No adminApi helper for this endpoint — use raw api.post per briefing.
      await api.post(`/admin/users/${userId}/deactivate`, null);
      setModal(null);
      onDeactivated();           // parent navigates away; if it throws we still cleanup
    } catch (err) {
      setDeactivateError(err?.message || "Couldn't deactivate user.");
    } finally {
      setDeactivateBusy(false);
    }
  }

  return (
    <section className="user-security-panel">
      <div className="user-detail-panel-heading eir-mono">Security</div>

      {/* ── Reset password ── */}
      <div className="user-security-action">
        <div className="user-security-action-info">
          <span className="user-security-action-label eir-mono">Password reset</span>
          <span className="user-security-action-sub eir-dim">
            Sends a reset link from Supabase to {email}.
          </span>
        </div>
        <button
          type="button"
          className="eir-chip-btn user-security-btn"
          disabled={resetBusy}
          onClick={() => {
            setResetError(null);
            setModal("reset");
          }}
        >
          {resetBusy ? "Sending…" : `Send reset email to ${email}`}
        </button>
        {resetError && (
          <div className="user-security-error" role="alert">
            {resetError}
          </div>
        )}
      </div>

      <div className="user-security-divider" />

      {/* ── Deactivate ── */}
      <div className="user-security-action">
        <div className="user-security-action-info">
          <span className="user-security-action-label eir-mono">Deactivate account</span>
          <span className="user-security-action-sub eir-dim">
            Blocks sign-in. Reversible manually in Supabase.
          </span>
        </div>
        <button
          type="button"
          className="eir-chip-btn user-security-btn user-security-btn-danger"
          disabled={deactivateBusy}
          onClick={() => {
            setDeactivateError(null);
            setModal("deactivate");
          }}
        >
          {deactivateBusy ? "Deactivating…" : "Deactivate user"}
        </button>
        {deactivateError && (
          <div className="user-security-error" role="alert">
            {deactivateError}
          </div>
        )}
      </div>

      {toast && (
        <div className="user-toast" role="status">
          {toast.msg}
        </div>
      )}

      {/* ── Reset-password confirmation modal ── */}
      {modal === "reset" && (
        <div
          className="user-modal-back"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="user-modal">
            <p id="reset-modal-title" className="user-modal-title">
              Send password reset email?
            </p>
            <p className="user-modal-body eir-dim">
              A reset link from Supabase will be sent to{" "}
              <strong>{email}</strong>.
            </p>
            <div className="user-modal-actions">
              <button
                type="button"
                className="eir-chip-btn"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eir-chip-btn user-modal-confirm-btn"
                onClick={confirmReset}
              >
                Send reset email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deactivate confirmation modal ── */}
      {modal === "deactivate" && (
        <div
          className="user-modal-back"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="user-modal">
            <p id="deactivate-modal-title" className="user-modal-title">
              Deactivate <strong>{email}</strong>?
            </p>
            <p className="user-modal-body eir-dim">
              They'll no longer be able to sign in. This can be reversed
              manually in Supabase.
            </p>
            <div className="user-modal-actions">
              <button
                type="button"
                className="eir-chip-btn"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="eir-chip-btn user-modal-confirm-btn user-modal-confirm-btn-danger"
                onClick={confirmDeactivate}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
