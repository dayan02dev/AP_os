// ChangePasswordForm — the one password editor every staff portal uses
// (Reviewer, Jury, Admin, Leadership).
//
// Reviewers and jury members are onboarded with a system-generated temporary
// password that arrives by email, so they need a first-class way to replace it
// with one of their own. This posts to the SAME endpoint the applicant
// set-password screen uses (POST /auth/set-password via useAuth().setPassword),
// which writes the password into Supabase Auth and stamps
// `app_metadata.password_set = true` — that flag is what `password_set` on
// /auth/me reports, and what the first-login gate in router.jsx keys off. So
// changing your password here also clears the forced-change prompt.
//
// Self-contained inline styles: it renders inside the admin portal
// (.adm-portal), the reviewer/jury shells (.rv-portal) and plain modals, and
// must look the same in all of them.

import { useState } from "react";
import { useAuth } from "../hooks/useAuth.jsx";
import { checkPasswordRules, isPasswordValid } from "../validators.jsx";

export default function ChangePasswordForm({ onDone, compact = false }) {
  const { user, setPassword } = useAuth();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const rules = checkPasswordRules(pw1);
  const allRulesMet = isPasswordValid(pw1);
  const matches = Boolean(pw1) && pw1 === pw2;
  const canSubmit = allRulesMet && matches && !busy;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!allRulesMet) { setError("Password doesn't meet all the requirements yet."); return; }
    if (!matches) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      await setPassword(pw1);
      setPw1(""); setPw2(""); setDone(true);
      onDone && onDone();
    } catch (err) {
      if (err?.status === 422) {
        setError(err?.message || "Password is too weak. Try a longer one with mixed characters.");
      } else if (err?.status === 429) {
        setError("Too many password changes recently. Try again in an hour.");
      } else {
        setError(err?.message || "Couldn't update password. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const label = { display: "block", marginBottom: 4, fontWeight: 600 };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!compact && (
        <div className="os-text-sm os-text-soft">
          Choose a password you'll use to sign in from now on
          {user?.email ? <> — account <strong>{user.email}</strong></> : null}.
        </div>
      )}

      <div>
        <label className="os-text-xs os-text-dim os-uppercase" htmlFor="cp-new" style={label}>New password</label>
        <div style={{ position: "relative" }}>
          <input
            id="cp-new"
            className="os-input os-w-100"
            aria-label="New password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={pw1}
            onChange={(e) => { setPw1(e.target.value); setDone(false); }}
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            tabIndex={-1}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--ink-dim)" }}
          >
            {show ? "hide" : "show"}
          </button>
        </div>
      </div>

      <div>
        <label className="os-text-xs os-text-dim os-uppercase" htmlFor="cp-confirm" style={label}>Confirm new password</label>
        <input
          id="cp-confirm"
          className="os-input os-w-100"
          aria-label="Confirm new password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => { setPw2(e.target.value); setDone(false); }}
        />
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 3, fontSize: 12 }}>
        {rules.map((r) => (
          <li key={r.id} style={{ color: r.passed ? "#1d6b45" : "var(--ink-dim)" }}>
            {r.passed ? "✓" : "○"} {r.label}
          </li>
        ))}
        <li style={{ color: matches ? "#1d6b45" : "var(--ink-dim)" }}>
          {matches ? "✓" : "○"} Passwords match
        </li>
      </ul>

      {error && (
        <div role="alert" style={{ color: "var(--bad, #b3262b)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft, #fdecec)", borderRadius: 4 }}>
          {error}
        </div>
      )}
      {done && !error && (
        <div style={{ color: "#1d6b45", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "#e9f6ef", border: "1px solid #b7ddc8", borderRadius: 4 }}>
          Password updated. Use it the next time you sign in.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          className="os-btn"
          style={{
            background: canSubmit ? "#3213b7" : "var(--bg-soft)",
            borderColor: canSubmit ? "#3213b7" : "var(--line)",
            color: canSubmit ? "#fff" : "var(--ink-dim)",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
          disabled={!canSubmit}
        >
          {busy ? "Saving…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
