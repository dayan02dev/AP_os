// SupportPage — /apply/support
//
// Visual contract: ARTPARK design system §6.9. Centered max-width 560px form.
// Eyebrow SUPPORT · h1 "How can we help?" · sub. Subject uses the wizard's
// underlined .apply-input (applicant voice). Category as segmented .choice.
// Description is a boxy .field textarea (denser). Submit: primary CTA.
// Works authed (email prefilled, read-only) or anon.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useSupport } from "../hooks/useSupport.js";
import { useToast } from "../hooks/useToast.jsx";
import "../styles/admin.css";

const CATEGORIES = [
  { id: "technical",   label: "Technical issue",      key: "T" },
  { id: "application", label: "Application question", key: "A" },
  { id: "general",     label: "Account or sign-in",   key: "G" },
  { id: "other",       label: "Something else",       key: "O" },
];

export default function SupportPage() {
  const { user, isAuthed } = useAuth();
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

  async function onSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (!canSubmit) {
      setFormError(
        "Subject needs at least 5 characters, description at least 20, and a valid email.",
      );
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
  }

  if (lastTicket?.ticket_id) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="logos">
            <img src="/assets/iisc-logo.png" alt="IISc" className="iisc" />
            <span className="rule" aria-hidden="true" />
            <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
          </div>
          <div className="spacer" />
          <Link to="/apply" className="switch-role">
            Back to application <span className="arrow">→</span>
          </Link>
        </header>
        <main className="app-main" style={{ margin: "0 auto" }}>
          <div className="form-page-narrow">
            <span className="eyebrow eyebrow-rule">Support</span>
            <h1 style={{ marginTop: "var(--s-3)" }}>Ticket filed.</h1>
            <p className="page-sub">
              Your ticket <strong>#{String(lastTicket.ticket_id).slice(0, 8)}</strong> is with our team.
              We'll respond to <strong>{email}</strong> within two business days.
            </p>
            <div className="form-actions" style={{ justifyContent: "flex-start" }}>
              <Link to="/apply" className="btn btn-primary">
                Back to application <span className="arrow">→</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logos">
          <img src="/assets/iisc-logo.png" alt="IISc" className="iisc" />
          <span className="rule" aria-hidden="true" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
        </div>
        <div className="spacer" />
        <Link to="/apply" className="switch-role">
          Back to application <span className="arrow">→</span>
        </Link>
      </header>

      <main className="app-main" style={{ margin: "0 auto" }}>
        <div className="form-page-narrow">
          <header style={{ marginBottom: "var(--s-6)" }}>
            <span className="eyebrow eyebrow-rule">Support</span>
            <h1 style={{ marginTop: "var(--s-3)" }}>How can we help?</h1>
            <p className="page-sub">
              A short, honest message — we reply within two business days. Include any error
              messages you've seen.
            </p>
          </header>

          <form onSubmit={onSubmit} className="form-stack" noValidate>
            <div className="form-row">
              <span className="field-label">Category</span>
              <div className="choice-group" role="radiogroup" aria-label="Category">
                {CATEGORIES.map((c) => (
                  <label
                    key={c.id}
                    className={`choice${category === c.id ? " selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={c.id}
                      checked={category === c.id}
                      onChange={() => setCategory(c.id)}
                    />
                    <span className="key">{c.key}</span>
                    <span className="lbl">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="sup-subject">Subject</label>
              <input
                id="sup-subject"
                className="field"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder="e.g. CV upload keeps failing at 90%"
                required
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="sup-body">Describe the issue</label>
              <textarea
                id="sup-body"
                className="field"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
                placeholder="What were you trying to do? What happened instead? Include any error messages."
              />
              <span className="field-help">{body.length} / 5000 characters</span>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="sup-email">Your email for our reply</label>
              <input
                id="sup-email"
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                readOnly={isAuthed}
                required
              />
              {isAuthed && (
                <span className="field-help">
                  We'll reply to the address on your account.
                </span>
              )}
            </div>

            {formError && <div className="inline-error" role="alert">{formError}</div>}

            <div className="form-actions">
              <Link to="/apply" className="btn btn-ghost">Cancel</Link>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit}
              >
                {submitting ? "Sending…" : (
                  <>Send message <span className="arrow">→</span></>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
