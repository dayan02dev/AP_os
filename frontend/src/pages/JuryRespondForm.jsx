// JuryRespondForm — /jury/respond/:token
//
// Public (no auth). Token-gated: the link is emailed to the juror. Loads the
// juror's name from the token, explains the engagement, then collects the
// accept/decline plus the context we need to match, onboard and pay them.
//
// Built on the 2026-05-14 ARTPARK design system primitives from
// styles/colors_and_type.css (.eyebrow, .card, .field, .field-label,
// .field-help, .choice-group, .btn-primary) via admin.css — the same tokens the
// admin / leadership / reviewer portals use. No bespoke CSS.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import "../styles/admin.css";

/* ------------------------------------------------------------------ */
/* Shell — MUST stay at module scope                                    */
/* ------------------------------------------------------------------ */
// Declaring this inside the component body gives it a new identity on every
// render, so React unmounts and remounts the whole subtree on each keystroke:
// the input loses focus after one character and the field reads as
// "untypeable". That was the reported bug on the domain + LinkedIn cells.
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

function RadioYesNo({ name, value, onChange, yesLabel = "Yes", noLabel = "No" }) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={name}>
      {[["yes", yesLabel], ["no", noLabel]].map(([v, label]) => (
        <label key={v} className={`choice${value === v ? " selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          <span className="lbl">{label}</span>
        </label>
      ))}
    </div>
  );
}

// Read-only recap of the engagement, so the terms are visible at the moment of
// decision rather than only in the email that brought them here.
function EngagementSummary() {
  return (
    <div className="card" style={{ marginBottom: "var(--s-6)" }}>
      <h2 style={{ fontSize: "var(--t-body)", fontWeight: 700, margin: "0 0 var(--s-3)" }}>
        What you are being invited to
      </h2>
      <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.65 }}>
        <li style={{ marginBottom: "var(--s-3)" }}>
          <strong>Evaluate.</strong> You receive a small set of TIR applications matched
          to your domain — not the whole pile — and review them in the ARTPARK jury
          portal, then <strong>pick the three ventures you would most like to mentor</strong>.
        </li>
        <li style={{ marginBottom: "var(--s-3)" }}>
          <strong>Mentor.</strong> You guide the startups you personally chose. Baseline
          is <strong>one day per week per startup</strong>, capped at three startups —
          never a team you did not pick.
        </li>
        <li>
          <strong>Honorarium.</strong> This is a paid engagement — mentors receive a{" "}
          <strong>monthly honorarium</strong> for the duration of the mentorship. You can
          also decline it and contribute pro bono.
        </li>
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */

export default function JuryRespondForm() {
  const { token } = useParams();

  const [pageState, setPageState] = useState("loading"); // loading|invalid|already|form|success_yes|success_no
  const [juryName, setJuryName] = useState("");
  const [juryEmail, setJuryEmail] = useState("");
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /* Decision */
  const [accept, setAccept] = useState("");

  /* Professional context */
  const [fullName, setFullName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [designation, setDesignation] = useState("");
  const [expertise, setExpertise] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  /* Engagement */
  const [mentoringOptIn, setMentoringOptIn] = useState("");
  const [maxStartups, setMaxStartups] = useState("3");

  /* Honorarium */
  const [honorariumOptIn, setHonorariumOptIn] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [pan, setPan] = useState("");

  /* Closing */
  const [notes, setNotes] = useState("");
  const [futureCommsOptIn, setFutureCommsOptIn] = useState("");

  useEffect(() => {
    if (!token) {
      setPageState("invalid");
      return;
    }
    api
      .get("/jury/respond/" + token)
      .then((data) => {
        setJuryName(data.name || "");
        setJuryEmail(data.email || "");
        setFullName(data.name || "");
        setPageState(data.status !== "invited" ? "already" : "form");
      })
      .catch(() => setPageState("invalid"));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    if (!accept) return "Please let us know whether you'd like to join the panel.";
    if (accept !== "yes") return null;

    const exp = expertise.split(",").map((s) => s.trim()).filter(Boolean);
    if (exp.length === 0) return "Please list at least one area of expertise.";
    if (!linkedinUrl.trim()) return "Please add your LinkedIn profile URL.";
    if (!mentoringOptIn) return "Please confirm whether you're able to mentor.";
    if (!honorariumOptIn) return "Please choose an honorarium preference.";
    if (honorariumOptIn === "yes") {
      if (!accountName.trim()) return "Account holder name is required for the honorarium.";
      if (!accountNumber.trim()) return "Account number is required for the honorarium.";
      if (!ifsc.trim()) return "IFSC code is required for the honorarium.";
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const msg = validate();
    if (msg) {
      setFormError(msg);
      return;
    }

    const payload = { accept: accept === "yes" };
    if (accept === "yes") {
      payload.expertise_domains = expertise.split(",").map((s) => s.trim()).filter(Boolean);
      payload.linkedin_url = linkedinUrl.trim();
      if (fullName.trim()) payload.full_name = fullName.trim();
      if (affiliation.trim()) payload.affiliation = affiliation.trim();
      if (designation.trim()) payload.designation = designation.trim();
      if (contactPhone.trim()) payload.contact_phone = contactPhone.trim();
      payload.mentoring_opt_in = mentoringOptIn === "yes";
      payload.max_startups = Number(maxStartups) || 3;
      payload.honorarium_opt_in = honorariumOptIn === "yes";
      if (honorariumOptIn === "yes") {
        payload.bank_details = {
          account_name: accountName.trim(),
          account_number: accountNumber.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}),
        };
      }
      if (notes.trim()) payload.notes = notes.trim();
      if (futureCommsOptIn) payload.future_comms_opt_in = futureCommsOptIn === "yes";
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
  /* Terminal states                                                    */
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
        <span className="eyebrow eyebrow-rule">Jury &amp; Mentor Panel</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Link not recognised</h1>
        <p className="page-sub">
          This invitation link is invalid or has expired. If you believe this is an
          error, please reply to the invitation email and we'll send a fresh link.
        </p>
      </Shell>
    );
  }

  if (pageState === "already") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury &amp; Mentor Panel</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Already responded</h1>
        <p className="page-sub">
          You've already responded — thank you. We have recorded your answer and will
          be in touch shortly.
        </p>
      </Shell>
    );
  }

  if (pageState === "success_no") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury &amp; Mentor Panel</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Thank you</h1>
        <p className="page-sub">
          Thank you for your time and consideration — we genuinely appreciate and
          respect your decision. We'd be glad to stay in touch for future cohorts.
        </p>
      </Shell>
    );
  }

  if (pageState === "success_yes") {
    return (
      <Shell>
        <span className="eyebrow eyebrow-rule">Jury &amp; Mentor Panel</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>Welcome to the panel</h1>
        <p className="page-sub">
          Thank you for joining the ARTPARK TIR 2026 jury and mentor panel. We've
          emailed your jury portal sign-in details to <strong>{juryEmail}</strong>.
        </p>
        <div className="card" style={{ marginTop: "var(--s-6)" }}>
          <h2 style={{ fontSize: "var(--t-body)", fontWeight: 700, margin: "0 0 var(--s-3)" }}>
            What happens next
          </h2>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.65 }}>
            <li style={{ marginBottom: "var(--s-2)" }}>
              Sign in with the credentials we've just emailed you.
            </li>
            <li style={{ marginBottom: "var(--s-2)" }}>
              We'll match a small set of applications to your domain and notify you
              when your queue is ready.
            </li>
            <li>
              Review them, then pick the three ventures you'd like to mentor.
            </li>
          </ol>
        </div>
      </Shell>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Form                                                               */
  /* ---------------------------------------------------------------- */

  return (
    <Shell>
      <header style={{ marginBottom: "var(--s-6)" }}>
        <span className="eyebrow eyebrow-rule">Jury &amp; Mentor Panel · TIR 2026</span>
        <h1 style={{ marginTop: "var(--s-3)" }}>
          {juryName ? `Hello, ${juryName}` : "Hello"}
        </h1>
        <p className="page-sub">
          ARTPARK's <strong>Technology Innovators in Residence</strong> programme takes
          lab-proven deep-tech research — AI, robotics, novel materials, sensors,
          cyber-physical systems — and turns it into products, with a ₹25L zero-equity
          grant and a home at IISc Bangalore. We'd be honoured to have you help choose
          and guide the 2026 cohort.
        </p>
      </header>

      <EngagementSummary />

      <form onSubmit={handleSubmit} className="form-stack" noValidate>
        <div className="form-row">
          <span className="field-label">
            Would you like to join the ARTPARK TIR jury and mentor panel?
          </span>
          <RadioYesNo
            name="accept"
            value={accept}
            onChange={setAccept}
            yesLabel="Yes, count me in"
            noLabel="No, not this time"
          />
        </div>

        {accept === "yes" && (
          <>
            {/* ── About you ─────────────────────────────────────────── */}
            <div className="section-head" style={{ marginTop: "var(--s-5)" }}>
              <span className="eyebrow">About you</span>
              <h2>Your details</h2>
              <p>We use these to match you with the most relevant ventures.</p>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="full-name">Full name</label>
              <input
                id="full-name" className="field" type="text" value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Prof. A. N. Example"
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="affiliation">Institution / organisation</label>
              <input
                id="affiliation" className="field" type="text" value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="e.g. Indian Institute of Science"
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="designation">Designation</label>
              <input
                id="designation" className="field" type="text" value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Professor, Dept. of Computer Science &amp; Automation"
              />
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="expertise">Areas of expertise</label>
              <input
                id="expertise" className="field" type="text" value={expertise}
                onChange={(e) => setExpertise(e.target.value)}
                placeholder="Robotics, Computer Vision, MedTech"
              />
              <p className="field-help">
                Comma separated. These drive which applications reach you.
              </p>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="linkedin-url">LinkedIn profile</label>
              <input
                id="linkedin-url" className="field" type="text" value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/…"
              />
              <p className="field-help">
                Used to build your panel profile. A faculty or lab page works too.
              </p>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="contact-phone">Phone (optional)</label>
              <input
                id="contact-phone" className="field" type="tel" value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+91 …"
              />
            </div>

            {/* ── Mentorship ────────────────────────────────────────── */}
            <div className="section-head" style={{ marginTop: "var(--s-5)" }}>
              <span className="eyebrow">Mentorship</span>
              <h2>Your commitment</h2>
              <p>Baseline is one day per week per startup, capped at three.</p>
            </div>

            <div className="form-row">
              <span className="field-label">
                After evaluation, are you able to mentor the startups you pick?
              </span>
              <RadioYesNo name="mentoring" value={mentoringOptIn} onChange={setMentoringOptIn} />
            </div>

            {mentoringOptIn === "yes" && (
              <div className="form-row">
                <label className="field-label" htmlFor="max-startups">
                  Maximum startups you'd take on
                </label>
                <select
                  id="max-startups" className="field" value={maxStartups}
                  onChange={(e) => setMaxStartups(e.target.value)}
                >
                  <option value="1">1 startup</option>
                  <option value="2">2 startups</option>
                  <option value="3">3 startups (maximum)</option>
                </select>
              </div>
            )}

            {/* ── Honorarium ────────────────────────────────────────── */}
            <div className="section-head" style={{ marginTop: "var(--s-5)" }}>
              <span className="eyebrow">Honorarium</span>
              <h2>Monthly compensation</h2>
              <p>
                Mentors receive a monthly honorarium for the duration of the mentorship.
              </p>
            </div>

            <div className="form-row">
              <span className="field-label">Would you like to receive the honorarium?</span>
              <RadioYesNo
                name="honorarium"
                value={honorariumOptIn}
                onChange={setHonorariumOptIn}
                yesLabel="Yes, please"
                noLabel="No, pro bono"
              />
            </div>

            {honorariumOptIn === "yes" && (
              <>
                <div className="form-row">
                  <label className="field-label" htmlFor="account-name">Account holder name</label>
                  <input
                    id="account-name" className="field" type="text" value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="As printed on the bank account"
                  />
                </div>

                <div className="form-row">
                  <label className="field-label" htmlFor="account-number">Account number</label>
                  <input
                    id="account-number" className="field" type="text" value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    inputMode="numeric" autoComplete="off"
                  />
                </div>

                <div className="form-row">
                  <label className="field-label" htmlFor="ifsc">IFSC code</label>
                  <input
                    id="ifsc" className="field" type="text" value={ifsc}
                    onChange={(e) => setIfsc(e.target.value)}
                    placeholder="e.g. HDFC0001234" autoComplete="off"
                  />
                </div>

                <div className="form-row">
                  <label className="field-label" htmlFor="bank-name">Bank name (optional)</label>
                  <input
                    id="bank-name" className="field" type="text" value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </div>

                <div className="form-row">
                  <label className="field-label" htmlFor="pan">PAN (optional)</label>
                  <input
                    id="pan" className="field" type="text" value={pan}
                    onChange={(e) => setPan(e.target.value)}
                    placeholder="ABCDE1234F" autoComplete="off"
                  />
                  <p className="field-help">
                    Helps us process tax paperwork without a follow-up email.
                  </p>
                </div>

                <p className="field-help" style={{ marginTop: "calc(-1 * var(--s-2))" }}>
                  These details are stored securely, used only to pay your honorarium,
                  and are never shared outside ARTPARK's finance process.
                </p>
              </>
            )}

            {/* ── Anything else ─────────────────────────────────────── */}
            <div className="section-head" style={{ marginTop: "var(--s-5)" }}>
              <span className="eyebrow">Anything else</span>
              <h2>Notes &amp; preferences</h2>
            </div>

            <div className="form-row">
              <label className="field-label" htmlFor="notes">
                Anything we should know? (optional)
              </label>
              <textarea
                id="notes" className="field" rows={4} value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Availability, sectors you'd rather avoid, conflicts of interest…"
              />
            </div>

            <div className="form-row">
              <span className="field-label">
                May we contact you about future ARTPARK cohorts and events?
              </span>
              <RadioYesNo
                name="future-comms" value={futureCommsOptIn} onChange={setFutureCommsOptIn}
              />
            </div>
          </>
        )}

        {formError && (
          <div className="inline-error" role="alert">{formError}</div>
        )}

        {accept !== "" && (
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Submitting…" : (<>Submit <span className="arrow">→</span></>)}
            </button>
          </div>
        )}
      </form>
    </Shell>
  );
}
