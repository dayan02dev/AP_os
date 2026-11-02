// ReviewsTab — per-reviewer cards (category bars + the reviewer's written
// feedback), admin decisions + rationale, and pending assignments below.

import {
  reviewerNameOf,
  reviewerStatusLabel,
  reviewerStatusOf,
} from "../../../lib/reviewerStatus.js";
import { weightedReviewScore } from "../../../lib/reviewScore.js";
import ReviewerFeedback, { AdminDecisionList } from "../../../components/ReviewerFeedback.jsx";

// Dimension labels mirror the reviewer portal's CRIT_LABELS (the names the
// reviewer actually scored against). No Integrity row — reviews carry no
// integrity score, so it was always blank. No Commitment row either — removed
// from the reviewer rubric (v3.2); historical values are ignored in the score.
const CATEGORY_BARS = [
  { key: "score_problem",    label: "Problem Statement Impact and Importance" },
  { key: "score_solution",   label: "Completeness, Depth of Solution" },
  { key: "score_tech",       label: "Technical Depth" },
  { key: "score_founders",   label: "Professional Profile of Founder" },
];

function fmtDate(iso) {
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

export default function ReviewsTab({ reviews, assignments, adminDecisions }) {
  const submittedReviews = (reviews || []).filter((r) => r.status === "submitted" || r.submitted_at);
  const totalAssignments = (assignments || []).length;
  const submittedCount = submittedReviews.length;
  const overalls = submittedReviews
    .map((r) => weightedReviewScore(r))
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  const avg =
    overalls.length > 0
      ? (overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1)
      : null;

  // Only assignments whose reviewer hasn't submitted yet (derived from
  // timestamps, not the vestigial `state` column, which never advances).
  const pending = (assignments || []).filter(
    (a) => reviewerStatusOf(a) === "pending",
  );

  return (
    <div>
      <p className="reviews-summary">
        <strong>{totalAssignments}</strong> reviewer{totalAssignments === 1 ? "" : "s"} assigned ·
        {" "}<strong>{submittedCount}</strong> review{submittedCount === 1 ? "" : "s"} submitted
        {avg !== null && <> · avg score <strong>{avg}</strong></>}.
      </p>

      {submittedReviews.length === 0 ? (
        <p className="ans-empty">No reviews submitted yet.</p>
      ) : (
        <div className="reviews-list">
          {submittedReviews.map((r) => {
            const overall = weightedReviewScore(r);
            return (
            <article
              key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
              className="review-card"
            >
              <header className="review-card-head">
                <span className="review-card-name">
                  Reviewer · {reviewerNameOf(r)}
                </span>
                <span className="review-card-head-right">
                  {typeof overall === "number" && (
                    <span
                      className="review-card-score"
                      aria-label={`Reviewer weighted score ${overall.toFixed(1)} out of 10`}
                    >
                      {overall.toFixed(1)}<span className="of">/10</span>
                    </span>
                  )}
                  <span className="review-card-when">{fmtDate(r.submitted_at)}</span>
                </span>
              </header>
              <div className="review-bars">
                {CATEGORY_BARS.map((c) => {
                  const v = r[c.key];
                  const pct = typeof v === "number" ? (v / 10) * 100 : 0;
                  return (
                    <div key={c.key} className="review-bar">
                      <span className="label">{c.label}</span>
                      <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
                      <span className="num">{typeof v === "number" ? v.toFixed(1) : "—"}</span>
                    </div>
                  );
                })}
              </div>
              <ReviewerFeedback review={r} />
            </article>
            );
          })}
        </div>
      )}

      <AdminDecisionList decisions={adminDecisions} />

      {pending.length > 0 && (
        <div className="pending-list">
          <span className="eyebrow" style={{ marginBottom: "var(--s-2)", display: "block" }}>
            Pending assignments
          </span>
          {pending.map((a) => (
            <div
              key={a.id || `${a.reviewer_user_id}-${a.assigned_at}`}
              className="pending-row"
            >
              <span>Reviewer · {reviewerNameOf(a)}</span>
              <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                {reviewerStatusLabel(a)} · assigned {fmtDate(a.assigned_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
