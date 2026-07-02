// MentorRespondForm — /mentors/respond/:token
//
// Public (no auth required). Token-gated: the link is emailed to the mentor.
// Loads mentor name from the token, then presents a conditional Q1→Q2–Q4 flow.
// Branded like SupportPage: ARTPARK logo, --artblue accents, admin.css tokens.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMentorForm } from "../hooks/useMentorForm.js";
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

export default function MentorRespondForm() {
  const { token } = useParams();
  const { load, submit, loading, submitting, error: hookError } = useMentorForm();

  /* Page-level state */
  const [pageState, setPageState] = useState("loading"); // loading | invalid | already | form | success_yes | success_no
  const [mentorName, setMentorName] = useState("");
  const [formError, setFormError] = useState(null);

  /* Form fields */
  const [willing, setWilling] = useState(""); // "yes" | "no" | ""
  const [daysAvailable, setDaysAvailable] = useState("");
  const [honorariumOptIn, setHonorariumOptIn] = useState(""); // "yes" | "no" | ""
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [futureCommsOptIn, setFutureCommsOptIn] = useState(""); // "yes" | "no" | ""
  const [contactEmail, setContactEmail] = useState("");

  /* Load on mount */
  useEffect(() => {
    if (!token) {
      setPageState("invalid");
      return;
    }
    load(token)
      .then((data) => {
        if (data.already_responded) {
          setPageState("already");
        } else {
          setMentorName(data.mentor_name || "");
          setPageState("form");
        }
      })
      .catch((err) => {
        if (err?.status === 404) {
          setPageState("invalid");
        } else {
          setPageState("invalid");
        }
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Validation */
  function validate() {
    if (!willing) return "Please indicate whether you are willing to mentor.";
    if (willing === "yes") {
      if (!daysAvailable.trim()) return "Please specify how many days you can allocate.";
      if (honorariumOptIn === "yes") {
        if (!accountName.trim()) return "Account holder name is required.";
        if (!accountNumber.trim()) return "Account number is required.";
        if (!ifsc.trim()) return "IFSC code is required.";
      }
    }
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

    const payload = { willing: willing === "yes" };
    if (willing === "yes") {
      payload.days_available = daysAvailable.trim();
      if (honorariumOptIn !== "") {
        payload.honorarium_opt_in = honorariumOptIn === "yes";
        if (honorariumOptIn === "yes") {
          payload.bank_details = {
            account_name: accountName.trim(),
            account_number: accountNumber.trim(),
            ifsc: ifsc.trim(),
          };
        }
      }
      if (futureCommsOptIn !== "") {
        payload.future_comms_opt_in = futureCommsOptIn === "yes";
      }
      if (contactEmail.trim()) {
        payload.contact_email = contactEmail.trim();
      }
    }

    try {
      await submit(token, payload);
      setPageState(willing === "yes" ? "success_yes" : "success_no");
    } catch (err) {
      setFormError(err?.message || "Submission failed. Please try again.");
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
          <div className="form-page-narrow">
            {children}
          </div>
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
        <span className="eyebrow eyebrow-rule">Mentor Invitation</span>
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
        <span className="eyebrow eyebrow-rule">Mentor Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Already received</h1>
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
        <span className="eyebrow eyebrow-rule">Mentor Invitation</span>
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
        <span className="eyebrow eyebrow-rule">Mentor Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>
          Welcome aboard{mentorName ? `, ${mentorName}` : ""}!
        </h1>
        <p className="page-sub">
          Thank you for agreeing to mentor our Technology Innovators. The ARTPARK team
          will follow up with next steps soon.
        </p>
      </Shell>
    );
  }

  /* pageState === "form" */
  return (
    <Shell>
      <header style={{ marginBottom: "var(--s-6)" }}>
        <span className="eyebrow eyebrow-rule">Mentor Invitation</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>
          {mentorName ? `Hello, ${mentorName}` : "Hello"}
        </h1>
        <p className="page-sub">
          ARTPARK TIR — Mentor invitation. We would be honoured to have you guide
          our cohort of Technology Innovators in Residence.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="form-stack" noValidate>

        {/* Q1 — Willing? */}
        <div className="form-row">
          <span className="field-label">
            Would you be willing to mentor a few Technology Innovators at ARTPARK?
          </span>
          <RadioYesNo
            name="willing"
            value={willing}
            onChange={setWilling}
          />
        </div>

        {/* Q2–Q4 — only when willing = yes */}
        {willing === "yes" && (
          <>
            {/* Q2 — Days available */}
            <div className="form-row">
              <label className="field-label" htmlFor="days-available">
                How many days would you be able to allocate to startups?
              </label>
              <input
                id="days-available"
                className="field"
                type="text"
                value={daysAvailable}
                onChange={(e) => setDaysAvailable(e.target.value)}
                placeholder="e.g. 2 days per month"
                required
              />
            </div>

            {/* Q3 — Honorarium */}
            <div className="form-row">
              <span className="field-label">
                Would you be open to a small honorarium from ARTPARK for your effort?
              </span>
              <RadioYesNo
                name="honorarium"
                value={honorariumOptIn}
                onChange={setHonorariumOptIn}
              />
            </div>

            {/* Bank details — only when honorarium = yes */}
            {honorariumOptIn === "yes" && (
              <div
                className="card card-soft"
                style={{ display: "flex", flexDirection: "column", gap: "var(--s-5)" }}
              >
                <p className="field-help" style={{ marginTop: 0 }}>
                  Please provide your bank details so we can process the honorarium.
                </p>

                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label className="field-label" htmlFor="account-name">
                    Account holder name
                  </label>
                  <input
                    id="account-name"
                    className="field"
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Full name as on bank account"
                    required
                  />
                </div>

                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label className="field-label" htmlFor="account-number">
                    Account number
                  </label>
                  <input
                    id="account-number"
                    className="field"
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="e.g. 0012345678901"
                    required
                  />
                </div>

                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label className="field-label" htmlFor="ifsc">
                    IFSC code
                  </label>
                  <input
                    id="ifsc"
                    className="field"
                    type="text"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. SBIN0001234"
                    maxLength={11}
                    required
                  />
                </div>
              </div>
            )}

            {/* Q4 — Future comms */}
            <div className="form-row">
              <span className="field-label">
                Would you be open to future communications from ARTPARK?
              </span>
              <RadioYesNo
                name="future-comms"
                value={futureCommsOptIn}
                onChange={setFutureCommsOptIn}
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="contact-email">
                Email address to register and engage (optional)
              </label>
              <input
                id="contact-email"
                className="field"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@domain.com"
              />
            </div>
          </>
        )}

        {/* Error banner */}
        {(formError || (hookError && pageState === "form")) && (
          <div className="inline-error" role="alert">
            {formError || hookError?.message || "Something went wrong. Please try again."}
          </div>
        )}

        {/* Submit */}
        {willing !== "" && (
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
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
