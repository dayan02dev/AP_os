// Welcome, section intro, celebration, done screens + progress bar

import { MILESTONES, getSubmissionProgress, getStatusLabel } from "./auth_upload.jsx";

function ProgressBar({ variant, progress, currentStep, totalSteps, sectionLabel, sectionIndex, totalSections, estMin }) {
  const pct = Math.round(progress * 100);

  if (variant === "section") {
    return (
      <div className="eir-pb eir-pb-section">
        <div className="eir-pb-sections">
          {Array.from({ length: totalSections }).map((_, i) => (
            <div key={i} className={`eir-pb-seg ${i < sectionIndex ? "is-done" : i === sectionIndex ? "is-active" : ""}`}>
              <span className="eir-mono eir-pb-seg-label">{(i + 1).toString().padStart(2, "0")}</span>
            </div>
          ))}
        </div>
        <div className="eir-pb-meta eir-mono">
          <span>§ {sectionLabel}</span>
          <span className="eir-dim">— {pct}% · ~{estMin} min left</span>
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
        <span>§ {sectionLabel}</span>
        <span className="eir-dim">{pct}% · {(currentStep + 1)}/{totalSteps} · ~{estMin} min</span>
      </div>
    </div>
  );
}

function WelcomeScreen({ onStart, warmCopy }) {
  return (
    <div className="eir-screen eir-welcome">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>intake · rev 04</span>
      </div>
      <div className="eir-welcome-body">
        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> technology innovator in residence · applications open
        </div>
        <h1 className="eir-welcome-title">
          {warmCopy ? <>Let's get to know <em>you</em>.</> : <>Technology Innovator in Residence — Application</>}
        </h1>
        <p className="eir-welcome-lede">
          {warmCopy
            ? "A short, honest conversation — not a form. We'll start by parsing your CV to save you time, then walk through 6 sections together. Plan for about 60–90 minutes of focused work."
            : "Intake questionnaire for the 2026 TIR cohort. 6 sections, auto-filled where possible. Est. 60–90 minutes."}
        </p>
        <div className="eir-welcome-meta">
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">duration</div><div className="eir-welcome-stat-val">60–90 min</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">sections</div><div className="eir-welcome-stat-val">06</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">auto-fill</div><div className="eir-welcome-stat-val">from CV</div></div>
          <div className="eir-welcome-stat"><div className="eir-mono eir-dim">deadline</div><div className="eir-welcome-stat-val">22 may</div></div>
        </div>
        <button className="eir-btn eir-btn-primary" onClick={onStart}>
          <span>Begin application</span><span className="eir-btn-key eir-mono">⏎</span>
        </button>
        <div className="eir-welcome-foot eir-mono eir-dim">press <kbd>Enter</kbd> to start · progress saves automatically</div>
      </div>
    </div>
  );
}

function SectionIntroScreen({ section, onContinue, totalSections = 6 }) {
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
        <button className="eir-btn eir-btn-primary" onClick={onContinue}>
          <span>Continue</span><span className="eir-btn-key eir-mono">⏎</span>
        </button>
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

function DoneScreen({ answers, onRestart, submission, onBack }) {
  const name = (answers?.fullName || "").split(" ")[0] || "there";
  const isPast = !!submission;
  const stampId = submission?.id || ("TIR-" + Math.floor(Math.random() * 9000 + 1000));
  const stampDate = submission?.ts
    ? new Date(submission.ts).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const feedback = submission?.feedback;
  const cycle = submission?.cycle;
  const projectTitle = submission?.projectTitle;

  // Milestone pipeline (past submissions only)
  const progress = isPast ? getSubmissionProgress(submission) : null;
  const statusLabel = isPast ? getStatusLabel(submission) : "submitted";

  // Human-readable timing hints for milestones (for demo realism)
  const milestoneTimingHints = {
    submitted: "application received",
    under_review: "committee reading now",
    shortlisted: "expected by 29 Jun",
    interview: "first week of July",
    decision: "by mid-July",
  };

  return (
    <div className="eir-screen eir-done">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>{isPast ? `past submission · ${cycle || "archive"}` : "submission received ✓"}</span>
      </div>
      <div className="eir-done-body">
        <div className="eir-done-stamp">
          <div className="eir-mono eir-done-stamp-top">{isPast ? statusLabel.toLowerCase() : "submitted"}</div>
          <div className="eir-mono eir-done-stamp-id">#{stampId}</div>
          <div className="eir-mono eir-done-stamp-bot">{stampDate}</div>
        </div>
        <h2 className="eir-done-title">
          {isPast
            ? <>{projectTitle || <>Your {cycle || "past"} submission</>}</>
            : <>Thank you, {name}.</>}
        </h2>
        <p className="eir-done-lede">
          {isPast
            ? (progress?.isTerminal
                ? (feedback ? "This application reached a final outcome. Here's the reviewer feedback and everything you submitted." : "This application reached a final outcome. Here's everything you submitted.")
                : "This application is live. Track its progress through the review pipeline below.")
            : "We've received your application. Our team reads every single one — you'll hear back from us by the agreed deadline, whatever the outcome."}
        </p>

        {/* Milestone pipeline — past submissions only */}
        {isPast && progress && MILESTONES.length > 0 && (
          <div className="eir-done-timeline">
            <div className="eir-mono eir-dim eir-done-timeline-label">↳ review pipeline</div>
            <ol className="eir-done-timeline-list">
              {MILESTONES.map((m, mi) => {
                const reached = mi <= progress.currentIdx;
                const isCurrent = !progress.isTerminal && mi === progress.currentIdx;
                const isTerminalHere = progress.isTerminal && mi === progress.currentIdx;
                return (
                  <li key={m.key} className={`eir-done-tl-item ${reached ? "is-reached" : ""} ${isCurrent ? "is-current" : ""} ${isTerminalHere ? "is-terminal" : ""}`}>
                    <div className="eir-done-tl-marker">
                      <span className="eir-done-tl-dot" />
                      {mi < MILESTONES.length - 1 && <span className="eir-done-tl-line" />}
                    </div>
                    <div className="eir-done-tl-body">
                      <div className="eir-done-tl-head">
                        <span className="eir-done-tl-title">{m.label}</span>
                        {isCurrent && <span className="eir-mono eir-done-tl-now">● now</span>}
                        {isTerminalHere && progress.outcome && (
                          <span className="eir-mono eir-done-tl-outcome">{progress.outcome.label}</span>
                        )}
                      </div>
                      <div className="eir-mono eir-dim eir-done-tl-meta">
                        {reached ? milestoneTimingHints[m.key] : "—"}
                      </div>
                      <div className="eir-done-tl-desc">{m.desc}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {isPast && feedback && (
          <div className="eir-done-feedback">
            <div className="eir-mono eir-dim eir-done-feedback-label">
              ↳ reviewer feedback · {cycle || "previous cycle"}
            </div>
            <p className="eir-done-feedback-body">{feedback}</p>
          </div>
        )}

        {isPast && answers && Object.keys(answers).length > 0 && (
          <div className="eir-done-answers">
            <div className="eir-mono eir-dim eir-done-answers-label">↳ what you submitted</div>
            <dl className="eir-done-answers-list">
              {Object.entries(answers).slice(0, 12).map(([k, v]) => (
                <div key={k} className="eir-done-answer-row">
                  <dt className="eir-mono">{k}</dt>
                  <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {!isPast && (
          <div className="eir-done-next">
            <div className="eir-mono eir-dim">what happens next</div>
            <ol>
              <li>We read and discuss as a cohort committee.</li>
              <li>Shortlisted applicants are notified around 29 June 2026.</li>
              <li>Interviews take place in the first week of July.</li>
              <li>Residency begins 22 July 2026.</li>
            </ol>
          </div>
        )}

        <div className="eir-q-actions">
          {isPast ? (
            <button className="eir-btn eir-btn-primary" onClick={onBack || onRestart}>
              <span>← back to applications</span>
            </button>
          ) : (
            <button className="eir-btn eir-btn-ghost" onClick={onRestart}>
              <span>Back to my applications</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { ProgressBar, WelcomeScreen, SectionIntroScreen, CelebrationScreen, DoneScreen };
