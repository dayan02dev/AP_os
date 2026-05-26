// Auth (register/login) + CV upload + parsing animation screens

import { Fragment, useState as useAS, useEffect as useAE, useRef as useAR } from "react";
import { useNavigate } from "react-router-dom";
import { validateEmail, isPasswordValid, EmailInput, PasswordInput } from "./validators.jsx";
import { useTemplate } from "./hooks/useTemplate.js";
import { setMyTrack } from "./lib/auth.js";

// Static template URL with a cache-bust query string. Bump the `v=` value
// whenever the .docx in /public/templates/ changes so old browser cache
// entries get invalidated.
const TEMPLATE_DOWNLOAD_URL = "/templates/ARTPARK_TIR_Application_Template.docx?v=1";

// Tiny "registered users" store in localStorage so login/register can check each other
const USERS_KEY = "tir:users";
const getStoredUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || "{}"); } catch { return {}; } };
const setStoredUsers = (u) => localStorage.setItem(USERS_KEY, JSON.stringify(u));

function AuthScreen({ onAuthed, warmCopy }) {
  const [mode, setMode] = useAS("register"); // register | login
  const [email, setEmail] = useAS("");
  const [password, setPassword] = useAS("");
  const [confirm, setConfirm] = useAS("");
  const [err, setErr] = useAS("");

  const submit = (e) => {
    e?.preventDefault();
    setErr("");
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) return setErr(emailCheck.message);

    if (mode === "register") {
      if (!isPasswordValid(password)) return setErr("Your password doesn't meet all the requirements yet.");
      if (password !== confirm) return setErr("Passwords don't match.");
    } else {
      if (!password || password.length < 6) return setErr("Enter your password.");
    }

    const users = getStoredUsers();
    if (mode === "register") {
      if (users[email]) return setErr("An account with this email already exists. Switch to sign in.");
      users[email] = { email, created: Date.now() };
      setStoredUsers(users);
      onAuthed({ email, mode: "register", returning: false });
    } else {
      // Login flow — be forgiving: if no record, accept and treat as first-time returning
      const known = !!users[email];
      onAuthed({ email, mode: "login", returning: known });
    }
  };

  return (
    <div className="eir-screen eir-auth">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>{mode === "register" ? "create account" : "sign in"}</span>
      </div>
      <div className="eir-auth-body">

        {/* Prominent tab switcher */}
        <div className="eir-auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`eir-auth-tab ${mode === "register" ? "is-on" : ""}`}
            onClick={() => { setMode("register"); setErr(""); }}
          >
            <span className="eir-auth-tab-label">New applicant</span>
            <span className="eir-mono eir-auth-tab-sub">create account</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`eir-auth-tab ${mode === "login" ? "is-on" : ""}`}
            onClick={() => { setMode("login"); setErr(""); }}
          >
            <span className="eir-auth-tab-label">Returning user</span>
            <span className="eir-mono eir-auth-tab-sub">sign in</span>
          </button>
        </div>

        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> applications · open
        </div>
        <h1 className="eir-welcome-title">
          {warmCopy
            ? (mode === "register" ? <>Let's set up your <em>account</em>.</> : <>Welcome <em>back</em>.</>)
            : (mode === "register" ? "Create your account" : "Sign in")}
        </h1>
        <p className="eir-welcome-lede">
          {mode === "register"
            ? (warmCopy
                ? "One account lets you save your progress, come back later, and revisit your answers after submission."
                : "Secure authentication to save your progress.")
            : (warmCopy
                ? "Pick up a saved draft, or revisit a past submission."
                : "Access your saved application or past submissions.")}
        </p>

        <form className="eir-auth-form" onSubmit={submit}>
          <div className="eir-auth-field">
            <label className="eir-mono eir-link-label">email</label>
            <EmailInput
              value={email}
              onChange={setEmail}
              placeholder="you@domain.com"
              autoFocus
              showValidation={mode === "register"}
            />
          </div>
          <div className="eir-auth-field">
            <label className="eir-mono eir-link-label">password</label>
            {mode === "register" ? (
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="Create a strong password"
                showRules
                showStrength
                autoComplete="new-password"
              />
            ) : (
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="Your password"
                showRules={false}
                showStrength={false}
                autoComplete="current-password"
              />
            )}
          </div>
          {mode === "register" && (
            <div className="eir-auth-field">
              <label className="eir-mono eir-link-label">confirm</label>
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                placeholder="Re-enter password"
                showRules={false}
                showStrength={false}
                autoComplete="new-password"
                compareTo={password}
              />
            </div>
          )}
          {err && <div className="eir-auth-err eir-mono">! {err}</div>}
          <div className="eir-q-actions">
            <button type="submit" className="eir-btn eir-btn-primary">
              <span>{mode === "register" ? "Create account" : "Sign in"}</span>
              <span className="eir-btn-key eir-mono">⏎</span>
            </button>
            {mode === "login" && (
              <button type="button" className="eir-link-btn eir-mono" onClick={() => alert("A password reset link would be emailed to you. (Demo)")}>
                forgot password?
              </button>
            )}
          </div>
        </form>

        <div className="eir-welcome-foot eir-mono eir-dim">
          encrypted at rest · progress saves automatically
        </div>
      </div>
    </div>
  );
}

// Shown after login when there's something to resume or review
// Canonical milestone pipeline — used for both seed data and live submissions
// Each milestone has a key, label, short description, and approximate timing hint
const MILESTONES = [
  { key: "submitted", label: "Application submitted", desc: "We've received your application and it's in the queue." },
  { key: "under_review", label: "Under review", desc: "Our cohort committee is reading and discussing." },
  { key: "shortlisted", label: "Shortlisted", desc: "You've been selected for the interview round." },
  { key: "interview", label: "Interview scheduled", desc: "Panel interview with ARTPARK faculty + industry leads." },
  { key: "decision", label: "Final decision", desc: "Outcome communicated and onboarding logistics sent." },
];

// Terminal states that don't fit the linear pipeline
const TERMINAL_OUTCOMES = {
  not_shortlisted: { label: "Not shortlisted this cycle", tone: "neutral" },
  withdrawn: { label: "Withdrawn by applicant", tone: "neutral" },
  accepted: { label: "Accepted — welcome to the cohort", tone: "positive" },
  declined: { label: "Offer declined", tone: "neutral" },
};

// Given a submission with currentMilestone + optional outcome, return the pipeline progress info
function getSubmissionProgress(sub) {
  if (!sub) return { currentIdx: 0, isTerminal: false, outcome: null };
  if (sub.outcome && TERMINAL_OUTCOMES[sub.outcome]) {
    // Terminal — find how far they got before outcome
    const reachedIdx = MILESTONES.findIndex(m => m.key === sub.lastReached);
    return {
      currentIdx: reachedIdx >= 0 ? reachedIdx : 0,
      isTerminal: true,
      outcome: TERMINAL_OUTCOMES[sub.outcome],
      outcomeKey: sub.outcome,
    };
  }
  const idx = MILESTONES.findIndex(m => m.key === (sub.currentMilestone || "submitted"));
  return {
    currentIdx: idx >= 0 ? idx : 0,
    isTerminal: false,
    outcome: null,
  };
}

// Given progress, derive a human-readable status label for cards
function getStatusLabel(sub) {
  const p = getSubmissionProgress(sub);
  if (p.isTerminal) return p.outcome.label;
  return MILESTONES[p.currentIdx]?.label || "Submitted";
}

// Shown after login. Three tabs: start new / continue draft / past applications.
function ReturningChoiceScreen({ user, applicantName, hasDraft, draftProgress, pastSubmissions, onResume, onViewPast, onStartNew, warmCopy, track = "tir" }) {
  // Always default to the "Start new" tab on login. Founders can still
  // click into "Continue existing" or "Past applications" if they want.
  // Previously this defaulted to "continue" when hasDraft was true, but
  // that buried the new-application affordance and surprised users who
  // signed in expecting to start fresh.
  const [tab, setTab] = useAS("start");
  const navigate = useNavigate();
  const cycleLabel = track === "sip" ? "SIP.2026" : "TIR.2026";

  // Flip profiles.track on the server BEFORE navigating into the wizard.
  // SIP RLS (migration 011) gates every read/write on sip_applications
  // and SIP storage behind profiles.track='sip'; without this flip a
  // user with track='tir' who picks SIP can't draft, and vice versa.
  //
  // We deliberately don't await-then-block: if the PATCH fails (network
  // blip, transient 5xx) we proceed anyway. The downstream wizard will
  // fail-loud on the next save with a 403/empty result, which is more
  // surfaceable than a silent click that goes nowhere. The error is
  // logged for debugging.
  const pickTrackThen = async (chosen, navTarget) => {
    try {
      await setMyTrack(chosen);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[chooser] setMyTrack failed; proceeding anyway", err);
    }
    if (typeof navTarget === "function") navTarget();
    else navigate(navTarget);
  };

  // Display name only comes from the current draft's basic_full_name —
  // either CV-parsed or hand-typed in the wizard. We intentionally do
  // NOT fall back to profiles.full_name: that field can hold a stale
  // CV name from a previous account or test session, leading to
  // confusing greetings like "Good to see you, Sanjay" when the actual
  // user is manager@... before they've uploaded anything. Email
  // local-part is the safe fallback — title-cased so "rohanss24" reads
  // "Rohanss24".
  const displayName =
    applicantName?.trim() ||
    ((email) => email?.split("@")[0]?.replace(/^./, (c) => c.toUpperCase()))(user.email);

  return (
    <div className="eir-screen eir-returning">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / {cycleLabel}</span>
        <span>signed in · {user.email}</span>
      </div>
      <div className="eir-auth-body">
        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> welcome back
        </div>
        <h1 className="eir-welcome-title">
          {warmCopy ? <>Good to see you, <em>{displayName}</em>.</> : "What would you like to do?"}
        </h1>

        {/* Three-tab nav */}
        <div className="eir-tabs-nav" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "start"}
            className={`eir-tabs-item ${tab === "start" ? "is-on" : ""}`}
            onClick={() => setTab("start")}
          >
            <span className="eir-mono eir-tabs-num">01</span>
            <span className="eir-tabs-label">Start new</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "continue"}
            disabled={!hasDraft}
            className={`eir-tabs-item ${tab === "continue" ? "is-on" : ""} ${!hasDraft ? "is-disabled" : ""}`}
            onClick={() => hasDraft && setTab("continue")}
          >
            <span className="eir-mono eir-tabs-num">02</span>
            <span className="eir-tabs-label">Continue existing</span>
            {hasDraft && <span className="eir-tabs-badge eir-mono">{Math.round((draftProgress || 0) * 100)}%</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "past"}
            className={`eir-tabs-item ${tab === "past" ? "is-on" : ""}`}
            onClick={() => setTab("past")}
          >
            <span className="eir-mono eir-tabs-num">03</span>
            <span className="eir-tabs-label">Past applications</span>
            {pastSubmissions.length > 0 && <span className="eir-tabs-badge eir-mono">{pastSubmissions.length}</span>}
          </button>
        </div>

        {/* Tab panels */}
        <div className="eir-tabs-panels">

          {tab === "start" && (
            <div className="eir-tabs-panel" role="tabpanel">
              <div className="eir-tabs-panel-head">
                <h2 className="eir-tabs-panel-title">Begin a 2026 TIR or SIP application</h2>
                <p className="eir-tabs-panel-sub">
                  Pick the track that fits where you are. Your CV auto-fills the basics either way — est. 60–90 minutes.
                  {hasDraft && " Starting new will clear your current in-progress draft."}
                </p>
              </div>
              <div className="eir-ret-tracks">
                {/* TIR card. If the user is on /apply (track==="tir") clicking
                    starts the wizard in place; otherwise it navigates to
                    /apply, where TirAppGate decides whether to render the
                    wizard or the track-mismatch screen based on the
                    backend's wrong_track signal. */}
                <button
                  className="eir-ret-track eir-ret-track-tir"
                  onClick={() =>
                    pickTrackThen(
                      "tir",
                      track === "tir" ? onStartNew : "/apply?direct=1",
                    )
                  }
                >
                  <div className="eir-ret-track-head">
                    <span className="eir-mono eir-ret-track-eyebrow">begin · tir.2026</span>
                    <span className="eir-ret-track-arrow eir-mono">→</span>
                  </div>
                  <div className="eir-ret-track-title">Technology Innovator in Residence</div>
                  <p className="eir-ret-track-body">
                    For pre-incorporation researchers translating <em>lab-proven</em> work toward a defensible technology angle. TRL 3 and up.
                  </p>
                  <div className="eir-mono eir-dim eir-ret-track-meta">
                    ↳ closes 22 may · ~60–90 min
                  </div>
                </button>

                {/* SIP card. Symmetric: if on /apply-sip (track==="sip") it
                    starts the SIP wizard in place; otherwise it navigates
                    to /apply-sip, where SipAppRoute renders the wizard or
                    the mismatch screen depending on profiles.track. */}
                <button
                  className="eir-ret-track eir-ret-track-sip"
                  onClick={() =>
                    pickTrackThen(
                      "sip",
                      track === "sip" ? onStartNew : "/apply-sip?direct=1",
                    )
                  }
                >
                  <div className="eir-ret-track-head">
                    <span className="eir-mono eir-ret-track-eyebrow">begin · sip.2026</span>
                    <span className="eir-ret-track-arrow eir-mono">→</span>
                  </div>
                  <div className="eir-ret-track-title">Startup Incubation Programme</div>
                  <p className="eir-ret-track-body">
                    For incorporated Pvt Ltd ventures with a working prototype (TRL 4+) and early customer signal.
                  </p>
                  <div className="eir-mono eir-dim eir-ret-track-meta">
                    ↳ closes 31 may · ~60–90 min
                  </div>
                </button>
              </div>
              <div className="eir-ret-tracks-note eir-mono">
                <span className="eir-ret-tracks-note-mark">!</span>
                <span>
                  You can <em>explore</em> both tracks, but only{" "}
                  <strong>one application</strong> can be submitted per applicant — pick the track that fits where you are today.
                </span>
              </div>
            </div>
          )}

          {tab === "continue" && hasDraft && (
            <div className="eir-tabs-panel" role="tabpanel">
              <div className="eir-tabs-panel-head">
                <h2 className="eir-tabs-panel-title">Continue where you left off</h2>
                <p className="eir-tabs-panel-sub">
                  You have an application in progress. Pick up exactly where you stopped.
                </p>
              </div>
              <div className="eir-ret-list">
                <button className="eir-ret-card eir-ret-card-primary" onClick={onResume}>
                  <div className="eir-ret-card-head">
                    <span className="eir-mono eir-ret-card-eyebrow">in progress</span>
                    <span className="eir-mono eir-ret-card-pct">{Math.round((draftProgress || 0) * 100)}%</span>
                  </div>
                  <div className="eir-ret-card-title">Resume draft</div>
                  <div className="eir-ret-card-bar"><div className="eir-ret-card-bar-fill" style={{ width: `${Math.round((draftProgress || 0) * 100)}%` }} /></div>
                  <div className="eir-mono eir-dim eir-ret-card-meta">↳ continue from your last answered question</div>
                </button>
              </div>
            </div>
          )}

          {tab === "past" && (
            <div className="eir-tabs-panel" role="tabpanel">
              <div className="eir-tabs-panel-head">
                <h2 className="eir-tabs-panel-title">Past applications</h2>
                <p className="eir-tabs-panel-sub">
                  Review previously-submitted applications, track milestone progress, and read reviewer feedback.
                </p>
              </div>

              {pastSubmissions.length === 0 ? (
                <div className="eir-tabs-empty">
                  <div className="eir-tabs-empty-icon eir-mono">∅</div>
                  <p className="eir-tabs-empty-title">No submissions yet</p>
                  <p className="eir-tabs-empty-sub">
                    Once you submit an application, it'll appear here with live status updates and any reviewer feedback.
                  </p>
                </div>
              ) : (
                <div className="eir-ret-list">
                  {pastSubmissions.map((s, i) => {
                    const progress = getSubmissionProgress(s);
                    const statusLabel = getStatusLabel(s);
                    const toneClass = progress.isTerminal
                      ? `eir-ret-status-${progress.outcomeKey}`
                      : `eir-ret-status-${(s.currentMilestone || "submitted")}`;
                    return (
                      <button key={i} className="eir-ret-card eir-ret-card-past" onClick={() => onViewPast(s)}>
                        <div className="eir-ret-card-head">
                          <div className="eir-ret-card-head-left">
                            <span className="eir-mono eir-ret-card-eyebrow">#{s.id}</span>
                            <span className="eir-mono eir-ret-card-cycle-sep">·</span>
                            <span className="eir-mono eir-dim eir-ret-card-cycle">{s.cycle || "TIR cohort"}</span>
                          </div>
                          <span className={`eir-ret-status eir-mono ${toneClass}`}>
                            {statusLabel.toUpperCase()}
                          </span>
                        </div>
                        <div className="eir-ret-card-title">{s.projectTitle || s.answers?.problemStatement?.slice(0, 80) || "Your application"}{s.projectTitle ? "" : (s.answers?.problemStatement?.length > 80 ? "…" : "")}</div>

                        {/* Mini milestone pipeline */}
                        <div className="eir-ret-pipeline">
                          {MILESTONES.map((m, mi) => {
                            const reached = progress.isTerminal
                              ? mi <= progress.currentIdx
                              : mi <= progress.currentIdx;
                            const isCurrent = !progress.isTerminal && mi === progress.currentIdx;
                            return (
                              <Fragment key={m.key}>
                                <span
                                  className={`eir-ret-pipe-dot ${reached ? "is-reached" : ""} ${isCurrent ? "is-current" : ""} ${progress.isTerminal && mi === progress.currentIdx ? "is-terminal" : ""}`}
                                  title={m.label}
                                />
                                {mi < MILESTONES.length - 1 && (
                                  <span className={`eir-ret-pipe-line ${mi < progress.currentIdx ? "is-reached" : ""}`} />
                                )}
                              </Fragment>
                            );
                          })}
                        </div>

                        <div className="eir-mono eir-dim eir-ret-card-meta">
                          ↳ submitted {new Date(s.ts).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                          {s.feedback && <> · feedback available</>}
                          {s.lastUpdate && <> · updated {new Date(s.lastUpdate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="eir-welcome-foot eir-mono eir-dim">
          ↳ your data is encrypted at rest · progress saves automatically
        </div>
      </div>
    </div>
  );
}

function UploadScreen({ onUploaded, warmCopy }) {
  const [cv, setCv] = useAS(null);
  const [linkedin, setLinkedin] = useAS("");
  const [github, setGithub] = useAS("");
  const inputRef = useAR(null);
  const [drag, setDrag] = useAS(false);

  // Keep the actual File object on `cv.file` so App.jsx can POST it to
  // /resume/upload. Display-only fields (name, size) still render from the
  // top-level keys so the file-received UI below doesn't need to change.
  const handleFile = (f) => {
    if (f) setCv({ name: f.name, size: f.size, file: f });
  };

  const submit = () => { if (cv) onUploaded({ cv, linkedin, github }); };

  return (
    <div className="eir-screen eir-upload">
      <div className="eir-coord eir-mono">
        <span>01 · Professional Profile</span>
        <span>step 1 of 2</span>
      </div>
      <div className="eir-upload-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">01</span>
          <span className="eir-q-index-arrow">→</span>
          <span className="eir-q-required">required</span>
        </div>
        <h2 className="eir-q-prompt">
          {warmCopy ? <>Let's start with the <em>easy</em> part.</> : "Upload your profile"}
        </h2>
        <p className="eir-q-help">
          Drop in your CV, LinkedIn profile and GitHub and we'll auto-fill about
          30% of the application. You'll review everything before anything gets
          submitted.
        </p>
        <p className="eir-q-help eir-dim" style={{ marginTop: -16 }}>
          ↳ Tip: drop a clean, up-to-date PDF — no résumé layout tricks
          needed. We use it to pre-fill the basic info section.
        </p>

        <div
          className={`eir-filedrop eir-upload-drop ${drag ? "is-drag" : ""} ${cv ? "has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" hidden accept=".pdf" onChange={(e) => handleFile(e.target.files[0])} />
          {!cv ? (
            <>
              <div className="eir-filedrop-icon">
                <svg width="40" height="40" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <rect x="6" y="4" width="20" height="24" />
                  <path d="M6 10 H26 M6 16 H26 M6 22 H26" strokeDasharray="2 3" opacity="0.4" />
                  <path d="M16 12 V24 M10 18 L16 12 L22 18" />
                </svg>
              </div>
              <div className="eir-filedrop-main">Drop your CV here, or <u>click to browse</u></div>
              <div className="eir-filedrop-meta eir-mono">pdf only · max 5mb · required</div>
            </>
          ) : (
            <>
              <div className="eir-file-chip">
                <span className="eir-mono eir-file-ok">✓ received</span>
                <span className="eir-file-name">{cv.name}</span>
                <span className="eir-mono eir-dim">{Math.round(cv.size / 1024)} KB</span>
              </div>
              <button className="eir-file-clear eir-mono" onClick={(e) => { e.stopPropagation(); setCv(null); }}>replace ↺</button>
            </>
          )}
        </div>

        <div className="eir-links eir-upload-links">
          <div className="eir-link-row">
            <label className="eir-link-label eir-mono">
              linkedin <span className="eir-dim">· optional</span>
            </label>
            <input type="url" className="eir-input eir-input-inline" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/yourname" />
          </div>
          <div className="eir-link-row">
            <label className="eir-link-label eir-mono">
              github <span className="eir-dim">· optional</span>
            </label>
            <input type="url" className="eir-input eir-input-inline" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="github.com/yourname" />
          </div>
        </div>

        <div className="eir-q-actions">
          <button className={`eir-btn ${cv ? "eir-btn-primary" : "eir-btn-disabled"}`} onClick={submit} disabled={!cv}>
            <span>Parse my profile</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
          <span className="eir-mono eir-dim">we'll extract ~12 fields</span>
        </div>
      </div>
    </div>
  );
}

function ParsingScreen({ onDone, uploaded }) {
  const [step, setStep] = useAS(0);
  const steps = [
    { label: "reading document", sub: uploaded.cv?.name || "cv.pdf" },
    { label: "extracting experience", sub: "positions, employers, dates" },
    { label: "extracting education", sub: "degrees, institutions" },
    { label: "extracting skills", sub: "technical keywords" },
    { label: "cross-referencing", sub: uploaded.linkedin ? "linkedin profile" : "skipping linkedin" },
    { label: "cross-referencing", sub: uploaded.github ? "github activity" : "skipping github" },
    { label: "confidence scoring", sub: "flagging low-confidence fields" },
    { label: "done", sub: "12 fields populated" },
  ];

  // Animate the visual ladder of steps. Pause at the last step instead of
  // calling onDone — the parent (App.jsx) is responsible for advancing
  // phase only once the backend's parse_status is actually 'completed' or
  // 'failed'. Otherwise the wizard could move to PARSE_REVIEW before the
  // new resume has finished parsing, in which case `resume.resume` still
  // holds the *previous* session's CV and ParsedReviewScreen displays
  // stale data.
  useAE(() => {
    if (step >= steps.length - 1) return undefined;
    const t = setTimeout(() => setStep((s) => s + 1), 520);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="eir-screen eir-parsing">
      <div className="eir-coord eir-mono">
        <span>01 · Professional Profile</span>
        <span>parsing</span>
      </div>
      <div className="eir-parsing-body">
        <div className="eir-parsing-title eir-mono">
          <span className="eir-dot-live" /> parser active
        </div>
        <h2 className="eir-q-prompt">Reading your profile…</h2>
        <p className="eir-q-help">This takes about 10 seconds. We'll highlight anything that needs your review.</p>

        <div className="eir-parsing-steps">
          {steps.map((s, i) => {
            const state = i < step ? "done" : i === step ? "active" : "pending";
            return (
              <div key={i} className={`eir-parsing-step is-${state}`}>
                <span className="eir-parsing-step-mark eir-mono">
                  {state === "done" ? "✓" : state === "active" ? "◐" : "·"}
                </span>
                <span className="eir-parsing-step-label">{s.label}</span>
                <span className="eir-mono eir-dim eir-parsing-step-sub">{s.sub}</span>
              </div>
            );
          })}
        </div>

        <div className="eir-parsing-bar">
          <div className="eir-pb-bar-track">
            <div className="eir-pb-bar-fill" style={{ width: `${Math.min(100, (step / steps.length) * 100)}%` }} />
          </div>
          <div className="eir-pb-meta eir-mono">
            <span>{Math.min(steps.length, step + 1).toString().padStart(2, "0")} / {steps.length.toString().padStart(2, "0")}</span>
            <span className="eir-dim">processing…</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParsedReviewScreen({ parsed, onContinue, warmCopy, userEmail }) {
  const [fields, setFields] = useAS(parsed);
  const update = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  // Count how many actually came back from the LLM so we can show a real
  // "N fields populated" number rather than a stale hard-coded 12.
  const populatedCount = (parsed._order || []).filter((k) => {
    const v = parsed[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  }).length;

  return (
    <div className="eir-screen eir-review">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>review · {populatedCount} fields populated</span>
      </div>
      <div className="eir-review-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-arrow">→</span>
          <span className="eir-q-optional">review</span>
        </div>
        <h2 className="eir-q-prompt">
          {warmCopy ? <>Here's what we <em>found</em>. Edit anything that's off.</> : "Review parsed fields"}
        </h2>
        <p className="eir-q-help">
          Fields marked <span className="eir-pill eir-pill-auto">auto</span> came from your CV. Low-confidence extractions are flagged in <span className="eir-pill eir-pill-warn">review</span>.
        </p>

        <div className="eir-review-fields">
          {parsed._order.map((key) => {
            const meta = parsed._meta[key];
            return (
              <div key={key} className={`eir-review-field conf-${meta.confidence}`}>
                <div className="eir-review-field-head">
                  <label className="eir-mono eir-link-label">{meta.label}</label>
                  <span className={`eir-pill ${meta.confidence === "high" ? "eir-pill-auto" : "eir-pill-warn"}`}>
                    {meta.confidence === "high" ? "auto" : "review"}
                  </span>
                </div>
                <input
                  type="text"
                  className="eir-input eir-input-inline"
                  value={fields[key] || ""}
                  onChange={(e) => update(key, e.target.value)}
                />
              </div>
            );
          })}
        </div>

        <div className="eir-q-actions">
          <button className="eir-btn eir-btn-primary" onClick={() => onContinue(fields)}>
            <span>Looks good — continue</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Generate simulated parsed data from the user's email
function simulateParse(userEmail) {
  const local = (userEmail || "you@domain.com").split("@")[0];
  const nameGuess = local.split(/[._-]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || "Arun Kumar";
  return {
    fullName: nameGuess,
    email: userEmail || "",
    phone: "+91 98765 43210",
    org: "IISc Bangalore",
    degree: "PhD",
    _meta: {
      fullName: { label: "full name", confidence: "high" },
      email: { label: "email", confidence: "high" },
      phone: { label: "phone number", confidence: "low" },
      org: { label: "current organization", confidence: "high" },
      degree: { label: "highest degree", confidence: "low" },
    },
    _order: ["fullName", "email", "phone", "org", "degree"],
  };
}

// ── Offline-template upload step ──────────────────────────────────────────
// Sits between section 01 (Basic Details) and section 02 (Problem) in the
// wizard. The applicant either downloads the .docx, fills Q9–Q19 offline,
// uploads the filled file, and continues — or skips this step entirely
// and types in the wizard. Skipping is the default so we don't gate the
// section flow on an optional file.
function TemplateScreen({ onContinue, onBack, onTemplateApplied }) {
  const tplInputRef = useAR(null);
  const [tplDrag, setTplDrag] = useAS(false);
  const [tplToast, setTplToast] = useAS(null);

  const tpl = useTemplate({
    onApplied: (result) => {
      const filled = (result?.applied_fields || []).length;
      const skipped = (result?.skipped_fields || []).length;
      const missing = (result?.missing_answers || []).length;
      const parts = [`Pre-filled ${filled} field${filled === 1 ? "" : "s"}`];
      if (skipped) parts.push(`${skipped} kept (you'd already typed them)`);
      if (missing) parts.push(`${missing} couldn't be read — fill them in the wizard`);
      setTplToast(parts.join(" · "));
      // Tell the parent to refetch the application so the wizard's
      // local answers map picks up the just-applied values.
      if (onTemplateApplied) {
        try { onTemplateApplied(result); } catch { /* swallow */ }
      }
    },
  });

  const handleTplFile = (file) => {
    if (!file) return;
    setTplToast(null);
    tpl.upload(file).catch(() => { /* error surfaces via tpl.error */ });
  };

  const tplStatus = tpl.template?.parse_status;
  const tplBusy = tpl.uploading || tpl.parsing || tpl.applying;
  const continueLabel = tplStatus === "completed" ? "Continue" : "Skip — I'll type in the wizard";

  return (
    <div className="eir-screen eir-template-screen">
      <div className="eir-coord eir-mono">
        <span>between 01 and 02</span>
        <span>offline template · optional</span>
      </div>
      <div className="eir-template-screen-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">↳</span>
          <span className="eir-q-index-arrow">→</span>
          <span className="eir-q-optional">optional</span>
        </div>
        <h2 className="eir-q-prompt">Want to type the long answers offline?</h2>
        <p className="eir-q-help">
          Download the Word template, fill questions 9–19 at your own pace
          (Word, Pages, Google Docs — anything that opens .docx), then
          drop it back here and we'll auto-fill those fields in the wizard.
          You'll still review and edit each answer before submitting.
        </p>
        <p className="eir-q-help eir-dim" style={{ marginTop: -16 }}>
          ↳ Skip this step entirely if you'd rather type your answers
          directly in the next sections.
        </p>

        <div className="eir-template-block eir-template-block-screen">
          <div className="eir-template-row">
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 1 · download</div>
              <div className="eir-template-blurb">
                Grab the .docx. The questions inside have answer markers we
                use to read your responses — please don't delete or rename
                them.
              </div>
            </div>
            <a
              className="eir-btn eir-btn-ghost eir-template-dl"
              href={TEMPLATE_DOWNLOAD_URL}
              download
            >
              <span>Download template (.docx)</span>
              <span className="eir-mono">↓</span>
            </a>
          </div>

          <div className="eir-template-row" style={{ marginBottom: 0 }}>
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 2 · upload filled</div>
              <div className="eir-template-blurb">
                Once you've filled it, drop the same file back here. We'll
                read your answers and pre-populate Q9–Q19.
              </div>
            </div>
          </div>

          <div
            className={`eir-filedrop eir-template-drop ${tplDrag ? "is-drag" : ""} ${tplStatus === "completed" ? "has-file" : ""} ${tplBusy ? "is-disabled" : ""}`}
            onDragOver={(e) => { if (tplBusy) return; e.preventDefault(); setTplDrag(true); }}
            onDragLeave={() => setTplDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setTplDrag(false);
              if (!tplBusy) handleTplFile(e.dataTransfer.files[0]);
            }}
            onClick={() => { if (!tplBusy) tplInputRef.current?.click(); }}
            style={tplBusy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            <input
              ref={tplInputRef}
              type="file"
              hidden
              accept=".docx,.pdf"
              onChange={(e) => handleTplFile(e.target.files[0])}
              disabled={tplBusy}
            />
            {tpl.uploading && (
              <div className="eir-filedrop-main">Uploading filled template…</div>
            )}
            {!tpl.uploading && tpl.parsing && (
              <div className="eir-filedrop-main">Reading your answers…</div>
            )}
            {!tpl.uploading && !tpl.parsing && tpl.applying && (
              <div className="eir-filedrop-main">Pre-filling the wizard…</div>
            )}
            {!tplBusy && tplStatus !== "completed" && (
              <>
                <div className="eir-filedrop-main">
                  Drop your filled template here, or <u>click to browse</u>
                </div>
                <div className="eir-filedrop-meta eir-mono">.docx (preferred) or .pdf · max 10 MiB</div>
              </>
            )}
            {!tplBusy && tplStatus === "completed" && (
              <div className="eir-file-chip">
                <span className="eir-mono eir-file-ok">✓ parsed</span>
                <span className="eir-file-name">{tpl.template?.original_filename || "template"}</span>
                <span className="eir-mono eir-dim">replace ↺</span>
              </div>
            )}
          </div>

          {tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.error?.message || "We couldn't read that template — make sure the answer markers are intact and try again."}
            </div>
          )}
          {tplStatus === "failed" && !tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.template?.parse_error || "Parse failed."} You can still
              continue — the wizard works manually.
            </div>
          )}
          {tplToast && (
            <div className="eir-mono eir-template-ok">↳ {tplToast}</div>
          )}
        </div>

        <div className="eir-q-actions">
          {onBack && (
            <button type="button" className="eir-btn eir-btn-ghost" onClick={onBack}>
              <span>← Back</span>
            </button>
          )}
          <button
            type="button"
            className={`eir-btn ${tplBusy ? "eir-btn-disabled" : "eir-btn-primary"}`}
            onClick={onContinue}
            disabled={tplBusy}
          >
            <span>{continueLabel}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export {
  AuthScreen, ReturningChoiceScreen, UploadScreen, ParsingScreen, ParsedReviewScreen,
  TemplateScreen,
  simulateParse, MILESTONES, TERMINAL_OUTCOMES, getSubmissionProgress, getStatusLabel,
};
