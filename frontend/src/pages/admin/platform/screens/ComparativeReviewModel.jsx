// ComparativeReviewModel — renders the REAL reviewer evaluations for a startup.
//
// Reviews come from `startup.reviews` (adapted from the `reviews` table). Each
// review carries reviewer category scores (problem/solution/tech/founders — the
// v3.2 rubric; reviewer "Commitment" is no longer a criterion), the 4-criterion
// weighted overall, the submitted date and the RAW review row, whose written
// feedback (recommendation, notes, legacy strengths/concerns/comments, flags,
// AI disagreements) is rendered by the shared ReviewerFeedback component — the
// same renderer the leadership and reviewer portals use. Reviewer display names are resolved from the optional
// `reviewersById` map (reviewer_user_id → name); when a name is missing we fall
// back to "Reviewer". No data is fabricated.

import React from "react";
import { revInitials } from "../helpers/adminHelpers";
import ReviewerFeedback from "../../../../components/ReviewerFeedback.jsx";

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// A raw review row for ReviewerFeedback; rebuilt from the adapted fields when
// the review didn't come through adaptDetail (no `raw`).
function rawOf(rv) {
  if (rv.raw) return rv.raw;
  return {
    recommendation: rv.reco || null,
    quick_notes: rv.notes || null,
    strengths: rv.strengths || null,
    concerns: rv.concerns || null,
    comments: rv.comments || null,
    flags: Array.isArray(rv.flags) ? rv.flags : [],
    disagree_with_ai: rv.disagreements || null,
  };
}

function ReviewerAvatar({ name, size = 20, primary = false }) {
  return (
    <span className="os-avatar" style={{
      width: size, height: size, fontSize: Math.round(size * 0.42), flexShrink: 0,
      background: primary ? 'var(--brand-violet)' : 'var(--accent-soft)',
      color: primary ? '#fff' : 'var(--artblue)'
    }}>{revInitials(name)}</span>
  );
}

const CRITERIA = [
  { key: 'problem', short: 'Problem statement' },
  { key: 'solution', short: 'Solution depth' },
  { key: 'tech', short: 'Technical depth' },
  { key: 'founders', short: 'Founder profile' },
];

// `loading` — the startup's reviews are still being fetched: show that rather
// than the empty "No reviewer evaluations" message.
export function ComparativeReviewModel({ startup, reviewersById = {}, loading = false }) {
  const s = startup;
  if (!s) return null;

  const reviews = Array.isArray(s.reviews) ? s.reviews : [];

  return (
    <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="cem-kicker">&sect; Reviewer Evaluation</span>
        <h3 className="cem-title">Human Reviewers Consensus</h3>
      </div>

      {loading && reviews.length === 0 ? (
        <p className="os-text-dim os-text-sm">Loading reviewer evaluations…</p>
      ) : reviews.length === 0 ? (
        <p className="os-text-dim os-text-sm">No reviewer evaluations submitted yet.</p>
      ) : (
        <div className="rv-grid">
          {reviews.map((rv, i) => {
            const name = rv.reviewerName || reviewersById?.[rv.reviewerId] || 'Reviewer';
            const reco = rv.reco ? String(rv.reco).toLowerCase() : null;
            const recoTone = reco === 'yes' ? 'green' : reco === 'maybe' ? 'amber' : reco === 'no' ? 'red' : '';
            return (
              <div key={rv.reviewerId || i} className="rv-card">
                <div className="rv-card-head">
                  <div className="rv-card-id">
                    <ReviewerAvatar name={name} size={38} />
                    <div style={{ minWidth: 0 }}>
                      <div className="rv-card-name">{name}</div>
                      <div className="rv-card-role">
                        Reviewer
                        {rv.submittedAt && <> · submitted <span data-testid="rv-submitted">{fmtDate(rv.submittedAt)}</span></>}
                      </div>
                    </div>
                  </div>
                  <span className={`os-chip ${recoTone}`} style={{ flexShrink: 0 }} data-testid="rv-reco">
                    {reco ? reco.toUpperCase() : '—'}
                  </span>
                </div>

                <div className="rv-overall">
                  <span className="rv-overall-label">Weighted score</span>
                  <span className="rv-overall-num" data-testid="rv-overall">{typeof rv.overall === 'number' ? rv.overall.toFixed(1) : '—'}</span>
                </div>

                <div className="rv-scores">
                  {CRITERIA.map((m, j) => {
                    const val = rv[m.key];
                    return (
                      <div className="rv-score" key={j}>
                        <span className="rv-score-label">{m.short}</span>
                        <span className="rv-bar"><span className="rv-bar-fill" style={{ width: Math.max(0, Math.min(100, (val || 0) * 10)) + '%' }} /></span>
                        <span className="rv-score-num">{val != null ? val.toFixed(1) : '—'}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="rv-note">
                  <span className="rv-block-label">Reviewer feedback</span>
                  <ReviewerFeedback review={rawOf(rv)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
