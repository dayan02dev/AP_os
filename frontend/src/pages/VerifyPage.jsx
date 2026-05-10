// VerifyPage — 6-digit OTP entry. Client-side resend cooldown of 30s.
//
// On success, the next page depends on three flags:
//   - ?reset=1            → forgot-password flow → /apply/set-password?reset=1
//   - user has no password (password_set=false) → /apply/set-password (initial)
//   - otherwise          → ?next= (if safe) or /apply

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import * as authApi from "../lib/auth.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

const RESEND_SECONDS = 30;

export default function VerifyPage() {
  const { verifyOtp, requestOtp } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const email = (params.get("email") || "").trim().toLowerCase();
  const nextParam = params.get("next") || "";
  const resetMode = params.get("reset") === "1";
  const signupMode = params.get("signup") === "1";
  const trackParamRaw = params.get("track");
  const trackParam =
    trackParamRaw === "sip" || trackParamRaw === "tir" ? trackParamRaw : null;
  // Dev shortcut: `?code=NNNNNN` pre-fills the OTP. Used by the
  // backend/scripts/dev_get_otp.py one-click URL so you can jump straight
  // into the wizard without typing the code manually.
  const prefillCode = (params.get("code") || "").replace(/\D/g, "").slice(0, 6);

  usePageTheme(trackParam === "sip" || nextParam.startsWith("/apply-sip"));
  const [code, setCode] = useState(prefillCode);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(RESEND_SECONDS);
  const [error, setError] = useState(null);

  // Countdown timer for resend.
  useEffect(() => {
    if (resendCountdown <= 0) return undefined;
    const t = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  // Missing email → send them back to /apply/signin.
  useEffect(() => {
    if (!email) navigate("/apply/signin", { replace: true });
  }, [email, navigate]);

  const onSubmit = useCallback(
    async (e) => {
      e?.preventDefault?.();
      setError(null);
      if (!/^\d{6}$/.test(code)) {
        setError("Enter the 6-digit numeric code from your email.");
        return;
      }
      setVerifying(true);
      try {
        await verifyOtp(email, code);
        // Decide where to go next:
        //   resetMode → forgot-password → force set-password with reset hint
        //   otherwise → check whether the user already has a password; if
        //     not, force them through SetPasswordPage so first-time users
        //     end up password-protected. /auth/me carries the flag.
        let target;
        if (resetMode) {
          target = "/apply/set-password?reset=1";
        } else {
          let hasPassword = true;
          try {
            const me = await authApi.getMe();
            hasPassword = !!me?.password_set;
          } catch {
            // If /me fails we fall through to the regular target — the
            // SetPasswordPage isn't a hard requirement on every signin.
          }
          // Default landing: SIP signups land in /apply-sip; everyone
          // else falls back to /apply (TIR). The track guard on the
          // backend still gates the data fetch — this is just a UX hint.
          const defaultHome = trackParam === "sip" ? "/apply-sip" : "/apply";
          if (!hasPassword) {
            target =
              trackParam === "sip"
                ? "/apply/set-password?next=%2Fapply-sip"
                : "/apply/set-password";
          } else {
            const safeNext =
              nextParam &&
              (nextParam.startsWith("/apply/") ||
                nextParam.startsWith("/apply-sip/") ||
                nextParam === "/apply" ||
                nextParam === "/apply-sip");
            target = safeNext ? nextParam : defaultHome;
          }
        }
        navigate(target, { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError("That code is invalid or expired. Request a new one below.");
        } else if (err instanceof ApiError && err.status === 429) {
          setError("Too many attempts. Wait a moment before trying again.");
        } else {
          setError(err?.message || "Verification failed. Please try again.");
        }
      } finally {
        setVerifying(false);
      }
    },
    [code, email, navigate, nextParam, resetMode, verifyOtp],
  );

  const onResend = useCallback(async () => {
    if (resendCountdown > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      await requestOtp(email);
      push({ kind: "info", message: "New code sent." });
      setResendCountdown(RESEND_SECONDS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Resent too often. Try again in a few minutes.");
      } else {
        setError(err?.message || "Couldn't resend code.");
      }
    } finally {
      setResending(false);
    }
  }, [email, push, requestOtp, resendCountdown, resending]);

  // Auto-submit when user types the 6th digit.
  useEffect(() => {
    if (code.length === 6 && /^\d{6}$/.test(code) && !verifying) {
      onSubmit();
    }
    // We intentionally don't include onSubmit in deps (would re-fire on error).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen eir-auth">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / {trackParam === "sip" ? "SIP" : "TIR"}.2026</span>
              <span>
                {signupMode
                  ? "sign up · verify email"
                  : resetMode
                    ? "reset password · verify email"
                    : "verify · 6-digit code"}
              </span>
            </div>
            <form className="eir-auth-body" onSubmit={onSubmit}>
              <h1 className="eir-welcome-title">Check your email.</h1>
              <p className="eir-welcome-lede">
                We just sent a 6-digit code to <strong>{email || "your address"}</strong>.
                Enter it below — the code expires in 10 minutes.
                {signupMode && (
                  <>
                    {" "}
                    Once verified, you'll choose a password — that's what
                    you'll use to sign in next time.
                  </>
                )}
              </p>

              <div className="eir-q-input-wrap">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="eir-input eir-otp-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                />
              </div>

              {error && (
                <div className="eir-mono eir-block-reason">↳ {error}</div>
              )}

              <div className="eir-q-actions">
                <button
                  type="submit"
                  className={`eir-btn ${code.length === 6 && !verifying ? "eir-btn-primary" : "eir-btn-disabled"}`}
                  disabled={code.length !== 6 || verifying}
                >
                  <span>{verifying ? "Verifying..." : "Verify + continue"}</span>
                  <span className="eir-btn-key eir-mono">⏎</span>
                </button>
                <button
                  type="button"
                  className="eir-link-btn eir-mono"
                  onClick={onResend}
                  disabled={resendCountdown > 0 || resending}
                >
                  {resendCountdown > 0
                    ? `resend in ${resendCountdown}s`
                    : resending
                      ? "resending..."
                      : "resend code"}
                </button>
              </div>

              <div className="eir-welcome-foot eir-mono eir-dim">
                wrong email? <Link to="/apply/signin">start over</Link>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
