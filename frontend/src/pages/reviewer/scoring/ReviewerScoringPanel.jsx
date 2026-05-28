import { useMemo, useState } from "react";
import ScoreSegmentInput from "./ScoreSegmentInput.jsx";
import RecommendationInput from "./RecommendationInput.jsx";
import EditWindowCountdown from "./EditWindowCountdown.jsx";
import AIComparisonView from "./AIComparisonView.jsx";

const CATEGORIES = [
  { col: "score_problem",    label: "Problem importance & clarity" },
  { col: "score_solution",   label: "Solution depth & completeness" },
  { col: "score_tech",       label: "Technical strength" },
  { col: "score_founders",   label: "Founder traits" },
  { col: "score_commitment", label: "Commitment level" },
];

function blankForm() {
  return {
    score_problem: null,
    score_solution: null,
    score_tech: null,
    score_founders: null,
    score_commitment: null,
    recommendation: null,
    strengths: "",
    concerns: "",
    quick_notes: "",
  };
}

function isComplete(form) {
  return CATEGORIES.every((c) => typeof form[c.col] === "number") && !!form.recommendation;
}

function prefillFromReview(review) {
  if (!review) return blankForm();
  const blank = blankForm();
  return {
    ...blank,
    score_problem:    review.score_problem    ?? null,
    score_solution:   review.score_solution   ?? null,
    score_tech:       review.score_tech       ?? null,
    score_founders:   review.score_founders   ?? null,
    score_commitment: review.score_commitment ?? null,
    recommendation:   review.recommendation   ?? null,
    strengths:        review.strengths        ?? "",
    concerns:         review.concerns         ?? "",
    quick_notes:      review.quick_notes      ?? "",
  };
}

function StateAForm({ initial, onSubmit, onSaveDraft }) {
  const [form, setForm] = useState(() => prefillFromReview(initial));
  const complete = useMemo(() => isComplete(form), [form]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <span className="panel-eyebrow">Score this application</span>
      <p className="panel-intro">
        Read carefully. Your scores stay private until leadership compares them.
      </p>

      {CATEGORIES.map((c) => (
        <div key={c.col}>
          <label className="field-label">{c.label}</label>
          <ScoreSegmentInput
            label={c.label}
            value={form[c.col]}
            onChange={(v) => set(c.col, v)}
          />
        </div>
      ))}

      <div>
        <label className="field-label">Recommendation</label>
        <RecommendationInput
          value={form.recommendation}
          onChange={(v) => set("recommendation", v)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="r-strengths">Strengths</label>
        <textarea id="r-strengths" className="field" rows={3}
          value={form.strengths} onChange={(e) => set("strengths", e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="r-concerns">Concerns</label>
        <textarea id="r-concerns" className="field" rows={3}
          value={form.concerns} onChange={(e) => set("concerns", e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="r-notes">Quick notes (private to you)</label>
        <textarea id="r-notes" className="field" rows={2}
          value={form.quick_notes} onChange={(e) => set("quick_notes", e.target.value)} />
      </div>

      <div className="scoring-panel-footer">
        <button type="button" className="btn btn-ghost" onClick={() => onSaveDraft(form)}>
          Save draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!complete}
          onClick={() => onSubmit(form)}
        >
          Submit review <span className="arrow">→</span>
        </button>
      </div>
    </>
  );
}

function StateBSubmitted({ myReview, aiScreening, onEdit, onExpire }) {
  return (
    <>
      <span className="panel-eyebrow" style={{ color: "var(--accent-green)" }}>
        Review submitted · ✓
      </span>
      <p className="panel-intro">
        You can edit until <EditWindowCountdown lockedAt={myReview.locked_at} onExpire={onExpire} />
        .
      </p>
      <AIComparisonView myReview={myReview} aiScreening={aiScreening} />
      <div className="scoring-panel-footer">
        <button type="button" className="btn btn-primary" onClick={onEdit}>
          Edit my review <span className="arrow">→</span>
        </button>
      </div>
    </>
  );
}

function StateCLocked({ myReview, aiScreening }) {
  return (
    <>
      <span className="panel-eyebrow">Review submitted · LOCKED</span>
      <AIComparisonView myReview={myReview} aiScreening={aiScreening} />
    </>
  );
}

export default function ReviewerScoringPanel({
  state, myReview, aiScreening, onSubmit, onSaveDraft, onEdit, onExpire,
}) {
  return (
    <aside className="scoring-panel" aria-label="Reviewer scoring panel">
      {state === "scoring" && (
        <StateAForm initial={myReview} onSubmit={onSubmit} onSaveDraft={onSaveDraft} />
      )}
      {state === "editable" && (
        <StateBSubmitted
          myReview={myReview}
          aiScreening={aiScreening}
          onEdit={onEdit}
          onExpire={onExpire}
        />
      )}
      {state === "locked" && (
        <StateCLocked myReview={myReview} aiScreening={aiScreening} />
      )}
    </aside>
  );
}
