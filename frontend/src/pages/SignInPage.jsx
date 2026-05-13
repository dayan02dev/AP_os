// SignInPage — for existing applicants returning with a password.
//
// Flow:
//   - User types email + password → "Sign in" → /auth/sign-in-password
//   - "Email me a 6-digit code instead" → OTP fallback (covers users who
//     started with OTP and never set a password yet)
//   - "Forgot password?" link → same OTP flow, with ?reset=1 hint so
//     VerifyPage routes to /apply/set-password afterward
//   - "Sign up" link → /apply/signup for new applicants

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { shouldRouteToAdminShell } from "../lib/rbac.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";

export default function SignInPage() {
  const { requestOtp, signInWithPassword } = useAuth();
  const { push } = useToast();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const nextParam = params.get("next") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  const trimmedEmail = email.trim().toLowerCase();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  // Password sign-in path — used when the user fills the password field.
  const onPasswordSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!isEmailValid) {
      setLocalError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setLocalError("Enter your password, or click 'Email me a code' below.");
      return;
    }
    setLoading(true);
    try {
      const me = await signInWithPassword(trimmedEmail, password);
      // Honour ?next= when it points at a known protected surface.
      // Otherwise branch by role: admin/leadership land on the admin
      // shell; everyone else (applicant-only) falls through to /apply.
      // Task 8 will route reviewers separately to /reviewer/inbox.
      const allowedNext =
        nextParam &&
        (nextParam.startsWith("/apply/") || nextParam.startsWith("/admin/"));
      if (allowedNext) {
        navigate(nextParam, { replace: true });
      } else if (shouldRouteToAdminShell(me?.roles)) {
        navigate("/admin/dashboard", { replace: true });
      } else {
        navigate("/apply", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocalError(
          "Invalid email or password. New here? Use the 6-digit code option.",
        );
      } else if (err instanceof ApiError && err.status === 429) {
        setLocalError("Too many sign-in attempts. Try again in a few minutes.");
      } else {
        setLocalError(err?.message || "Couldn't sign in. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // OTP fallback — used by both "Email me a 6-digit code" and "Forgot password".
  // The `?reset=1` flag makes VerifyPage continue to /apply/set-password instead
  // of /apply, so the user is forced through the set-password screen.
  const onSendCode = async (resetMode = false) => {
    setLocalError(null);
    if (!isEmailValid) {
      setLocalError("Enter a valid email address first.");
      return;
    }
    setOtpLoading(true);
    try {
      await requestOtp(trimmedEmail);
      const qs = new URLSearchParams();
      qs.set("email", trimmedEmail);
      if (nextParam) qs.set("next", nextParam);
      if (resetMode) qs.set("reset", "1");
      navigate(`/apply/verify?${qs.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        push({
          kind: "error",
          message: "Too many requests. Try again in a few minutes.",
        });
      } else {
        push({
          kind: "error",
          message: err?.message || "Couldn't send the code. Try again.",
        });
      }
      setLocalError(err?.message || "Couldn't send the code.");
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen eir-auth">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / TIR.2026</span>
              <span>sign in · email + password</span>
            </div>
            <form className="eir-auth-body" onSubmit={onPasswordSubmit}>
              <h1 className="eir-welcome-title">Sign in to continue.</h1>
              <p className="eir-welcome-lede">
                Enter your email and password to pick up where you left off.
              </p>

              <div className="eir-q-input-wrap">
                <input
                  type="email"
                  className="eir-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              <div className="eir-q-input-wrap" style={{ marginTop: 14, position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="eir-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  style={{ paddingRight: 60 }}
                />
                <button
                  type="button"
                  className="eir-link-btn eir-mono"
                  onClick={() => setShowPassword((s) => !s)}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? "hide" : "show"}
                </button>
              </div>

              {localError && (
                <div className="eir-mono eir-block-reason">↳ {localError}</div>
              )}

              <div className="eir-q-actions">
                <button
                  type="submit"
                  className={`eir-btn ${loading ? "eir-btn-disabled" : "eir-btn-primary"}`}
                  disabled={loading || !email || !password}
                >
                  <span>{loading ? "Signing in..." : "Sign in"}</span>
                  <span className="eir-btn-key eir-mono">⏎</span>
                </button>
              </div>

              <div className="eir-auth-alt eir-mono" style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="eir-link-btn eir-mono"
                  onClick={() => onSendCode(false)}
                  disabled={otpLoading || !email}
                >
                  {otpLoading ? "sending..." : "email me a 6-digit code instead ↗"}
                </button>
                <button
                  type="button"
                  className="eir-link-btn eir-mono eir-dim"
                  onClick={() => onSendCode(true)}
                  disabled={otpLoading || !email}
                >
                  forgot password? ↗
                </button>
              </div>

              <div
                className="eir-auth-alt eir-mono"
                style={{
                  marginTop: 22,
                  paddingTop: 18,
                  borderTop: "1px dashed var(--line)",
                }}
              >
                New to ARTPARK?{" "}
                <Link
                  to={
                    nextParam
                      ? `/apply/signup?next=${encodeURIComponent(nextParam)}`
                      : "/apply/signup"
                  }
                >
                  Create an account ↗
                </Link>
              </div>

              <div className="eir-welcome-foot eir-mono eir-dim" style={{ marginTop: 24 }}>
                by continuing you agree to our terms and data policy
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
