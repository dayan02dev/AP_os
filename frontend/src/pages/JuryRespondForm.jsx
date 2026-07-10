// JuryRespondForm — /jury/respond/:token
//
// Public (no auth required). Token-gated: the link is emailed to the juror.
// Loads juror name from the token, then presents a Q1 accept/decline flow.
// Branded like MentorRespondForm: ARTPARK logo, --artblue accents, admin.css tokens.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import "../styles/admin.css";

/* ------------------------------------------------------------------ */
/* Internal sub-components                                              */
/* ------------------------------------------------------------------ */

function RadioYesNo({ name, value, onChange }) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={name}>
      {["yes", "no"].map((v) => (
        <label key={v} className={`choice${value === v ? " selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          <span className="lbl">{v === "yes" ? "Yes" : "No"}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                             */
/* ------------------------------------------------------------------ */

export default function JuryRespondForm() {
  const { token } = useParams();

  /* Page-level state */
  const [pageState, setPageState] = useState("loading"); // loading | invalid | already | form | success_yes | success_no
  const [juryName, setJuryName] = useState("");
  const [juryEmail, setJuryEmail] = useState("");
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /* Form fields */
  const [accept, setAccept] = useState(""); // "yes" | "no" | ""
  const [expertise, setExpertise] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  /* Load on mount */
  useEffect(() => {
    if (!token) {
      setPageState("invalid");
      return;
    }
    api
      .get("/jury/respond/" + token)
      .then((data) => {
        if (data.status !== "invited") {
          setJuryName(data.name || "");
          setJuryEmail(data.email || "");
          setPageState("already");
        } else {
          setJuryName(data.name || "");
          setJuryEmail(data.email || "");
          setPageState("form");
        }
      })
      .catch(() => {
        setPageState("invalid");
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Validation */
  function validate() {
    if (!accept) return "Please indicate whether you'll join the jury panel.";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const validationMsg = validate();
    if (validationMsg) {
      setFormError(validationMsg);
      return;
    }

    const payload = { accept: accept === "yes" };
    if (accept === "yes") {
      payload.expertise_domains = expertise
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      payload.linkedin_url = linkedinUrl.trim() || null;
    }

    setSubmitting(true);
    try {
      await api.post("/jury/respond/" + token, payload);
      setPageState(accept === "yes" ? "success_yes" : "success_no");
    } catch (err) {
      setFormError(err?.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Shell — shared header + centered card                             */
  /* ---------------------------------------------------------------- */

  function Shell({ children }) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="logos">
            <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
          </div>
          <div className="spacer" />
        </header>
        <main className="app-main" style={{ margin: "0 auto" }}>
          <div className="form-page-narrow">{children}</div>
        </main>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* States                                                             */
  /* ---------------------------------------------------------------- */

  if (pageState === "loading") {
    return (
      <Shell>
        <p className="page-sub" style={{ color: "var(--ink-dim)" }}>Loading…</p>
      </Shell>
    );
  }

  if (pageState === "invalid") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Link not recognised</h1>
        <p className="page-sub">
          This invitation link is invalid or expired. If you believe this is an error,
          please contact the ARTPARK team directly.
        </p>
      </Shell>
    );
  }

  if (pageState === "already") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Already responded</h1>
        <p className="page-sub">
          You've already responded — thank you. We have recorded your answer and will be
          in touch shortly.
        </p>
      </Shell>
    );
  }

  if (pageState === "success_no") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Thank you</h1>
        <p className="page-sub">
          Thank you for your time and attention, we truly appreciate and respect your decision.
        </p>
      </Shell>
    );
  }

  if (pageState === "success_yes") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>You're on the panel!</h1>
        <p className="page-sub">
          You're on the panel — we've emailed your jury portal sign-in details to {juryEmail}.
        </p>
      </Shell>
    );
  }

  /* pageState === "form" */
  return (
    <Shell>
      <header style={{ marginBottom: "var(--s-6)" }}>
        <span className="eyebrow eyebrow-rule">Jury Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>
          {juryName ? `Hello, ${juryName}` : "Hello"}
        </h1>
        <p className="page-sub">
          ARTPARK TIR — Jury invitation. We would be honoured to have you join the jury
          panel for our cohort of Technology Innovators in Residence.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="form-stack" noValidate>

        {/* Q1 — Join the panel? */}
        <div className="form-row">
          <span className="field-label">
            Will you join the ARTPARK TIR jury panel?
          </span>
          <RadioYesNo name="accept" value={accept} onChange={setAccept} />
        </div>

        {/* Optional details — only when accepting */}
        {accept === "yes" && (
          <>
            <div className="form-row">
              <label className="field-label" htmlFor="expertise">
                Areas of expertise (optional)
              </label>
              <input
                id="expertise"
                className="field"
                type="text"
                value={expertise}
                onChange={(e) => setExpertise(e.target.value)}
                placeholder="e.g. Robotics, HealthTech — comma separated"
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="linkedin-url">
                LinkedIn profile (optional)
              </label>
              <input
                id="linkedin-url"
                className="field"
                type="text"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/…"
              />
            </div>
          </>
        )}

        {/* Error banner */}
        {formError && (
          <div className="inline-error" role="alert">
            {formError}
          </div>
        )}

        {/* Submit */}
        {accept !== "" && (
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Submitting…" : (
                <>Submit <span className="arrow">→</span></>
              )}
            </button>
          </div>
        )}
      </form>
    </Shell>
  );
}
