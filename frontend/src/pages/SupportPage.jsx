// SupportPage — full-page support form. Works authed or anon.
// When authed, the email field prefills from useAuth and is read-only.

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useSupport } from "../hooks/useSupport.js";
import { useToast } from "../hooks/useToast.jsx";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

const CATEGORIES = [
  { k: "technical", label: "Technical issue" },
  { k: "application", label: "Application question" },
  { k: "general", label: "Account / login" },
  { k: "other", label: "Something else" },
];

export default function SupportPage() {
  const { user, isAuthed } = useAuth();
  const location = useLocation();
  const isSip = location.pathname.includes("sip");
  usePageTheme(isSip);
  const { submit, submitting, lastTicket } = useSupport();
  const { push } = useToast();

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("technical");
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (isAuthed && user?.email) setEmail(user.email);
  }, [isAuthed, user]);

  const canSubmit =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    subject.trim().length >= 5 &&
    body.trim().length >= 20 &&
    !submitting;

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!canSubmit) {
      setFormError("Please complete all fields — subject at least 5 chars, message at least 20.");
      return;
    }
    try {
      await submit({ email, subject, body, category });
      push({ kind: "info", message: "Ticket filed. We'll be in touch." });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setFormError("Too many tickets filed recently. Try again in a bit.");
      } else {
        setFormError(err?.message || "Couldn't file ticket. Try again.");
      }
    }
  };

  if (lastTicket?.ticket_id) {
    return (
      <div className="eir-root">
        <div className="eir-bg" />
        <div className="eir-frame">
          <main className="eir-main">
            <div className="eir-screen eir-sup-page">
              <div className="eir-coord eir-mono">
                <span>ARTPARK / TIR.2026</span>
                <span>support · filed</span>
              </div>
              <div className="eir-done-body">
                <div className="eir-sup-check">
                  <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                    <circle cx="28" cy="28" r="26" stroke="var(--accent)" strokeWidth="1.5" />
                    <path
                      d="M16 28 L24 36 L40 20"
                      stroke="var(--accent)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
                <h2 className="eir-done-title">Ticket filed.</h2>
                <p className="eir-done-lede">
                  Your ticket <strong>#{String(lastTicket.ticket_id).slice(0, 8)}</strong> is
                  with our team. We'll respond to <strong>{email}</strong> within 2 business days.
                </p>
                <div className="eir-q-actions">
                  <Link to="/apply" className="eir-btn eir-btn-primary">
                    <span>Back to application</span>
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen eir-sup-page">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / TIR.2026</span>
              <span>support · report a problem</span>
            </div>
            <form className="eir-sup-body" onSubmit={onSubmit}>
              <h1 className="eir-welcome-title">Report a problem.</h1>
              <p className="eir-welcome-lede">
                Stuck on something, seeing a bug, or need a deadline extension?
                Send us a note — we reply within 2 business days.
              </p>

              <div className="eir-sup-field">
                <label className="eir-mono eir-link-label">category</label>
                <div className="eir-sup-catlist">
                  {CATEGORIES.map((c) => (
                    <button
                      type="button"
                      key={c.k}
                      className={`eir-sup-cat ${category === c.k ? "is-on" : ""}`}
                      onClick={() => setCategory(c.k)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="eir-sup-field">
                <label className="eir-mono eir-link-label">subject</label>
                <input
                  type="text"
                  className="eir-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. CV upload keeps failing"
                  required
                />
              </div>

              <div className="eir-sup-field">
                <label className="eir-mono eir-link-label">describe the issue</label>
                <textarea
                  className="eir-textarea"
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={5000}
                  placeholder="What were you trying to do? What happened instead? Include any error messages."
                />
                <div className="eir-sup-hint eir-mono eir-dim">
                  {body.length} / 5000 chars
                </div>
              </div>

              <div className="eir-sup-field">
                <label className="eir-mono eir-link-label">your email for our reply</label>
                <input
                  type="email"
                  className="eir-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  readOnly={isAuthed}
                  required
                />
              </div>

              {formError && (
                <div className="eir-mono eir-block-reason">↳ {formError}</div>
              )}

              <div className="eir-sup-actions">
                <button
                  type="submit"
                  className={`eir-btn ${canSubmit ? "eir-btn-primary" : "eir-btn-disabled"}`}
                  disabled={!canSubmit}
                >
                  <span>{submitting ? "Sending..." : "Send ticket"}</span>
                </button>
                <Link to="/apply" className="eir-link-btn eir-mono">
                  cancel
                </Link>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
