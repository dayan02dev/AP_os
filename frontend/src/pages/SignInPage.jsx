// SignInPage — email input → requestOtp → navigates to /apply/verify.
// Phase 7 replacement for the Phase 0 stub.

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";

export default function SignInPage() {
  const { requestOtp } = useAuth();
  const { push } = useToast();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const nextParam = params.get("next") || "";
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
      await requestOtp(trimmed);
      const verifyUrl = `/apply/verify?email=${encodeURIComponent(trimmed)}${
        nextParam ? `&next=${encodeURIComponent(nextParam)}` : ""
      }`;
      navigate(verifyUrl);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        push({ kind: "error", message: "Too many requests. Try again in a few minutes." });
      } else {
        push({ kind: "error", message: err?.message || "Couldn't send OTP. Try again." });
      }
      setLocalError(err?.message || "Couldn't send OTP.");
    } finally {
      setLoading(false);
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
              <span>sign in · email OTP</span>
            </div>
            <form className="eir-auth-body" onSubmit={onSubmit}>
              <h1 className="eir-welcome-title">Sign in to continue.</h1>
              <p className="eir-welcome-lede">
                Enter the email you'll use for this application. We'll send you a
                6-digit code — no password needed.
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

              <div className="eir-welcome-foot eir-mono eir-dim">
                by continuing you agree to our terms and data policy
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
