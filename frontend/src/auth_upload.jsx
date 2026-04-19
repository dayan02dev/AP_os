// Auth (register/login) + CV upload + parsing animation screens

import { useState as useAS, useEffect as useAE, useRef as useAR } from "react";
import { validateEmail, isPasswordValid, EmailInput, PasswordInput } from "./validators.jsx";

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
function ReturningChoiceScreen({ user, hasDraft, draftProgress, pastSubmissions, onResume, onViewPast, onStartNew, warmCopy }) {
  // Pick a sensible default tab: if draft exists, show Continue; else if past subs, show Past; else Start
  const defaultTab = hasDraft ? "continue" : (pastSubmissions.length > 0 ? "past" : "start");
  const [tab, setTab] = useAS(defaultTab);

  return (
    <div className="eir-screen eir-returning">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>signed in · {user.email}</span>
      </div>
      <div className="eir-auth-body">
        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> welcome back
        </div>
        <h1 className="eir-welcome-title">
          {warmCopy ? <>Good to see you, <em>{user.email.split("@")[0]}</em>.</> : "What would you like to do?"}
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
                <h2 className="eir-tabs-panel-title">Start a new application</h2>
                <p className="eir-tabs-panel-sub">
                  Fresh blank slate — est. 45–60 minutes. You can save progress anytime and come back.
                  {hasDraft && " Starting new will clear your current in-progress draft."}
                </p>
              </div>
              <div className="eir-ret-list">
                <button className="eir-ret-card eir-ret-card-primary" onClick={onStartNew}>
                  <div className="eir-ret-card-head">
                    <span className="eir-mono eir-ret-card-eyebrow">begin · tir.2026</span>
                  </div>
                  <div className="eir-ret-card-title">Begin TIR.2026 application</div>
                  <div className="eir-mono eir-dim eir-ret-card-meta">
                    ↳ {hasDraft ? "your current draft will be cleared" : "your answers save automatically as you go"}
                  </div>
                </button>
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
                              <React.Fragment key={m.key}>
                                <span
                                  className={`eir-ret-pipe-dot ${reached ? "is-reached" : ""} ${isCurrent ? "is-current" : ""} ${progress.isTerminal && mi === progress.currentIdx ? "is-terminal" : ""}`}
                                  title={m.label}
                                />
                                {mi < MILESTONES.length - 1 && (
                                  <span className={`eir-ret-pipe-line ${mi < progress.currentIdx ? "is-reached" : ""}`} />
                                )}
                              </React.Fragment>
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

  const handleFile = (f) => { if (f) setCv({ name: f.name, size: f.size }); };

  const submit = () => { if (cv) onUploaded({ cv, linkedin, github }); };

  return (
    <div className="eir-screen eir-upload">
      <div className="eir-coord eir-mono">
        <span>§ 01 · Professional Profile</span>
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
          Drop in your CV and we'll auto-fill about 60% of the application. You'll review everything before anything gets submitted.
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

  useAE(() => {
    if (step >= steps.length) { onDone(); return; }
    const t = setTimeout(() => setStep((s) => s + 1), step === steps.length - 1 ? 700 : 520);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="eir-screen eir-parsing">
      <div className="eir-coord eir-mono">
        <span>§ 01 · Professional Profile</span>
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

  return (
    <div className="eir-screen eir-review">
      <div className="eir-coord eir-mono">
        <span>§ 01 · Professional Profile</span>
        <span>review · 12 fields populated</span>
      </div>
      <div className="eir-review-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">02</span>
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

export { AuthScreen, ReturningChoiceScreen, UploadScreen, ParsingScreen, ParsedReviewScreen, simulateParse, MILESTONES, TERMINAL_OUTCOMES, getSubmissionProgress, getStatusLabel };
