// AccountSettingsButton — the gear in the Reviewer and Jury topbars.
//
// Those two portals had no settings surface at all, so a reviewer or juror
// who signed in with the temporary password we emailed them had nowhere to
// change it. This is that surface; the Admin portal already has a Settings
// modal and hosts the same <ChangePasswordForm /> inside it.
//
// Inline-styled to match PortalSwitcher (its neighbour in both topbars).

import { useState } from "react";
import ChangePasswordForm from "./ChangePasswordForm.jsx";
import { useAuth } from "../hooks/useAuth.jsx";

export default function AccountSettingsButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Settings"
        style={{
          width: 38, height: 38, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          border: "1px solid var(--line-strong, #c8c8d0)", borderRadius: 2,
          background: "var(--bg-paper, #fff)", color: "var(--ink-soft, #4a4a52)",
          cursor: "pointer",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", backdropFilter: "blur(4px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, width: "92vw", background: "var(--bg-paper, #fff)", border: "1px solid var(--line-strong, #c8c8d0)", borderRadius: 4, boxShadow: "0 20px 60px rgba(36,36,36,0.18)" }}
          >
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line, #e3e3e8)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink, #242424)" }}>Settings</div>
                <div className="os-text-xs os-text-dim" style={{ marginTop: 2 }}>
                  {user?.email || "Your account"}
                </div>
              </div>
              <button
                className="os-btn sm ghost"
                onClick={() => setOpen(false)}
                style={{ padding: "2px 8px", fontSize: 18 }}
                aria-label="Close settings"
              >
                &times;
              </button>
            </div>
            <div style={{ padding: 24 }}>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 12 }}>
                Change password
              </div>
              <ChangePasswordForm />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
