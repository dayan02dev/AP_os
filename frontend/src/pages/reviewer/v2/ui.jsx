// Shared atoms for the Reviewer Portal v2 (ported from the prototype's
// LoadingState / ErrorState / EmptyState + the shell.jsx Chip/ScoreBar/Slider).
// These were window-globals in the prototype; here they are real exports.

import { useEffect, useRef } from "react";

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="rv-async rv-async-loading">
      <span className="rv-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="rv-async rv-async-error">
      <div className="os-text-sm" style={{ color: "var(--bad)", fontWeight: 600 }}>
        Couldn’t load this data.
      </div>
      {error && error.message && (
        <div className="os-text-xs os-text-dim" style={{ marginTop: 4 }}>
          {error.message}
        </div>
      )}
      {onRetry && (
        <button className="os-btn ghost sm" style={{ marginTop: 12 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ label = "Nothing here yet." }) {
  return <div className="rv-async rv-async-empty os-text-dim">{label}</div>;
}

export function Chip({ children, tone = "", solid = false }) {
  return <span className={"os-chip " + tone + (solid ? " solid" : "")}>{children}</span>;
}

// Read-only score bar (AI baseline display).
export function ScoreBar({ label, value, max = 10, kind = "", ticks = true }) {
  const safe = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(1, safe / max)) * 100;
  return (
    <div className={"os-scorebar " + kind}>
      <div className="os-scorebar-label">{label}</div>
      <div className="os-scorebar-track">
        <div className="os-scorebar-fill" style={{ width: pct + "%" }} />
        {ticks &&
          [2, 4, 6, 8].map((t) => (
            <div key={t} className="os-scorebar-tick" style={{ left: (t / max) * 100 + "%" }} />
          ))}
      </div>
      <div className="os-scorebar-val">{safe.toFixed(1)}</div>
    </div>
  );
}

// Draggable 0–10 slider (0.5 steps) — ported from shell.jsx.
export function Slider({ label, value, onChange, kind = "", min = 0, max = 10, step = 0.5, disabled = false }) {
  const trackRef = useRef(null);
  // Track any in-flight drag listeners so we can detach them if the component
  // unmounts mid-drag (otherwise window mousemove/mouseup leak until mouseup).
  const dragRef = useRef(null);
  const pct = ((value - min) / (max - min)) * 100;
  const handle = (clientX) => {
    if (disabled || !trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    let v = min + x * (max - min);
    v = Math.round(v / step) * step;
    onChange(v);
  };
  useEffect(() => {
    return () => {
      if (dragRef.current) {
        window.removeEventListener("mousemove", dragRef.current.move);
        window.removeEventListener("mouseup", dragRef.current.up);
        dragRef.current = null;
      }
    };
  }, []);
  return (
    <div className={"os-slider-row " + kind} aria-disabled={disabled}>
      <div className="os-slider-label">{label}</div>
      <div
        ref={trackRef}
        className="os-slider-track"
        style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
        onMouseDown={(e) => {
          if (disabled) return;
          handle(e.clientX);
          const move = (ev) => handle(ev.clientX);
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            dragRef.current = null;
          };
          dragRef.current = { move, up };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      >
        <div className="os-slider-fill" style={{ width: pct + "%" }} />
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
          <div key={t} className="os-slider-tick" style={{ left: ((t - min) / (max - min)) * 100 + "%" }} />
        ))}
        <div className="os-slider-thumb" style={{ left: pct + "%" }} />
      </div>
      <div className="os-slider-val">{value.toFixed(1)}</div>
    </div>
  );
}

// Display labels for the five scoring dimensions (prototype CRIT_LABELS).
export const CRIT_LABELS = {
  problem: "Problem Statement Impact and Importance",
  solution: "Completeness, Depth of Solution",
  tech: "Technical Depth",
  founders: "Professional Profile of Founder",
  commit: "Commitment to be fully available",
};

export const DIM_KEYS = ["problem", "solution", "tech", "founders", "commit"];

// Weighted overall — must match backend reviewer_query._SCORE_WEIGHTS.
const WEIGHTS = { problem: 22, solution: 30, tech: 22, founders: 14, commit: 12 };
export function weightedOverall(scores) {
  let total = 0;
  let wsum = 0;
  for (const k of DIM_KEYS) {
    const v = scores[k];
    if (typeof v !== "number") continue;
    total += v * WEIGHTS[k];
    wsum += WEIGHTS[k];
  }
  return wsum ? total / wsum : 0;
}

export const COHORT_LABEL = "TIR + VIP cohort 2026";

export function initialsOf(name, email) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }
  const e = (email || "").trim();
  return e ? e.slice(0, 2).toUpperCase() : "RV";
}

// Map the raw `reviews` row (backend) → the prototype's editable evaluation
// shape: { reviewId, status, scores:{...}, recommendation, notes,
// disagreements:{}, flags:[], editWindowExpiresAt }.
export function reviewRowToEvaluation(row) {
  if (!row) {
    return {
      reviewId: null,
      status: "not-started",
      scores: { problem: 5.0, solution: 5.0, tech: 5.0, founders: 5.0, commit: 5.0 },
      recommendation: null,
      notes: "",
      disagreements: {},
      flags: [],
      editWindowExpiresAt: null,
    };
  }
  const num = (v) => (typeof v === "number" ? v : v == null ? 5.0 : Number(v));
  return {
    reviewId: row.id || null,
    status: row.submitted_at ? "submitted" : "draft",
    scores: {
      problem: num(row.score_problem),
      solution: num(row.score_solution),
      tech: num(row.score_tech),
      founders: num(row.score_founders),
      commit: num(row.score_commitment),
    },
    recommendation: row.recommendation || null,
    notes: row.quick_notes || "",
    disagreements: row.disagree_with_ai || {},
    flags: Array.isArray(row.flags) ? row.flags : [],
    editWindowExpiresAt: row.locked_at || null,
  };
}

// Build the API payload (prototype scores/notes/disagreements → DB columns).
export function evaluationToPayload(ev, { application, draft }) {
  return {
    application_id: application.id,
    application_track: application.track,
    assignment_id: application.assignmentId,
    score_problem: ev.scores.problem,
    score_solution: ev.scores.solution,
    score_tech: ev.scores.tech,
    score_founders: ev.scores.founders,
    score_commitment: ev.scores.commit,
    recommendation: ev.recommendation,
    quick_notes: ev.notes,
    disagree_with_ai: ev.disagreements,
    flags: ev.flags,
    draft,
  };
}

// Patch payload (no application_id/track/assignment_id — PATCH keys by review id).
export function evaluationToPatch(ev, { draft }) {
  const patch = {
    score_problem: ev.scores.problem,
    score_solution: ev.scores.solution,
    score_tech: ev.scores.tech,
    score_founders: ev.scores.founders,
    score_commitment: ev.scores.commit,
    recommendation: ev.recommendation,
    quick_notes: ev.notes,
    disagree_with_ai: ev.disagreements,
    flags: ev.flags,
  };
  if (draft !== undefined) patch.draft = draft;
  return patch;
}
