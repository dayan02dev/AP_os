// ComparativeReviewModel — ported verbatim from admin-2.jsx `ComparativeReviewModel`.
//
// Renders a side-by-side grid of the three seeded reviewer cards for a startup
// that has a `.rev` payload. The seeded math (getThreeReviewers, getReviewerWeight,
// calculateWeightedReviewerAverage) lives in adminHelpers.js and does NOT read
// window.OS_DATA.STARTUPS.

import React from "react";
import { getThreeReviewers, getReviewerWeight, revInitials } from "../helpers/adminHelpers";

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

export function ComparativeReviewModel({ startup }) {
  const s = startup;
  if (!s || !s.rev) return null;

  const reviewers = getThreeReviewers(s);
  if (reviewers.length === 0) return null;

  const maxWeight = Math.max(...reviewers.map(r => getReviewerWeight(r.name)));
  const primaryReviewer = reviewers.find(r => {
    const w = getReviewerWeight(r.name);
    return w > 1.0 && w === maxWeight;
  });

  return (
    <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="cem-kicker">&sect; Reviewer Evaluation</span>
        <h3 className="cem-title">Human Reviewers Consensus</h3>
      </div>

      <div className="rv-grid">
        {reviewers.map((r, i) => {
          const isPrimary = primaryReviewer && r.name === primaryReviewer.name;
          const weight = getReviewerWeight(r.name);
          return (
            <div key={i} className={"rv-card" + (isPrimary ? " is-primary" : "")}>
              <div className="rv-card-head">
                <div className="rv-card-id">
                  <ReviewerAvatar name={r.name} size={38} primary={isPrimary} />
                  <div style={{ minWidth: 0 }}>
                    <div className="rv-card-name">{r.name}</div>
                    <div className="rv-card-role">{isPrimary ? `Primary · weight ${weight.toFixed(0)}` : `Reviewer · weight ${weight.toFixed(0)}`}</div>
                  </div>
                </div>
                <span className={`os-chip ${r.reco === 'yes' ? 'green' : (r.reco === 'maybe' ? 'amber' : 'red')}`} style={{ flexShrink: 0 }}>
                  {(r.reco || 'maybe').toUpperCase()}
                </span>
              </div>

              <div className="rv-overall">
                <span className="rv-overall-label">Overall rating</span>
                <span className="rv-overall-num">{r.overall != null ? r.overall.toFixed(1) : '—'}</span>
              </div>

              <div className="rv-scores">
                {CRITERIA.map((m, j) => {
                  const val = r[m.key];
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
                <p className="rv-note-text">{r.notes}</p>
              </div>

              <div className="rv-flags">
                <span className="rv-block-label">Flags raised ({r.flags.length})</span>
                {r.flags.length > 0 ? (
                  <div className="rv-flag-list">
                    {r.flags.map((f, idx) => (
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
    </div>
  );
}
