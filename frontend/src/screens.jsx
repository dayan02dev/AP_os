// Welcome, section intro, celebration, done screens + progress bar

import { useRef, useState, useEffect } from "react";

import { MILESTONES, getSubmissionProgress, getStatusLabel } from "./auth_upload.jsx";
import { QuestionInput } from "./inputs.jsx";
import { SipQuestionInput } from "./inputs_sip.jsx";
import { SECTIONS } from "./questions.jsx";
import { SECTIONS_SIP } from "./questions_sip.jsx";
import { ArrowLeft, Download } from "./components/icons.jsx";
import { formatRefId } from "./lib/refId.js";

// Render a stored answer value (string / array / file objects / declarations
// dict) into a human-readable string for the read-only submission view.
// Returns null when there's nothing to show so callers can render a placeholder.
function formatAnswerValue(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return v
      .map((e) =>
        e && typeof e === "object"
          ? e.name
            ? `${e.name}${e.share !== undefined ? ` (${e.share}%)` : ""}`
            : e.original_name || e.filename || String(e)
          : String(e),
      )
      .join(", ");
  }
  if (v && typeof v === "object" && v.name) return v.name;
  if (v && typeof v === "object") {
    const labels = {
      truthful: "Confirmed information is true",
      refChecks: "Consented to reference checks",
      terms: "Agreed to program terms & data policy",
      newsletter: "Opted in to newsletter",
    };
    const picked = Object.entries(v)
      .filter(([, val]) => val)
      .map(([k]) => labels[k] || k);
    return picked.length ? picked.join(" · ") : null;
  }
  return String(v);
}

function ProgressBar({ variant, progress, currentStep, totalSteps, sectionLabel, sectionIndex, totalSections, estMin }) {
  const pct = Math.round(progress * 100);

  if (variant === "section") {
    // Bare segment bar — section label and progress meta both removed
    // per design call: the section title is already prominent on the
    // intro screen the bar sits above, and the % / min-left counter
    // duplicated info that didn't earn the visual weight.
    return (
      <div className="eir-pb eir-pb-section">
        <div className="eir-pb-sections">
          {Array.from({ length: totalSections }).map((_, i) => (
            <div key={i} className={`eir-pb-seg ${i < sectionIndex ? "is-done" : i === sectionIndex ? "is-active" : ""}`}>
              <span className="eir-mono eir-pb-seg-label">{(i + 1).toString().padStart(2, "0")}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "ruler") {
    const ticks = 40;
    return (
      <div className="eir-pb eir-pb-ruler">
        <div className="eir-pb-ruler-track">
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const major = i % 5 === 0;
            const filled = i / ticks <= progress;
            return <span key={i} className={`eir-pb-tick ${major ? "major" : ""} ${filled ? "filled" : ""}`} />;
          })}
          <div className="eir-pb-ruler-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="eir-pb-meta eir-mono">
          <span>{pct.toString().padStart(3, "0")}%</span>
          <span className="eir-dim">q.{(currentStep + 1).toString().padStart(2, "0")}/{totalSteps.toString().padStart(2, "0")} · ~{estMin} min</span>
        </div>
      </div>
    );
  }

  if (variant === "dots") {
    return (
      <div className="eir-pb eir-pb-dots">
        <div className="eir-pb-dots-row">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span key={i} className={`eir-pb-dot ${i < currentStep ? "is-done" : i === currentStep ? "is-active" : ""}`} />
          ))}
        </div>
        <div className="eir-pb-meta eir-mono">
          <span>{(currentStep + 1).toString().padStart(2, "0")} / {totalSteps.toString().padStart(2, "0")}</span>
          <span className="eir-dim">~{estMin} min left</span>
        </div>
      </div>
    );
  }

  return (
    <div className="eir-pb eir-pb-bar">
      <div className="eir-pb-bar-track">
        <div className="eir-pb-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="eir-pb-meta eir-mono">
        <span>{sectionLabel}</span>
        <span className="eir-dim">{pct}% · {(currentStep + 1)}/{totalSteps} · ~{estMin} min</span>
      </div>
    </div>
  );
}

function WelcomeScreen({ onStart, warmCopy, track }) {
  const isSip = track === "sip";
  const cycle = isSip ? "VIP.2026" : "TIR.2026";
  const programLabel = isSip
    ? "venture incubation programme · applications open"
    : "technology innovator in residence · applications open";
  const formalTitle = isSip
    ? "Venture Incubation Programme — Application"
    : "Technology Innovator in Residence — Application";
  const formalLede = isSip
    ? "Intake questionnaire for the 2026 VIP cohort. 6 sections, auto-filled where possible. Plan for 90–120 minutes."
    : "Intake questionnaire for the 2026 TIR cohort. 6 sections, auto-filled where possible. Plan for 3–4 hours.";
  const warmLede = isSip
    ? "A short, honest conversation — not a form. We'll parse your CV to save you time, then walk through 6 sections covering your venture, the technology, and your traction. Plan for 90–120 minutes."
    : "A short, honest conversation — not a form. We'll start by parsing your CV to save you time, then walk through 6 sections together. Plan for 3–4 hours of focused work.";
  const duration = isSip ? "90–120 m" : "3–4 hrs";
  const deadline = isSip ? "31 may" : "22 may";
  return (
    <div className="eir-screen eir-welcome">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / {cycle}</span>
        <span>intake · rev 04</span>
      </div>
      <div className="eir-welcome-body">
        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> {programLabel}
        </div>
        <h1 className="eir-welcome-title">
          {warmCopy ? <>Let's get to know <em>you</em>.</> : formalTitle}
        </h1>
        <p className="eir-welcome-lede">{warmCopy ? warmLede : formalLede}</p>
        <div className="eir-welcome-meta">
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">duration</div><div className="eir-welcome-stat-val">{duration}</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">sections</div><div className="eir-welcome-stat-val">06</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">auto-fill</div><div className="eir-welcome-stat-val">from CV</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">deadline</div><div className="eir-welcome-stat-val">{deadline}</div></div>
        </div>
        <button className="eir-btn eir-btn-primary" onClick={onStart}>
          <span>Begin application</span><span className="eir-btn-key eir-mono">⏎</span>
        </button>
        <div className="eir-welcome-foot eir-mono eir-dim">press <kbd>Enter</kbd> to start · progress saves automatically</div>
      </div>
    </div>
  );
}

function SectionIntroScreen({ section, onContinue, onBack, totalSections = 6 }) {
  return (
    <div className="eir-screen eir-section-intro">
      <div className="eir-coord eir-mono">
        <span>section {section.index}</span>
        <span>of {String(totalSections).padStart(2, "0")}</span>
      </div>
      <div className="eir-section-intro-body">
        <div className="eir-section-intro-index">{section.index}</div>
        <h2 className="eir-section-intro-title">{section.label}</h2>
        <p className="eir-section-intro-blurb">{section.blurb}</p>
        <div className="eir-q-actions">
          {onBack && (
            <button type="button" className="eir-btn eir-btn-ghost" onClick={onBack}>
              <span>← Back</span>
            </button>
          )}
          <button className="eir-btn eir-btn-primary" onClick={onContinue}>
            <span>Continue</span><span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CelebrationScreen({ message, onContinue }) {
  return (
    <div className="eir-screen eir-celebrate">
      <div className="eir-celebrate-mark">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1" />
          <path d="M20 33 L28 41 L44 23" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
      <div className="eir-celebrate-label eir-mono">section complete</div>
      <h2 className="eir-celebrate-title">{message}</h2>
      <button className="eir-btn eir-btn-primary" onClick={onContinue}>
        <span>Continue</span><span className="eir-btn-key eir-mono">⏎</span>
      </button>
    </div>
  );
}

function DoneScreen({ answers, onRestart, submission, onBack, onDownload, questionPrompts, track = "tir", onSave }) {
  const name = (answers?.fullName || "").split(" ")[0] || "there";
  const isPast = !!submission;
  // Track-aware cycle label so the SIP wizard doesn't read "TIR.2026" on its
  // own receipt / past-submission screens.
  const cycleLabel = track === "sip" ? "VIP.2026" : "TIR.2026";

  if (isPast) {
    return (
      <SubmissionView
        answers={answers || {}}
        submission={submission}
        onBack={onBack || onRestart}
        onDownload={onDownload}
        questionPrompts={questionPrompts}
        track={track}
        cycleLabel={cycleLabel}
        onSave={onSave}
      />
    );
  }

  // Just-submitted receipt ("Thank you, …") — unchanged.
  const stampDate = new Date().toISOString().slice(0, 10);
  const idPrefix = track === "sip" ? "VIP-" : "TIR-";
  const stampId = idPrefix + Math.floor(Math.random() * 9000 + 1000);
  return (
    <div className="eir-screen eir-done">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / {cycleLabel}</span>
        <span>submission received ✓</span>
      </div>
      <div className="eir-done-body">
        <div className="eir-done-stamp">
          <div className="eir-mono eir-done-stamp-top">submitted</div>
          <div className="eir-mono eir-done-stamp-id">#{stampId}</div>
          <div className="eir-mono eir-done-stamp-bot">{stampDate}</div>
        </div>
        <h2 className="eir-done-title">Thank you, {name}.</h2>
        <p className="eir-done-lede">
          We&apos;ve received your application. Our team reads every single one — you&apos;ll
          hear back from us by the agreed deadline, whatever the outcome.
        </p>
        <div className="eir-done-next">
          <div className="eir-mono eir-dim">what happens next?</div>
          <ol>
            <li>We read and discuss as a cohort committee.</li>
            <li>Shortlisted applicants are notified around 22 June.</li>
            <li>Interviews take place in the first week of July.</li>
            <li>Residency begins 15 July 2026.</li>
          </ol>
        </div>
        <div className="eir-q-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onRestart}>
            <span>Back to my applications</span>
          </button>
          {onDownload && (
            <button
              type="button"
              className="eir-btn eir-btn-ghost eir-btn-download"
              onClick={onDownload}
            >
              <span>↓ Download my responses</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Format an ISO edit_deadline string to a short human-readable date like "25 Jun".
function formatDeadline(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

// Question kinds for which the Edit affordance is suppressed in the submission view.
// Two categories:
//   1. File-upload kinds — routed to DRAFT-only backend endpoints
//      (/applications/me/evidence-files, /applications/me/milestone-files, and the
//      SIP equivalents). Those endpoints reject submitted applications, so editing
//      a file field on a submitted app always fails. Suppress until dedicated
//      submitted-app file-replace endpoints exist.
//   2. "declarations" — legal affirmations (truthful, ref-checks, terms). Once
//      ticked and submitted these must not be silently un-ticked post-submit;
//      the backend also enforces this with a 422 guard.
const NON_EDITABLE_KINDS = new Set(["declarations"]); // legal affirmations stay locked post-submit

// File kinds that upload/delete directly via the backend (no PATCH needed).
// Editing these shows the file input + a "Done" button to close; there is no Save step.
const FILE_KINDS = new Set([
  "files",           // TIR evidence files  → /applications/me/evidence-files
  "milestoneFiles",  // TIR + SIP milestone → /applications/me/milestone-files  &  /sip-applications/me/milestone-files
  "sipPitchDeck",    // SIP pitch deck      → /sip-applications/me/evidence-files?kind=pitch-deck
  "sipCapTableFile", // SIP cap table file  → /sip-applications/me/evidence-files?kind=cap-table
  "sipPatents",      // SIP patents         → /sip-applications/me/evidence-files?kind=patents
  "sipTractionFiles",// SIP traction        → /sip-applications/me/evidence-files?kind=traction
]);

// Inline per-field edit component for the submission view.
// When `editable` is true, shows an Edit button next to each read-only value.
// Clicking it swaps the value for the wizard input matching `question.kind`,
// with Save / Cancel. Save calls `onSave(questionId, value)`.
// When `editable` is false, renders the read-only value unchanged.
function EditableAnswer({ question, value, editable, onSave, track, applicationId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Keep draft and committed in sync when the parent re-renders with a new value.
  useEffect(() => { setDraft(value); setCommitted(value); }, [value]);

  const InputComponent = track === "sip" ? SipQuestionInput : QuestionInput;
  const displayValue = formatAnswerValue(committed);

  if (!editing) {
    return (
      <div className={`eir-sub-field-value-wrap ${editable ? "is-editable" : ""}`}>
        <div className={`eir-sub-field-value ${displayValue === null ? "is-empty" : ""}`}>
          {displayValue === null ? "Not provided" : displayValue}
        </div>
        {editable && (
          <button
            type="button"
            className="eir-os-edit-btn eir-mono"
            onClick={() => { setDraft(committed); setErr(null); setEditing(true); }}
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  // File kinds upload/delete directly via the backend — no Save/PATCH needed.
  // Just render the file input and a Done button to close the editor.
  if (FILE_KINDS.has(question.kind)) {
    return (
      <div className="eir-sub-field-value-wrap is-editing">
        <div className="eir-os-edit-input-wrap">
          <InputComponent
            q={question}
            value={committed}
            onChange={(v) => setCommitted(v)}
            applicationId={applicationId}
            autoFocus
          />
        </div>
        <div className="eir-os-edit-actions">
          <button type="button" className="eir-btn eir-os-edit-cancel"
            onClick={() => setEditing(false)}>Done</button>
        </div>
      </div>
    );
  }

  // Editing mode for text/choice kinds — edit a draft then Save via onSave (PATCH).
  return (
    <div className="eir-sub-field-value-wrap is-editing">
      <div className="eir-os-edit-input-wrap">
        <InputComponent
          q={question}
          value={draft}
          onChange={setDraft}
          autoFocus
        />
      </div>
      {err && <p className="eir-os-edit-err eir-mono">{err}</p>}
      <div className="eir-os-edit-actions">
        <button
          type="button"
          className="eir-btn eir-btn-primary eir-os-edit-save"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            try {
              await onSave(question.id, draft);
              setCommitted(draft);
              setEditing(false);
            } catch {
              setErr("Couldn't save — check the value and try again.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="eir-btn eir-btn-ghost eir-os-edit-cancel"
          disabled={saving}
          onClick={() => { setEditing(false); setErr(null); }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Short tab labels keyed by section id — the wizard's own section.label is the
// long question prompt, too verbose for a tab strip. Falls back to section.label.
const SECTION_TAB_LABELS = {
  basic: "Basic Details",
  problem: "Problem",
  solution: "Solution",
  execution: "Execution",
  evidence: "Evidence",
  declaration: "Declaration",
};

// Read-only "Your submission." view — summary card + tabbed sections.
// Mirrors the founder-dashboard reference layout while keeping the wizard
// theme tokens (colors / fonts) intact.
// When submission.editable is true, each answer row gets an Edit button
// that swaps the read-only value for the wizard's matching input component.
function SubmissionView({ answers, submission, onBack, onDownload, questionPrompts, track, cycleLabel, onSave }) {
  const sections = track === "sip" ? SECTIONS_SIP : SECTIONS;
  const [activeTab, setActiveTab] = useState(0);
  const tabRefs = useRef([]);

  // WAI-ARIA tabs keyboard nav: arrows move between tabs (roving tabindex),
  // Home/End jump to first/last. Attached to the tablist container.
  const onTabKeyDown = (e, count) => {
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (activeTab + 1) % count;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (activeTab - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  const progress = getSubmissionProgress(submission);
  const statusLabel = getStatusLabel(submission);
  const badgeLabel = progress.isTerminal ? progress.outcome.label : "Submitted";

  const refId = formatRefId(submission?.id, track);

  const submissionName =
    submission?.projectTitle ||
    (track === "sip" ? answers.org : null) ||
    (answers.solutionDescribe || "").slice(0, 60) ||
    answers.org ||
    answers.fullName ||
    "Your application";

  // Resolve each section's visible questions (respecting conditionals).
  const resolvedSections = sections.map((s) => ({
    section: s,
    visible: s.questions.filter((q) => !q.conditional || q.conditional(answers)),
  }));
  const totalSections = resolvedSections.length;
  // This view only renders for an already-submitted application, so it is, by
  // definition, 100% complete — every section was filled before submit.
  const sectionsDone = totalSections;
  const pct = 100;

  const isEditable = !!(submission?.editable);
  const editDeadline = submission?.edit_deadline || null;

  const lede = progress.isTerminal
    ? "This application reached a final outcome. Here's everything you submitted."
    : isEditable
      ? "You can still edit individual answers before the window closes."
      : "Your answers are locked while under review.";
  const lockNote = progress.isTerminal
    ? statusLabel
    : isEditable
      ? `Editable until ${formatDeadline(editDeadline)}`
      : "Locked for review";

  const active = resolvedSections[activeTab] || resolvedSections[0];
  const feedback = submission?.feedback;

  return (
    <div className="eir-screen eir-done eir-sub">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / {cycleLabel}</span>
        <span>my application</span>
      </div>
      <div className="eir-done-body">
        <div className="eir-mono eir-sub-eyebrow">MY APPLICATION</div>
        <h2 className="eir-done-title">Your submission.</h2>
        <p className="eir-done-lede">{lede}</p>

        {/* Summary card */}
        <div className="eir-sub-card">
          <div className="eir-sub-card-head">
            <div className="eir-sub-card-id">
              <div className="eir-mono eir-sub-card-eyebrow">submission</div>
              <div className="eir-sub-card-name">
                {submissionName}
                <span className="eir-mono eir-sub-badge">{badgeLabel}</span>
              </div>
            </div>
            <div className="eir-sub-card-ref">
              <div className="eir-mono eir-sub-card-eyebrow">reference</div>
              <div className="eir-mono eir-sub-ref-id">{refId}</div>
            </div>
          </div>
          <div className="eir-sub-progress-track">
            <div className="eir-sub-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="eir-sub-card-foot">
            <span className="eir-mono eir-dim">
              {pct}% complete · {sectionsDone} of {totalSections} sections done
            </span>
            <span className="eir-mono eir-dim">{lockNote}</span>
          </div>
        </div>

        {/* Sections — tabbed read-only answers */}
        <div className="eir-sub-sections">
          <div className="eir-mono eir-dim eir-sub-sections-label">sections</div>
          <div
            className="eir-sub-tabs"
            role="tablist"
            aria-label="Application sections"
            onKeyDown={(e) => onTabKeyDown(e, resolvedSections.length)}
          >
            {resolvedSections.map((r, i) => (
              <button
                key={r.section.id}
                type="button"
                role="tab"
                id={`eir-sub-tab-${r.section.id}`}
                aria-selected={i === activeTab}
                aria-controls={`eir-sub-panel-${r.section.id}`}
                tabIndex={i === activeTab ? 0 : -1}
                ref={(el) => (tabRefs.current[i] = el)}
                className={`eir-sub-tab ${i === activeTab ? "is-active" : ""}`}
                onClick={() => setActiveTab(i)}
              >
                <span className="eir-mono eir-sub-tab-num">{r.section.index}</span>
                <span className="eir-sub-tab-label">
                  {SECTION_TAB_LABELS[r.section.id] || r.section.label}
                </span>
              </button>
            ))}
          </div>

          <div
            className="eir-sub-tabpanel"
            role="tabpanel"
            id={`eir-sub-panel-${active.section.id}`}
            aria-labelledby={`eir-sub-tab-${active.section.id}`}
            tabIndex={0}>
            {active.visible.length === 0 && (
              <div className="eir-sub-field-value is-empty">Nothing recorded for this section.</div>
            )}
            {active.visible.map((q, qi) => {
              const label =
                (typeof q.prompt === "function"
                  ? safePrompt(q.prompt, answers)
                  : q.prompt) ||
                (questionPrompts && questionPrompts[q.id]) ||
                q.id;
              const num = `${parseInt(active.section.index, 10)}.${qi + 1}`;
              return (
                <div className="eir-sub-field" key={q.id}>
                  <div className="eir-sub-field-label">
                    <span className="eir-mono eir-sub-field-num">{num}</span>
                    {label}
                  </div>
                  <EditableAnswer
                    question={q}
                    value={answers[q.id]}
                    editable={isEditable && !progress.isTerminal && typeof onSave === "function" && !NON_EDITABLE_KINDS.has(q.kind)}
                    track={track}
                    applicationId={submission?.id}
                    onSave={async (qid, v) => {
                      await onSave(submission.id, qid, v);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {feedback && (
          <div className="eir-done-feedback">
            <div className="eir-mono eir-dim eir-done-feedback-label">↳ reviewer feedback</div>
            <p className="eir-done-feedback-body">{feedback}</p>
          </div>
        )}

        <div className="eir-q-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>Back to dashboard</span>
          </button>
          {onDownload && (
            <button
              type="button"
              className="eir-btn eir-btn-ghost eir-btn-download"
              onClick={onDownload}
            >
              <Download size={16} />
              <span>Download my responses</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Resolve a dynamic (function) prompt without throwing on missing answers.
function safePrompt(fn, answers) {
  try {
    return fn(answers || {});
  } catch {
    return null;
  }
}

export { ProgressBar, WelcomeScreen, SectionIntroScreen, CelebrationScreen, DoneScreen };
