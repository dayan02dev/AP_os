// ComparativeReviewModel — renders the REAL reviewer evaluations for a startup.
//
// Reviews come from `startup.reviews` (adapted from the `reviews` table). Each
// review carries reviewer category scores (problem/solution/tech/founders/commit),
// an overall, a recommendation, free-text notes, raised flags, and the
// reviewer_user_id. Reviewer display names are resolved from the optional
// `reviewersById` map (reviewer_user_id → name); when a name is missing we fall
// back to "Reviewer". No data is fabricated.

import React from "react";
import { revInitials } from "../helpers/adminHelpers";

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
  { key: 'commit', short: 'Commitment' },
];

export function ComparativeReviewModel({ startup, reviewersById = {} }) {
  const s = startup;
  if (!s) return null;

  const reviews = Array.isArray(s.reviews) ? s.reviews : [];

  return (
    <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="cem-kicker">&sect; Reviewer Evaluation</span>
        <h3 className="cem-title">Human Reviewers Consensus</h3>
      </div>

      {reviews.length === 0 ? (
        <p className="os-text-dim os-text-sm">No reviewer evaluations submitted yet.</p>
      ) : (
        <div className="rv-grid">
          {reviews.map((rv, i) => {
            const name = rv.reviewerName || reviewersById?.[rv.reviewerId] || 'Reviewer';
            const flags = Array.isArray(rv.flags) ? rv.flags : [];
            const reco = (rv.reco || 'maybe');
            return (
              <div key={rv.reviewerId || i} className="rv-card">
                <div className="rv-card-head">
                  <div className="rv-card-id">
                    <ReviewerAvatar name={name} size={38} />
                    <div style={{ minWidth: 0 }}>
                      <div className="rv-card-name">{name}</div>
                      <div className="rv-card-role">Reviewer</div>
                    </div>
                  </div>
                  <span className={`os-chip ${reco === 'yes' ? 'green' : (reco === 'maybe' ? 'amber' : 'red')}`} style={{ flexShrink: 0 }}>
                    {reco.toUpperCase()}
                  </span>
                </div>

                <div className="rv-overall">
                  <span className="rv-overall-label">Overall rating</span>
                  <span className="rv-overall-num">{rv.overall != null ? rv.overall.toFixed(1) : '—'}</span>
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
                  <span className="rv-block-label">Reviewer note</span>
                  <p className="rv-note-text">{rv.notes}</p>
                </div>

                <div className="rv-flags">
                  <span className="rv-block-label">Flags raised ({flags.length})</span>
                  {flags.length > 0 ? (
                    <div className="rv-flag-list">
                      {flags.map((f, idx) => (
                        <div className="rv-flag" key={idx}><span className="rv-flag-mark">⚑</span><span>{f}</span></div>
                      ))}
                    </div>
                  ) : (
                    <span className="rv-flags-empty">No flags raised.</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
