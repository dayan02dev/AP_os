// AIScreeningPanel — dark right-side rail with two tabs: Score and Reviewers.
//
// Phase 1 stub-aware: if ai_screening.summary contains "Stub mode", a (STUB)
// chip prefixes the summary block so leadership knows it isn't real Gemini
// output. Phase 2 tabs (Flags, Similar, Ask) render as tooltipped disabled
// pills so the design space stays visible.

import { useState } from "react";
import AISummaryBlock from "../components/AISummaryBlock.jsx";

// Backend stores ai_screening.summary as a JSON-encoded string with keys
// like { verdict, top_strength, top_concern }. Parse + render as labelled
// blocks; fall back to plain text if it's not JSON (older rows or "Stub mode").
function parseSummary(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch { /* not JSON — fall through */ }
  return null;
}

const SUMMARY_FIELD_LABELS = {
  verdict:        "Verdict",
  top_strength:   "Top strength",
  top_concern:    "Top concern",
  recommendation: "Recommendation",
};

const CATEGORY_BARS = [
  { key: "score_problem",    label: "Problem impact" },
  { key: "score_completeness", label: "Completeness & depth" },
  { key: "score_tech",       label: "Technical depth" },
  { key: "score_founders",   label: "Behavioural signal" },
  { key: "score_commitment", label: "Commitment" },
  { key: "score_integrity",  label: "Integrity & closure" },
];

const STATE_DOT = {
  pending:   "amber",
  accepted:  "green",
  completed: "green",
  declined:  "coral",
};

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortId(uid) {
  return (uid || "").slice(0, 8) || "—";
}

function ScoreTab({ aiScreening }) {
  const overall = aiScreening?.score_overall;
  const hasOverall = typeof overall === "number" && Number.isFinite(overall);
  return (
    <div className="ai-panel-body">
      <span className="ai-score-eyebrow">Composite score</span>
      <span className="ai-score-big">
        {hasOverall ? overall.toFixed(1) : "—"}
        <span className="of">/ 10</span>
      </span>
      {hasOverall && overall >= 8 && <span className="ai-score-strong">Strong</span>}
      {!hasOverall && (
        <p className="ai-score-blurb">AI screening not run yet.</p>
      )}

      <div>
        {CATEGORY_BARS.map((c) => {
          const v = aiScreening?.[c.key];
          const pct = typeof v === "number" ? (v / 10) * 100 : 0;
          return (
            <div key={c.key} className="ai-bar-row">
              <span className="label">{c.label}</span>
              <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
              <span className="num">{typeof v === "number" ? v.toFixed(1) : "—"}</span>
            </div>
          );
        })}
      </div>

      {aiScreening?.summary && (() => {
        const parsed = parseSummary(aiScreening.summary);
        return (
          <div className="ai-summary">
            <div className="head">
              AI Summary
              {isStub && <span className="stub-badge">STUB</span>}
            </div>
            {parsed ? (
              <dl className="body ai-summary-fields">
                {Object.entries(parsed).map(([key, value]) => (
                  typeof value === "string" && value.trim() !== "" ? (
                    <div key={key} className="ai-summary-field">
                      <dt>{SUMMARY_FIELD_LABELS[key] || key.replace(/_/g, " ")}</dt>
                      <dd>{value}</dd>
                    </div>
                  ) : null
                ))}
              </dl>
            ) : (
              <div className="body">{aiScreening.summary}</div>
            )}
          </div>
        );
      })()}
      {aiScreening?.summary && (
        <div className="ai-summary">
          <div className="head">AI Summary</div>
          <div className="body">
            <AISummaryBlock aiScreening={aiScreening} />
          </div>
        </div>
      )}

      {aiScreening && (
        <div className="ai-meta">
          {aiScreening.model || "—"} · ran {fmtWhen(aiScreening.ran_at)}
        </div>
      )}
    </div>
  );
}

function ReviewersTab({ assignments, onUnassign, unassigning, currentUserId }) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return (
      <div className="ai-panel-body">
        <p className="ai-score-blurb">No reviewers assigned yet.</p>
      </div>
    );
  }
  return (
    <div className="ai-panel-body">
      {assignments.map((a) => {
        const isSelf = a.reviewer_user_id === currentUserId;
        const dotCls = STATE_DOT[a.state] || "amber";
        return (
          <div
            key={a.id || `${a.reviewer_user_id}-${a.assigned_at}`}
            className="ai-reviewer-row"
          >
            <span>
              <span className="name">Reviewer · {shortId(a.reviewer_user_id)}</span>
              <div className="state">
                <span className={`dot ${dotCls}`} />
                {a.state || "pending"}
              </div>
            </span>
            <button
              type="button"
              className="ai-unassign"
              onClick={() => onUnassign?.(a)}
              disabled={isSelf || unassigning === a.reviewer_user_id}
              title={isSelf
                ? "You can't unassign yourself from your own review."
                : "Remove this reviewer from the application."}
            >
              {unassigning === a.reviewer_user_id ? "Unassigning…" : "Unassign"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function AIScreeningPanel({
  aiScreening,
  assignments,
  onUnassign,
  onClose,
  unassigning,
  currentUserId,
}) {
  const [tab, setTab] = useState("score");

  return (
    <aside className="ai-panel" aria-label="AI screening panel">
      <header className="ai-panel-head">
        <span className="title">AI Screening</span>
        <button
          type="button"
          className="ai-panel-close"
          onClick={onClose}
          aria-label="Collapse AI screening panel"
        >
          ×
        </button>
      </header>
      <nav className="ai-panel-tabs" aria-label="AI screening tabs">
        <button
          type="button"
          className={`ai-panel-tab${tab === "score" ? " active" : ""}`}
          onClick={() => setTab("score")}
        >
          Score
        </button>
        <button
          type="button"
          className="ai-panel-tab"
          aria-disabled="true"
          title="Flag extraction ships in Phase 2 — backend not yet wired."
        >
          Flags
        </button>
        <button
          type="button"
          className="ai-panel-tab"
          aria-disabled="true"
          title="Similar-application search ships in Phase 2 — needs embeddings backend."
        >
          Similar
        </button>
        <button
          type="button"
          className={`ai-panel-tab${tab === "reviewers" ? " active" : ""}`}
          onClick={() => setTab("reviewers")}
        >
          Reviewers
        </button>
        <button
          type="button"
          className="ai-panel-tab"
          aria-disabled="true"
          title="Ask-this-application chat ships in Phase 2 — needs RAG backend."
        >
          Ask
        </button>
      </nav>
      {tab === "score" && <ScoreTab aiScreening={aiScreening} />}
      {tab === "reviewers" && (
        <ReviewersTab
          assignments={assignments}
          onUnassign={onUnassign}
          unassigning={unassigning}
          currentUserId={currentUserId}
        />
      )}
    </aside>
  );
}
