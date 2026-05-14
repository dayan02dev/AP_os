// AdminAddUser — /admin/users/new
//
// Visual contract: ARTPARK design system §6.3 — single-column 560px form.
// Eyebrow + h1 "Add a user." + sub. Segmented role .choice. Send invite primary.
// Toast on success (info variant); navigate back to /admin/users.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";
import { useToast } from "../../hooks/useToast.jsx";

const ROLE_OPTIONS = [
  { id: "reviewer",   label: "Reviewer",   key: "R", blurb: "Scores assigned applications." },
  { id: "leadership", label: "Leadership", key: "L", blurb: "Sees every app, assigns reviewers, decides Gate 1." },
  { id: "mentor",     label: "Mentor",     key: "M", blurb: "Guides accepted founders. Phase 2." },
  { id: "admin",      label: "Admin",      key: "A", blurb: "Manages users + system settings." },
];

export default function AdminAddUser() {
  const navigate = useNavigate();
  const { push } = useToast();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("reviewer");
  const [sendInvite, setSendInvite] = useState(true);
  const [welcomeNote, setWelcomeNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [tempResult, setTempResult] = useState(null);

  const canSubmit =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    fullName.trim().length >= 2 &&
    !submitting;

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await adminApi.createUser({
        email: email.trim(),
        full_name: fullName.trim(),
        roles: [role],
        send_invite: sendInvite,
      });

      if (sendInvite) {
        push({ kind: "info", message: `Invite sent to ${result.email}.` });
        navigate("/admin/users");
      } else {
        // Stay on the page to show the temp password — admin needs to copy it.
        setTempResult(result);
      }
    } catch (err) {
      const code = err?.details?.detail?.code || err?.details?.code;
      const invalid = err?.details?.detail?.invalid || err?.details?.invalid;
      if (code === "email_exists") {
        setError("That email is already registered.");
      } else if (code === "invalid_role") {
        setError(`Invalid role(s): ${(invalid || []).join(", ")}`);
      } else if (code === "missing_capability") {
        setError("You don't have permission to create users.");
      } else {
        setError(err?.message || "Couldn't create user.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (tempResult) {
    return (
      <div className="form-page-narrow form-stack">
        <button
          type="button"
          className="back-link"
          onClick={() => navigate("/admin/users")}
        >
          ← Back to users
        </button>
        <div>
          <span className="eyebrow eyebrow-rule">User created</span>
          <h1 style={{ marginTop: "var(--s-3)" }}>{tempResult.email}.</h1>
          <p className="page-sub">
            Account created with the <strong>{role}</strong> role.
            Share the temporary password below — the user should change it on first sign-in.
          </p>
        </div>
        <div className="card card-soft">
          <span className="eyebrow">Temporary password</span>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "var(--t-body-lg)",
              fontWeight: 600,
              padding: "var(--s-4) var(--s-5)",
              background: "var(--paper)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sharp)",
              marginTop: "var(--s-3)",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {tempResult.temp_password}
          </div>
          <p style={{ marginTop: "var(--s-3)", color: "var(--ink-soft)", fontSize: 13 }}>
            This password will not be shown again. Copy it now.
          </p>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTempResult(null);
              setEmail("");
              setFullName("");
              setRole("reviewer");
              setSendInvite(true);
              setWelcomeNote("");
            }}
          >
            Add another
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/admin/users")}
          >
            Back to users <span className="arrow">→</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page-narrow">
      <button
        type="button"
        className="back-link"
        onClick={() => navigate("/admin/users")}
      >
        ← Back to users
      </button>

      <header className="page-head" style={{ display: "block" }}>
        <span className="eyebrow eyebrow-rule">Invite user</span>
        <h1>Add a user.</h1>
        <p className="page-sub">
          Invite a reviewer, leadership, or mentor to ARTPARK Programs.
          They'll receive a magic-link email and can set their own password on first sign-in.
        </p>
      </header>

      <form onSubmit={onSubmit} className="form-stack" noValidate>
        <div className="form-row">
          <label className="field-label" htmlFor="add-user-name">Full name</label>
          <input
            id="add-user-name"
            className="field"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Priya Sharma"
            autoComplete="off"
            required
          />
        </div>

        <div className="form-row">
          <label className="field-label" htmlFor="add-user-email">Email</label>
          <input
            id="add-user-email"
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@artpark.in"
            autoComplete="off"
            required
          />
          <span className="field-help">
            We'll send the invite or temporary password to this address.
          </span>
        </div>

        <div className="form-row">
          <span className="field-label">Role</span>
          <div className="choice-group" role="radiogroup" aria-label="Role">
            {ROLE_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`choice${role === opt.id ? " selected" : ""}`}
                title={opt.blurb}
              >
                <input
                  type="radio"
                  name="role"
                  value={opt.id}
                  checked={role === opt.id}
                  onChange={() => setRole(opt.id)}
                />
                <span className="key">{opt.key}</span>
                <span className="lbl">{opt.label}</span>
              </label>
            ))}
          </div>
          <span className="field-help">
            {ROLE_OPTIONS.find((o) => o.id === role)?.blurb}
          </span>
        </div>

        <div className="form-row">
          <label className="field-label" htmlFor="add-user-note">
            Welcome note <span style={{ textTransform: "none", color: "var(--ink-dim)", fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="add-user-note"
            className="field"
            rows={3}
            value={welcomeNote}
            onChange={(e) => setWelcomeNote(e.target.value)}
            placeholder="A short message included with the invite. Leave blank to use the default."
          />
        </div>

        <div className="form-row row-inline">
          <input
            id="add-user-invite"
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
          />
          <label htmlFor="add-user-invite" style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            Send magic-link invite. Uncheck to get a one-time password to share manually.
          </label>
        </div>

        {error && <div className="inline-error" role="alert">{error}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate("/admin/users")}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {submitting ? "Sending…" : (
              <>Send invite <span className="arrow">→</span></>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
