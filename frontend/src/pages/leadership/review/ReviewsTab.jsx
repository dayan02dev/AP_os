// ReviewsTab — per-reviewer cards with category bars + comments + pending
// assignments below.

import {
  reviewerNameOf,
  reviewerStatusLabel,
  reviewerStatusOf,
} from "../../../lib/reviewerStatus.js";

// Dimension labels mirror the reviewer portal's CRIT_LABELS (the names the
// reviewer actually scored against). No Integrity row — reviews carry no
// integrity score, so it was always blank.
const CATEGORY_BARS = [
  { key: "score_problem",    label: "Problem Statement Impact and Importance" },
  { key: "score_solution",   label: "Completeness, Depth of Solution" },
  { key: "score_tech",       label: "Technical Depth" },
  { key: "score_founders",   label: "Professional Profile of Founder" },
  { key: "score_commitment", label: "Commitment to be fully available" },
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

export default function ReviewsTab({ reviews, assignments }) {
  const submittedReviews = (reviews || []).filter((r) => r.status === "submitted" || r.submitted_at);
  const totalAssignments = (assignments || []).length;
  const submittedCount = submittedReviews.length;
  const overalls = submittedReviews
    .map((r) => r.score_overall)
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
          {submittedReviews.map((r) => (
            <article
              key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
              className="review-card"
            >
              <header className="review-card-head">
                <span className="review-card-name">
                  Reviewer · {reviewerNameOf(r)}
                </span>
                <span className="review-card-when">{fmtDate(r.submitted_at)}</span>
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
              {r.comments && (
                <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink)", margin: 0 }}>
                  {r.comments}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

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
