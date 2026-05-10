// SetPasswordPage — protected route for first-time password setup AND for
// completing the forgot-password flow. Reached from VerifyPage:
//   - First signin without a password → /apply/set-password (initial)
//   - Forgot password OTP completed → /apply/set-password?reset=1
//
// The shape is identical in both modes; the copy and the success toast
// adapt to ?reset=1 so it reads naturally either way.

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { checkPasswordRules, isPasswordValid } from "../validators.jsx";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function SetPasswordPage() {
  const { user, setPassword } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resetMode = params.get("reset") === "1";
  const nextParam = params.get("next") || "";
  const isSipFlow = nextParam.startsWith("/apply-sip");

  usePageTheme(isSipFlow);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const rules = checkPasswordRules(pw1);
  const allRulesMet = isPasswordValid(pw1);
  const passwordsMatch = pw1 && pw1 === pw2;
  const canSubmit = allRulesMet && passwordsMatch && !submitting;

  const onSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!allRulesMet) {
      setLocalError("Password doesn't meet all the requirements yet.");
      return;
    }
    if (!passwordsMatch) {
      setLocalError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await setPassword(pw1);
      push({
        kind: "success",
        message: resetMode ? "Password reset." : "Password set.",
      });
      const safeNext =
        nextParam &&
        (nextParam.startsWith("/apply/") ||
          nextParam.startsWith("/apply-sip/") ||
          nextParam === "/apply" ||
          nextParam === "/apply-sip");
      navigate(safeNext ? nextParam : "/apply", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setLocalError(
          err.message ||
            "Password is too weak. Try a longer one with mixed characters.",
        );
      } else if (err instanceof ApiError && err.status === 429) {
        setLocalError(
          "Too many password changes recently. Try again in an hour.",
        );
      } else {
        setLocalError(err?.message || "Couldn't update password. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen eir-auth">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / {isSipFlow ? "SIP" : "TIR"}.2026</span>
              <span>{resetMode ? "reset password" : "set password"}</span>
            </div>
            <form className="eir-auth-body" onSubmit={onSubmit}>
              <h1 className="eir-welcome-title">
                {resetMode ? "Reset your password." : "Set your password."}
              </h1>
              <p className="eir-welcome-lede">
                {resetMode
                  ? "Choose a new password — you'll use this to sign in next time."
                  : "One last step. Choose a password — you'll use this to sign in from now on."}
                {user?.email && (
                  <>
                    {" "}
                    Account: <strong>{user.email}</strong>.
                  </>
                )}
              </p>

              <div className="eir-q-input-wrap" style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  className="eir-input"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="New password"
                  autoComplete="new-password"
                  autoFocus
                  required
                  style={{ paddingRight: 60 }}
                />
                <button
                  type="button"
                  className="eir-link-btn eir-mono"
                  onClick={() => setShowPw((s) => !s)}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                  }}
                  tabIndex={-1}
                >
                  {showPw ? "hide" : "show"}
                </button>
              </div>

              <div className="eir-q-input-wrap" style={{ marginTop: 14 }}>
                <input
                  type={showPw ? "text" : "password"}
                  className="eir-input"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  required
                />
              </div>

              <ul
                className="eir-mono eir-dim"
                style={{
                  marginTop: 16,
                  marginBottom: 14,
                  fontSize: 12,
                  listStyle: "none",
                  padding: 0,
                  display: "grid",
                  gap: 4,
                }}
              >
                {rules.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      color: r.passed
                        ? "var(--accent, #2a5a3a)"
                        : "var(--ink-dim, #999)",
                    }}
                  >
                    {r.passed ? "✓" : "○"} {r.label}
                  </li>
                ))}
                <li
                  style={{
                    color: passwordsMatch
                      ? "var(--accent, #2a5a3a)"
                      : "var(--ink-dim, #999)",
                  }}
                >
                  {passwordsMatch ? "✓" : "○"} Passwords match
                </li>
              </ul>

              {localError && (
                <div className="eir-mono eir-block-reason">↳ {localError}</div>
              )}

              <div className="eir-q-actions">
                <button
                  type="submit"
                  className={`eir-btn ${canSubmit ? "eir-btn-primary" : "eir-btn-disabled"}`}
                  disabled={!canSubmit}
                >
                  <span>
                    {submitting
                      ? "Saving..."
                      : resetMode
                        ? "Reset password"
                        : "Set password and continue"}
                  </span>
                  <span className="eir-btn-key eir-mono">⏎</span>
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
