// Auth (register/login) + CV upload + parsing animation screens

import { Fragment, useState as useAS, useEffect as useAE, useRef as useAR } from "react";
import { useNavigate } from "react-router-dom";
import { validateEmail, isPasswordValid, EmailInput, PasswordInput } from "./validators.jsx";
import { useTemplate } from "./hooks/useTemplate.js";
import { setMyTrack } from "./lib/auth.js";
import { formatRefId } from "./lib/refId.js";

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
// Canonical 6-stage milestone pipeline. Order matters — the pipeline UI
// renders these in sequence and "reached" is computed as index <= current.
const MILESTONES = [
  { key: "submitted",    label: "Application",      short: "Application",      desc: "Form submitted and in the queue." },
  { key: "under_review", label: "Under review",     short: "Under review",     desc: "Cohort committee reading and discussing." },
  { key: "profile",      label: "Profile building", short: "Profile building", desc: "Psychometry + references requested from you." },
  { key: "jury",         label: "Jury evaluation",  short: "Jury evaluation",  desc: "Independent jury reviews shortlisted profiles." },
  { key: "interview",    label: "Interviews",       short: "Interviews",       desc: "Panel interview with ARTPARK + industry leads." },
  { key: "onboarding",   label: "Final onboarding", short: "Onboarding",       desc: "Outcome communicated and onboarding logistics sent." },
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

// Sidebar links for the "Cohort" group. In dev these resolve to the
// static HTML pages in /public; in prod the vercel.json rewrites map them
// to clean URLs (/, /tir, /sip). Opening in a new tab matches the
// standalone HTML design where these are sibling marketing pages.
// Rich dashboard shown when the applicant has a SUBMITTED application
// in the current cycle. Renders:
//   - "2026 Innovation Application" card with overall progress bar
//   - Left column: APPLICATION INFORMATION + project title + expandable
//     summary blocks (What you're building, Why this matters, Team &
//     background, Stage & evidence) + "View full application →"
//   - Right column: APPLICATION PROGRESS pipeline (all 6 stages, with the
//     current one highlighted). CURRENT STATUS / Start-psychometry block
//     is intentionally NOT rendered — that appears later in the flow
//     (once shortlisted), and showing it pre-shortlist sets the wrong
//     expectation. Per-stage task cards are also withheld for the same
//     reason: a freshly-submitted applicant should not see the
//     psychometry / references tasks.
// Stages at which the CURRENT STATUS box (and matching per-stage CTA)
// becomes relevant. Pre-`profile` is just "we're reading it" — no action
// for the applicant — so we suppress the box entirely to keep the
// dashboard quiet.
const ACTIVE_STAGES = ["profile", "jury", "interview", "onboarding"];

// Per-stage CTA shown on the statbox. Click handler is a no-op stub for
// now (action wiring happens once the corresponding flows exist).
const STAGE_CTAS = {
  profile:    { label: "Start psychometry →",   handler: "psychometry" },
  jury:       null,
  interview:  { label: "View interview details →", handler: "interview" },
  onboarding: { label: "Open onboarding pack →",   handler: "onboarding" },
};

// Per-stage task cards shown inside the expanded current pipeline step.
// Only the `profile` stage is fully wired for now (the others have empty
// arrays — the dashboard simply omits the section).
const STAGE_TASKS = {
  profile: [
    { kind: "due", due: "12 May", title: "Korn Ferry Psychometry",
      meta: "~50 min · single attempt · proctored",
      action: "Begin", priority: true },
    { kind: "due", due: "15 May", title: "Submit 2 references",
      meta: "Academic + industry · we email them directly",
      action: "Add" },
    { kind: "upcoming", title: "Pitch interview (if shortlisted)",
      meta: "Scheduled in week of 25 May" },
  ],
  jury: [],
  interview: [],
  onboarding: [],
};

function SubmittedDashboard({ sub, displayName, onViewFull, justSubmitted, track = "tir" }) {
  const [open, setOpen] = useAS(null);
  const toggle = (id) => setOpen(open === id ? null : id);

  const progress = getSubmissionProgress(sub);
  const statusLabel = getStatusLabel(sub);
  const MS = MILESTONES;
  const completionPct = progress.isTerminal
    ? 100
    : Math.round(((progress.currentIdx + 1) / MS.length) * 100);

  // The applicant has been "accepted into the next round" when their
  // current_milestone reaches `profile` (or anything downstream). This is
  // the trigger to show the statbox + per-stage task cards. Backend devs
  // flip this column to move an applicant forward.
  const currentKey = sub.currentMilestone || MS[progress.currentIdx]?.key;
  const isActiveStage = ACTIVE_STAGES.includes(currentKey);
  const stageCta = STAGE_CTAS[currentKey] || null;
  const stageTasks = STAGE_TASKS[currentKey] || [];

  // Status pill tone (drives the colour of the CURRENT STATUS chip).
  const toneClass = progress.isTerminal
    ? `eir-ret-status-${progress.outcomeKey}`
    : `eir-ret-status-${currentKey}`;

  const A = sub.answers || {};
  const idTag = formatRefId(sub.id, track);
  const projectTitle =
    sub.projectTitle ||
    (A.solutionDescribe || A.problemDescribe || "").slice(0, 80) ||
    "Your application";
  const submittedDate = new Date(sub.ts || sub.submittedAt || Date.now())
    .toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const lastUpdate = new Date(sub.lastUpdate || sub.ts || Date.now())
    .toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  // The four expandable summary blocks. Each pulls from the collapsed
  // answers object the parent (App.jsx) passes in — falls back to a
  // generic placeholder when the field is empty (e.g. SIP cross-track
  // rows where answers={}).
  const summaryBlocks = [
    {
      id: "what",
      label: "What you're building",
      value: A.solutionDescribe || A.problemDescribe || "Details available in the full application.",
    },
    {
      id: "why",
      label: "Why this matters",
      value: A.problemImportance || A.importance || "Details available in the full application.",
    },
    {
      id: "team",
      label: "Team & background",
      value: [A.fullName, A.org].filter(Boolean).join(" · ") || "Details available in the full application.",
    },
    {
      id: "trl",
      label: "Stage & evidence",
      value: A.stage || "Details available in the full application.",
    },
  ];

  return (
    <div className="eir-os-view">
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Dashboard</div>
        <h1 className="eir-os-view-title">
          {justSubmitted
            ? <>Application submitted, <em>{displayName}</em></>
            : <>Welcome back, <em>{displayName}</em></>}
        </h1>
        <p className="eir-os-view-sub">
          {justSubmitted
            ? <>Thank you — we have received your application. Our team reads every one and will be in touch by the agreed deadline.</>
            : <>Your 2026 application is being evaluated. Below: where you stand and what we know so far.</>}
        </p>
      </header>

      {justSubmitted && (
        <div className="eir-dash-justsub" role="status">
          <div className="eir-dash-justsub-mark">✓</div>
          <div className="eir-dash-justsub-body">
            <div className="eir-mono eir-dash-justsub-eyebrow">Submitted just now</div>
            <div className="eir-dash-justsub-text">
              Reference <strong>{idTag}</strong> — you will get an email confirmation shortly.
            </div>
          </div>
        </div>
      )}

      <section className="eir-dash-app2026">
        <header className="eir-dash-app2026-head">
          <div>
            <div className="eir-mono eir-dim eir-dash-app2026-eyebrow">Current application</div>
            <h2 className="eir-dash-app2026-title">2026 Innovation Application</h2>
          </div>
          <div className="eir-dash-app2026-pct">
            <span className="eir-dash-app2026-pct-val">{completionPct}%</span>
            <span className="eir-mono eir-dim eir-dash-app2026-pct-label">through review</span>
          </div>
        </header>
        <div className="eir-dash-app2026-bar">
          <div className="eir-dash-app2026-bar-fill" style={{ width: `${completionPct}%` }} />
        </div>
        <div className="eir-mono eir-dim eir-dash-app2026-bar-meta">
          {progress.isTerminal
            ? <>Process complete — outcome communicated.</>
            : <>Stage {progress.currentIdx + 1} of {MS.length} · {MS[progress.currentIdx]?.label}</>}
        </div>

        <div className="eir-dash-app2026-grid">
          {/* LEFT — application information */}
          <div className="eir-dash-app2026-left">
            <header className="eir-dash-card-head">
              <span className="eir-mono eir-dash-card-eyebrow">Application information</span>
              <span className="eir-mono eir-dim eir-dash-app-id">{idTag}</span>
            </header>
            <h3 className="eir-dash-app-title">{projectTitle}</h3>
            <div className="eir-dash-app-meta">
              <div>
                <div className="eir-mono eir-dim eir-dash-app-meta-label">Stage</div>
                <div className="eir-dash-app-meta-val">{statusLabel}</div>
              </div>
              <div>
                <div className="eir-mono eir-dim eir-dash-app-meta-label">Submitted</div>
                <div className="eir-dash-app-meta-val">{submittedDate}</div>
              </div>
            </div>

            <ul className="eir-dash-app-blocks">
              {summaryBlocks.map((b) => (
                <li
                  key={b.id}
                  className={`eir-dash-app-block ${open === b.id ? "is-open" : ""}`}
                >
                  <button
                    type="button"
                    className="eir-dash-app-block-head"
                    onClick={() => toggle(b.id)}
                    aria-expanded={open === b.id}
                  >
                    <span className="eir-mono eir-dim eir-dash-app-block-label">{b.label}</span>
                    <span className="eir-mono eir-dim eir-dash-app-block-toggle">
                      {open === b.id ? "−" : "+"}
                    </span>
                  </button>
                  <div className="eir-dash-app-block-body">{b.value}</div>
                </li>
              ))}
            </ul>

            <div className="eir-dash-app-actions">
              <button
                type="button"
                className="eir-dash-btn"
                onClick={() => onViewFull(sub)}
              >
                View full application →
              </button>
            </div>
          </div>

          {/* RIGHT — APPLICATION PROGRESS, plus a conditional CURRENT STATUS
              box that surfaces once the applicant has been moved past
              `under_review` (backend sets current_milestone = 'profile'
              or later). Pre-profile the box is suppressed so the dashboard
              stays quiet while reviewers are still reading. */}
          <div className="eir-dash-app2026-right">
            {isActiveStage && (
              <div className="eir-dash-statbox">
                <div className="eir-mono eir-dash-card-eyebrow">Current status</div>
                <div className={`eir-dash-statbox-val eir-ret-status ${toneClass}`}>
                  {statusLabel}
                </div>
                <div className="eir-mono eir-dim eir-dash-statbox-meta">
                  Last update {lastUpdate}
                </div>
                {stageCta && (
                  <button
                    type="button"
                    className="eir-dash-statbox-cta"
                    onClick={() => onViewFull(sub)}
                  >
                    {stageCta.label}
                  </button>
                )}
              </div>
            )}

            <div className="eir-dash-pipebox">
              <header className="eir-dash-card-head">
                <span className="eir-mono eir-dash-card-eyebrow">Application progress</span>
                <span className="eir-mono eir-dim">{progress.currentIdx + 1} / {MS.length}</span>
              </header>
              <ol className="eir-dash-pipeline">
                {MS.map((m, mi) => {
                  const reached = mi < progress.currentIdx;
                  const isCurrent = !progress.isTerminal && mi === progress.currentIdx;
                  const cls = isCurrent ? "is-current" : reached ? "is-reached" : "is-upcoming";
                  return (
                    <li key={m.key} className={`eir-dash-pipe-step ${cls}`}>
                      <span className="eir-dash-pipe-node">
                        <span className="eir-dash-pipe-dot" />
                        {mi < MS.length - 1 && <span className="eir-dash-pipe-line" />}
                      </span>
                      <div>
                        <div className="eir-dash-pipe-label">
                          <span className="eir-mono eir-dash-pipe-num">{String(mi + 1).padStart(2, "0")}</span>
                          <span>{m.short}</span>
                        </div>
                        {isCurrent && (
                          <div className="eir-dash-pipe-desc">{m.desc}</div>
                        )}
                        {/* Task cards (Korn Ferry / references / pitch) only
                            appear inside the CURRENT stage and only when
                            that stage has tasks defined — today, only
                            `profile`. Other stages render the bare label. */}
                        {isCurrent && stageTasks.length > 0 && (
                          <ul className="eir-dash-upnext-list">
                            {stageTasks.map((t, i) => (
                              <li
                                key={i}
                                className={`eir-dash-task ${t.priority ? "is-priority" : ""} ${t.kind === "upcoming" ? "is-upcoming" : ""}`}
                              >
                                <div>
                                  {t.kind === "due" && (
                                    <span className="eir-mono eir-dash-task-due">DUE {t.due}</span>
                                  )}
                                  {t.kind === "upcoming" && (
                                    <span className="eir-mono eir-dim eir-dash-task-upcoming">UPCOMING</span>
                                  )}
                                  {t.kind === "info" && (
                                    <span className="eir-mono eir-dim eir-dash-task-info">INFO</span>
                                  )}
                                </div>
                                <div>
                                  <div className="eir-dash-task-title">{t.title}</div>
                                  <div className="eir-mono eir-dim eir-dash-task-meta">{t.meta}</div>
                                </div>
                                {t.action && (
                                  <button type="button" className="eir-dash-task-action">
                                    {t.action}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {sub.feedback && (
        <section className="eir-dash-feedback">
          <div className="eir-mono eir-dim eir-dash-feedback-label">↳ reviewer note</div>
          <p className="eir-dash-feedback-body">{sub.feedback}</p>
        </section>
      )}
    </div>
  );
}

const COHORT_LINKS = {
  programs: { href: "/programs.html", label: "Programs" },
  tir:      { href: "/marketing.html", label: "TIR overview" },
  sip:      { href: "/sip-marketing.html", label: "VIP overview" },
};

// Sidebar — Application + Cohort nav groups. Shared by Current / Past views.
function OsSidebar({ view, onView, hasDraft, draftPct, pastCount }) {
  return (
    <aside className="eir-os-side">
      <nav className="eir-os-side-group">
        <div className="eir-mono eir-os-side-title">Application</div>
        <button
          type="button"
          className={`eir-os-nav ${view === "current" ? "is-on" : ""}`}
          onClick={() => onView("current")}
        >
          <span className="eir-os-nav-label">Current</span>
          {hasDraft && (
            <span className="eir-mono eir-os-nav-pct">{draftPct}%</span>
          )}
        </button>
        <button
          type="button"
          className={`eir-os-nav ${view === "past" ? "is-on" : ""}`}
          onClick={() => onView("past")}
        >
          <span className="eir-os-nav-label">Past applications</span>
          {pastCount > 0 && (
            <span className="eir-mono eir-os-nav-badge">{pastCount}</span>
          )}
        </button>
      </nav>

      <nav className="eir-os-side-group">
        <div className="eir-mono eir-os-side-title">Cohort</div>
        <a
          className="eir-os-nav eir-os-nav-link"
          href={COHORT_LINKS.programs.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="eir-mono eir-os-nav-num">↗</span>
          <span className="eir-os-nav-label">{COHORT_LINKS.programs.label}</span>
        </a>
        <a
          className="eir-os-nav eir-os-nav-link"
          href={COHORT_LINKS.tir.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="eir-mono eir-os-nav-num">↗</span>
          <span className="eir-os-nav-label">{COHORT_LINKS.tir.label}</span>
        </a>
        <a
          className="eir-os-nav eir-os-nav-link"
          href={COHORT_LINKS.sip.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="eir-mono eir-os-nav-num">↗</span>
          <span className="eir-os-nav-label">{COHORT_LINKS.sip.label}</span>
        </a>
      </nav>

      <div className="eir-os-side-foot">
        <div className="eir-mono eir-dim">↳ data encrypted at rest</div>
        <div className="eir-mono eir-dim">↳ progress autosaves</div>
      </div>
    </aside>
  );
}

// Right-pane content when "Current" tab is selected. Three states:
//   draft in progress → banner + Continue / Review cards
//   no draft, no submitted current-cycle → track-picker cards
//   submitted to current cycle → fall back to draft view (rich dashboard
//     port is out of scope for this MVP; the existing /apply/submitted
//     receipt is reachable via the Past list).
function CurrentPane({
  displayName, hasDraft, draftPct, currentSub, onResume, onStartNew,
  onGoPast, onViewFull, pastCount, track, justSubmitted,
}) {
  const navigate = useNavigate();

  // State: a submission already exists in the current cycle. Takes priority
  // over the draft and not-started views — once you have submitted, the
  // dashboard is the right landing.
  if (currentSub) {
    return (
      <SubmittedDashboard
        sub={currentSub}
        displayName={displayName}
        onViewFull={onViewFull}
        justSubmitted={justSubmitted}
        track={track}
      />
    );
  }

  // State A — draft in progress
  if (hasDraft) {
    return (
      <div className="eir-os-view">
        <header className="eir-os-view-head">
          <div className="eir-mono eir-dim eir-os-crumb">Current · Draft</div>
          <h1 className="eir-os-view-title">Welcome back, <em>{displayName}</em></h1>
          <p className="eir-os-view-sub">
            Your 2026 application is <strong>{draftPct}% complete</strong>. Pick up exactly where you stopped — every answer is saved.
          </p>
        </header>

        <div className="eir-os-banner eir-os-banner-draft">
          <div className="eir-os-banner-body">
            <div className="eir-mono eir-os-banner-eyebrow">in progress</div>
            <div className="eir-os-banner-title">{draftPct}% through your application</div>
            <div className="eir-os-banner-bar">
              <div className="eir-os-banner-bar-fill" style={{ width: `${draftPct}%` }} />
            </div>
          </div>
          <div className="eir-os-banner-actions">
            <button className="eir-os-cta eir-os-cta-primary" onClick={onResume}>
              Resume →
            </button>
          </div>
        </div>

        <div className="eir-os-card-row">
          <button className="eir-os-card eir-os-card-clickable" onClick={onResume}>
            <div className="eir-mono eir-os-card-eyebrow">option · resume</div>
            <div className="eir-os-card-title">Continue where you left off</div>
            <p className="eir-os-card-blurb">Jump back into the form at your next unanswered question.</p>
            <div className="eir-mono eir-os-card-arrow">→</div>
          </button>
          <button className="eir-os-card eir-os-card-clickable" onClick={onResume}>
            <div className="eir-mono eir-os-card-eyebrow">option · review</div>
            <div className="eir-os-card-title">Review what you have so far</div>
            <p className="eir-os-card-blurb">Walk through your answers section-by-section, no edits forced.</p>
            <div className="eir-mono eir-os-card-arrow">→</div>
          </button>
        </div>

        {pastCount > 0 && (
          <button className="eir-os-footnote" onClick={onGoPast}>
            <span className="eir-mono">↳</span>
            <span>You have <strong>{pastCount}</strong> past {pastCount === 1 ? "application" : "applications"} — view history</span>
            <span className="eir-mono eir-dim">→</span>
          </button>
        )}
      </div>
    );
  }

  // State B — not started. Show the TIR + VIP track picker.
  const pickTrack = async (chosen) => {
    try {
      await setMyTrack(chosen);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[chooser] setMyTrack failed; proceeding anyway", err);
    }
    if (chosen === track) {
      onStartNew();
    } else {
      navigate(chosen === "tir" ? "/apply?direct=1" : "/apply-sip?direct=1");
    }
  };

  return (
    <div className="eir-os-view">
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Current · Not started</div>
        <h1 className="eir-os-view-title">Welcome back, <em>{displayName}</em></h1>
        <p className="eir-os-view-sub">
          You have not started a 2026 application yet. Pick the track that fits where you are — your CV auto-fills the basics either way. Estimated time ~60–90 min.
        </p>
      </header>

      <div className="eir-os-track-grid">
        <button className="eir-os-track-card" data-track="tir" onClick={() => pickTrack("tir")}>
          <div className="eir-os-track-head">
            <span className="eir-mono eir-os-track-eyebrow">begin · tir.2026</span>
            <span className="eir-os-track-arrow">→</span>
          </div>
          <div className="eir-os-track-title">Technology Innovator in Residence</div>
          <p className="eir-os-track-blurb">
            For pre-incorporation researchers translating <em>lab-proven</em> work toward a defensible technology angle. TRL 3 and up.
          </p>
          <div className="eir-mono eir-dim eir-os-track-meta">↳ closes 22 may · ~60–90 min</div>
        </button>

        <button className="eir-os-track-card" data-track="sip" onClick={() => pickTrack("sip")}>
          <div className="eir-os-track-head">
            <span className="eir-mono eir-os-track-eyebrow">begin · vip.2026</span>
            <span className="eir-os-track-arrow">→</span>
          </div>
          <div className="eir-os-track-title">Venture Incubation Programme</div>
          <p className="eir-os-track-blurb">
            For incorporated Pvt Ltd ventures with a working prototype (TRL 4+) and early customer signal.
          </p>
          <div className="eir-mono eir-dim eir-os-track-meta">↳ closes 31 may · ~60–90 min</div>
        </button>
      </div>

      <div className="eir-os-note">
        <span className="eir-os-note-mark eir-mono">!</span>
        <span>
          You can <em>explore</em> both tracks, but only <strong>one application</strong> can be submitted per applicant — pick the track that fits where you are today.
        </span>
      </div>

      {pastCount > 0 && (
        <button className="eir-os-footnote" onClick={onGoPast}>
          <span className="eir-mono">↳</span>
          <span>You have <strong>{pastCount}</strong> past {pastCount === 1 ? "application" : "applications"} — view history</span>
          <span className="eir-mono eir-dim">→</span>
        </button>
      )}
    </div>
  );
}

// Right-pane content when "Past applications" tab is selected.
function PastPane({ displayName, pastSubmissions, onViewPast, onGoCurrent }) {
  if (pastSubmissions.length === 0) {
    return (
      <div className="eir-os-view">
        <header className="eir-os-view-head">
          <div className="eir-mono eir-dim eir-os-crumb">Past applications</div>
          <h1 className="eir-os-view-title">Nothing in your history yet, <em>{displayName}</em></h1>
          <p className="eir-os-view-sub">
            Once you submit an application, every cycle stays here with live status, reviewer notes, and final outcomes.
          </p>
        </header>

        <div className="eir-os-empty">
          <div className="eir-os-empty-icon eir-mono">∅</div>
          <p className="eir-os-empty-title">No past submissions</p>
          <p className="eir-os-empty-sub">
            When you submit your 2026 application, it will move here after the cycle closes.
          </p>
          <button className="eir-os-cta eir-os-cta-ghost" onClick={onGoCurrent}>
            ← back to current
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="eir-os-view">
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Past applications</div>
        <h1 className="eir-os-view-title">Your application history, <em>{displayName}</em></h1>
        <p className="eir-os-view-sub">
          {pastSubmissions.length} previous {pastSubmissions.length === 1 ? "submission" : "submissions"} — status, outcomes, and reviewer notes below.
        </p>
      </header>

      <div className="eir-os-past-list">
        {pastSubmissions.map((s, i) => {
          const progress = getSubmissionProgress(s);
          const statusLabel = getStatusLabel(s);
          const toneClass = progress.isTerminal
            ? `eir-ret-status-${progress.outcomeKey}`
            : `eir-ret-status-${(s.currentMilestone || "submitted")}`;
          const ref = formatRefId(
            s.id,
            (s.cycle || "").toUpperCase().includes("VIP") ? "sip" : "tir",
          );
          return (
            <button key={i} className="eir-os-past-card" onClick={() => onViewPast(s)}>
              <div className="eir-os-past-head">
                <div className="eir-os-past-head-left">
                  <span className="eir-mono eir-os-past-id">{ref}</span>
                  <span className="eir-mono eir-dim">·</span>
                  <span className="eir-mono eir-dim eir-os-past-cycle">{s.cycle || "TIR cohort"}</span>
                </div>
                <span className={`eir-ret-status eir-mono ${toneClass}`}>
                  {statusLabel.toUpperCase()}
                </span>
              </div>

              <div className="eir-os-past-title">
                {s.projectTitle || (s.answers?.problemStatement || "").slice(0, 90) || "Your application"}
                {!s.projectTitle && (s.answers?.problemStatement || "").length > 90 ? "…" : ""}
              </div>

              <div className="eir-ret-pipeline eir-os-past-pipeline">
                {MILESTONES.map((m, mi) => {
                  const reached = mi <= progress.currentIdx;
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

              <div className="eir-mono eir-dim eir-os-past-meta">
                ↳ submitted {new Date(s.ts).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                {s.feedback ? <> · reviewer note attached</> : null}
              </div>

              {s.feedback && (
                <div className="eir-os-past-feedback">
                  <span className="eir-mono eir-os-past-feedback-label">reviewer note</span>
                  <p className="eir-os-past-feedback-body">{s.feedback}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shown after login. Sidebar shell with two views: Current / Past applications.
function ReturningChoiceScreen({ user, applicantName, hasDraft, draftProgress, pastSubmissions, onResume, onViewPast, onStartNew, warmCopy: _warmCopy, track = "tir", justSubmitted = false }) {
  const [view, setView] = useAS("current");
  const draftPct = Math.round((draftProgress || 0) * 100);

  // Past lists every submitted application — we no longer filter by cycle
  // or track. The most-recent submission also drives the Current dashboard,
  // so the same row can appear in both views (Current = active tracker,
  // Past = historical record).
  const matchesTrack = (s) => {
    const c = (s?.cycle || "").toUpperCase();
    if (track === "sip") return c.includes("VIP") || c.includes("SIP");
    return c.includes("TIR");
  };
  // Pick the latest submission for this track as the dashboard's currentSub.
  // pastSubmissions is already sorted newest-first by App.jsx / AppSip.jsx.
  const currentSub = (pastSubmissions || []).find(matchesTrack);
  const trulyPast = pastSubmissions || [];

  // Display name from the draft (CV-parsed or typed in the wizard);
  // never from profiles.full_name (that field can be a stale CV name
  // from an earlier session). Fallback is the email local-part,
  // title-cased so "rohanss24" reads "Rohanss24".
  const displayName =
    applicantName?.trim() ||
    ((email) => email?.split("@")[0]?.replace(/^./, (c) => c.toUpperCase()))(user.email);

  return (
    <div className="eir-screen eir-os-shell">
      <div className="eir-os-body">
        <OsSidebar
          view={view}
          onView={setView}
          hasDraft={hasDraft && !currentSub}
          draftPct={draftPct}
          pastCount={trulyPast.length}
        />

        <main className="eir-os-pane">
          {view === "current" && (
            <CurrentPane
              displayName={displayName}
              hasDraft={hasDraft && !currentSub}
              draftPct={draftPct}
              currentSub={currentSub}
              onResume={onResume}
              onStartNew={onStartNew}
              onGoPast={() => setView("past")}
              onViewFull={onViewPast}
              pastCount={trulyPast.length}
              track={track}
              justSubmitted={justSubmitted}
            />
          )}
          {view === "past" && (
            <PastPane
              displayName={displayName}
              pastSubmissions={trulyPast}
              onViewPast={onViewPast}
              onGoCurrent={() => setView("current")}
            />
          )}
        </main>
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
