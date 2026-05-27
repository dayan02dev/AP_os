// SignUpPage — dedicated signup entry. New applicants land here from a
// "Sign up" link on the Sign-In page (and elsewhere) and walk through:
//
//   1. Enter email here → click "Send 6-digit code"
//   2. /apply/verify?signup=1   — type the OTP from their inbox
//   3. /apply/set-password      — VerifyPage forces this for password_set=false
//   4. /apply                   — wizard begins
//
// Functionally this is a thin wrapper around requestOtp; the existing
// VerifyPage + SetPasswordPage handle steps 2–3. Splitting the entry from
// SignInPage matters for clarity: applicants saw "Sign in to continue"
// with a hidden "leave password blank to sign up" affordance and didn't
// realize they could create an account.

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function SignUpPage() {
  const { requestOtp } = useAuth();
  const { push } = useToast();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const nextParam = params.get("next") || "";
  // Track is locked at first signup (writes profiles.track via Supabase
  // user_metadata). Default to "tir" so legacy /apply/signup links still
  // work; SIP entry points pass ?track=sip.
  const trackParamRaw = params.get("track");
  const trackParam =
    trackParamRaw === "sip" || trackParamRaw === "tir" ? trackParamRaw : "tir";
  usePageTheme(trackParam === "sip");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setLocalError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await requestOtp(trimmed, trackParam);
      const qs = new URLSearchParams();
      qs.set("email", trimmed);
      qs.set("signup", "1");
      if (nextParam) qs.set("next", nextParam);
      if (trackParam) qs.set("track", trackParam);
      navigate(`/apply/verify?${qs.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        push({
          kind: "error",
          message: "Too many requests. Try again in a few minutes.",
        });
        setLocalError("Too many requests. Try again in a few minutes.");
      } else {
        push({
          kind: "error",
          message: err?.message || "Couldn't send the code. Try again.",
        });
        setLocalError(err?.message || "Couldn't send the code.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Build the "already have an account?" link, preserving any ?next= param
  // so the redirect target survives the round-trip to sign-in.
  const signInHref = nextParam
    ? `/apply/signin?next=${encodeURIComponent(nextParam)}`
    : "/apply/signin";

  const trackLabel = trackParam === "sip" ? "VIP" : "TIR";
  const rootCls = trackParam === "sip" ? "eir-root track-sip" : "eir-root";

  return (
    <div className={rootCls}>
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen eir-auth">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / {trackLabel}.2026</span>
              <span>sign up · new applicant</span>
            </div>
            <form className="eir-auth-body" onSubmit={onSubmit}>
              <h1 className="eir-welcome-title">Create your account.</h1>
              <p className="eir-welcome-lede">
                Enter the email you'll use for this application. We'll send a
                6-digit code to confirm it, then you'll set a password — that's
                what you'll use to sign in next time.
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

              {localError && (
                <div className="eir-mono eir-block-reason">↳ {localError}</div>
              )}

              <div className="eir-q-actions">
                <button
                  type="submit"
                  className={`eir-btn ${loading ? "eir-btn-disabled" : "eir-btn-primary"}`}
                  disabled={loading || !email}
                >
                  <span>{loading ? "Sending..." : "Send 6-digit code"}</span>
                  <span className="eir-btn-key eir-mono">⏎</span>
                </button>
              </div>

              <div className="eir-auth-alt eir-mono" style={{ marginTop: 22 }}>
                Already have an account? <Link to={signInHref}>Sign in ↗</Link>
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
