// AdminGate2 — ported verbatim from admin-2.jsx:
//   AdminGate2 (tab controller), JuryGateStack, JuryGateInterviews,
//   JuryGateBatchDecision, JuryGateHistory, applyJuryGateDecision.
//
// VISUAL PREVIEW — no backend (deferred).
// All data comes from local React state seeded from _juryMock.
// No adminPlatformApi, no persistOSData, no window.OS_DATA reads.

import React from "react";
import { PageHead, Chip, FlagDot } from "../shell/osAtoms";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";
import { ComparativeReviewModel } from "./ComparativeReviewModel";
import { calculateWeightedReviewerAverage } from "../helpers/adminHelpers";
import { STARTUPS as MOCK_STARTUPS, JURY as MOCK_JURY } from "./_juryMock";

// ─── local copy of applyJuryGateDecision ─────────────────────────────────────
// Mutates a startup object in local state (no persistOSData).
function applyJuryGateDecision(st, decision, note) {
  if (!st) return;
  const d = (decision || '').toLowerCase();
  if (d === 'approve' || d === 'approved') {
    st.chip = 'ACCEPTED';
    st.adminDecision = 'APPROVED';
  } else if (d === 'waitlist' || d === 'waitlisted' || d === 'hold') {
    st.chip = 'WAITLISTED';
    st.adminDecision = 'WAITLISTED';
  } else if (d === 'reject' || d === 'rejected') {
    st.chip = 'REJECTED';
    st.adminDecision = 'REJECTED';
  }
  if (note != null && note !== '') st.adminRationale = note;
  // no persistOSData — local state only
}

// ─── jury metric helpers (verbatim from prototype) ───────────────────────────
const globalGetJuryMetricScore = (scores, key, startupId) => {
  let val = scores ? scores[key] : null;
  if (val == null || val < 5) {
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + key.charCodeAt(0) + 12;
    val = 5.0 + (seed % 45) * 0.1;
  }
  return parseFloat(val.toFixed(1));
};

const globalGetJuryAvg = (st, jury) => {
  if (!st.jury) return 0;
  const allJury = jury || [];
  const assigned = allJury.filter(j => st.juryAssigned && st.juryAssigned.includes(j.id));
  const list = assigned.length > 0 ? assigned : [{ id: 'j0', name: 'Jury Panel' }];
  let sum = 0;
  list.forEach((j, ji) => {
    const scores = ji === 0 ? st.jury : (st.juryScores && st.juryScores[j.id]) || st.jury;
    sum += globalGetJuryMetricScore(scores, 'problem', st.id);
    sum += globalGetJuryMetricScore(scores, 'solution', st.id);
    sum += globalGetJuryMetricScore(scores, 'tech', st.id);
    sum += globalGetJuryMetricScore(scores, 'founders', st.id);
    sum += globalGetJuryMetricScore(scores, 'commit', st.id);
  });
  return sum / (list.length * 5);
};

// ─── JuryGateStack (Variant A) ────────────────────────────────────────────────
function JuryGateStack({ startups, jury, setStartups, goDetail }) {
  const items = startups.filter(s => {
    const c = (s.chip || '').toUpperCase();
    return c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
  });

  const [idx, setIdx] = React.useState(0);
  const [decisions, setDecisions] = React.useState(() => {
    const init = {};
    items.forEach(it => {
      const ad = (it.adminDecision || '').toUpperCase();
      if (ad === 'APPROVED' || it.chip === 'ACCEPTED') init[it.id] = 'approve';
      else if (ad === 'WAITLISTED' || it.chip === 'WAITLISTED') init[it.id] = 'waitlist';
      else if (ad === 'REJECTED' || it.chip === 'REJECTED') init[it.id] = 'reject';
    });
    return init;
  });
  const [notes, setNotes] = React.useState({});

  if (items.length === 0) {
    return (
      <div className="os-card" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-soft)' }}>
        No shortlisted startups available for Final Gate evaluation.
      </div>
    );
  }

  const s = items[idx] || items[0];

  const decide = (d) => {
    setDecisions({ ...decisions, [s.id]: d });
    // mutate local state copy
    const updated = startups.map(x => {
      if (x.id !== s.id) return x;
      const copy = { ...x };
      applyJuryGateDecision(copy, d, notes[s.id]);
      return copy;
    });
    setStartups(updated);
    if (idx < items.length - 1) setTimeout(() => setIdx(idx + 1), 200);
  };
  const decided = Object.keys(decisions).length;

  const counts = { approve: 0, waitlist: 0, reject: 0 };
  Object.values(decisions).forEach(d => { if (counts[d] !== undefined) counts[d]++; });

  const getJuryMetricScore = (scores, key, startupId) => globalGetJuryMetricScore(scores, key, startupId);

  const getJuryMetricComment = (jId, metricKey, startupId) => {
    const comments = {
      problem: [
        "Highly lucrative market size with strong, immediate customer pain points.",
        "Demonstrates clear expansion path and high customer lifetime value.",
        "Massive addressable market with high growth potential in the target sector.",
        "Addresses a critical market gap with a highly scalable business model."
      ],
      solution: [
        "Completeness of execution is top-notch; solves the user flow end-to-end.",
        "Very thoughtful solution design with a highly intuitive user interface.",
        "Demonstrates excellent integration capabilities and operational efficiency.",
        "Deep understanding of technical requirements and edge cases."
      ],
      tech: [
        "Strong proprietary algorithms and technical moats to fend off copycats.",
        "Good defensibility with early IP generation and deep tech integration.",
        "Hard-to-replicate hardware-software stack with solid first-mover advantage.",
        "Deep technical barriers to entry and strong patent potential."
      ],
      founders: [
        "Aligned perfectly with the core cohort strategy and technical mandates.",
        "Excellent match for our cohort network, resources, and technical support.",
        "Team displays high coachability and matches our program goals precisely.",
        "Perfect incubation fit; can leverage our strategic partner ecosystem."
      ],
      commit: [
        "Full-time commitment verified; founders are completely dedicated.",
        "High availability and willingness to pivot core competencies as needed.",
        "Demonstrated intense dedication during the preliminary validation phases.",
        "Strong long-term dedication to building a lasting venture."
      ]
    };
    const arr = comments[metricKey] || ["Good performance and solid metrics."];
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + (jId || '').charCodeAt((jId || '').length - 1) + metricKey.charCodeAt(0);
    return arr[seed % arr.length];
  };

  const getJuryAvg = (st) => globalGetJuryAvg(st, jury);

  const getCombined = (st) => {
    const rScore = calculateWeightedReviewerAverage(st, 'overall');
    const jScore = getJuryAvg(st);
    if (rScore > 0 && jScore > 0) return (rScore + jScore) / 2;
    return rScore > 0 ? rScore : jScore;
  };

  const getJuryReco = (scores, jId, startupId) => {
    if (scores && scores.reco) return scores.reco;
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + (jId || '').charCodeAt((jId || '').length - 1);
    const recos = ['yes', 'maybe', 'interview', 'no'];
    return recos[seed % recos.length];
  };

  const TIR_METRICS = [
    { key: 'problem', label: 'Problem Statement Impact and Importance' },
    { key: 'solution', label: 'Completeness, Depth of Solution' },
    { key: 'tech', label: 'Technical Depth' },
    { key: 'founders', label: 'Professional Profile of Founder' },
    { key: 'commit', label: 'Commitment to be fully available' }
  ];

  const getTIRSignalScore = (st, key) => {
    if (st.tirSignals && st.tirSignals[key] != null) return st.tirSignals[key];
    const seed = st.id.charCodeAt(st.id.length - 1) + key.charCodeAt(0) + key.charCodeAt(key.length - 1);
    return parseFloat((6.0 + (seed % 36) * 0.1).toFixed(1));
  };

  const getTIRSignalOverall = (st) => {
    const sum = TIR_METRICS.reduce((acc, m) => acc + getTIRSignalScore(st, m.key), 0);
    return parseFloat((sum / TIR_METRICS.length).toFixed(2));
  };

  const isInterviewRequested = s.jury && (s.jury.reco === 'interview' || s.jury.reco === 'maybe' || s.jury.reco === 'yes');

  return (
    <div>
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT A · STATUS</span>
          <span className="os-text-soft">Decide final cohort accepted/waitlisted startups one at a time.</span>
        </div>
        <span className="os-mono os-text-sm">{decided} / {items.length} decided</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 280px))', gap: 14, marginBottom: 24 }}>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Shortlisted Startups</span>
          <span className="gate-kpi-num">{items.length}</span>
          <span className="gate-kpi-sub">Ready for final gate decision</span>
        </div>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Cohort Onboarding</span>
          <div style={{ display: 'flex', gap: 26, marginTop: 8 }}>
            {[['Approve', counts.approve, '#2F6F62'], ['Waitlist', counts.waitlist, '#FFB703'], ['Reject', counts.reject, '#FF5A5F']].map(([label, n, c]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 400, lineHeight: 1, color: 'var(--ink)' }}>{n}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />{label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        <div className="os-card">
          <div className="os-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="os-row gap-sm" style={{ flexWrap: 'wrap' }}>
              <span className="os-mono os-text-xs os-text-dim">{idx + 1}/{items.length}</span>
              <FlagDot tone={s.flag} />
              <span style={{ fontSize: 22, fontFamily: 'var(--font-serif)' }}>{s.name}</span>
              <span className="os-chip">{s.domain}</span>
              <span className="os-chip">{s.stage}</span>
              {isInterviewRequested && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
                  color: '#fff', border: 'none', borderRadius: 4,
                  fontWeight: 700, fontSize: 11, padding: '3px 10px',
                  letterSpacing: '0.04em', boxShadow: '0 0 0 3px #c4b5fd55'
                }}>Interview requested</span>
              )}
              {s.interviewCompleted && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#eef5f1', color: '#2F6F62',
                  border: '1.5px solid #2F6F62', borderRadius: 4,
                  fontWeight: 700, fontSize: 11, padding: '3px 10px'
                }}>Interviewed</span>
              )}
            </div>
            <div className="os-row gap-sm">
              {goDetail && (
                <button className="os-btn sm secondary" onClick={() => goDetail(s.id)}>View App &rarr;</button>
              )}
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.max(0, idx - 1))}>&larr; Prev</button>
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.min(items.length - 1, idx + 1))}>Next &rarr;</button>
            </div>
          </div>
          <div style={{ padding: '0 0 20px 0' }}>
            <ComparativeReviewModel startup={s} />
            {/* Jury Scorecard */}
            {s.jury && (() => {
              let assigned = jury.filter(j => s.juryAssigned && s.juryAssigned.includes(j.id));
              if (assigned.length === 0) assigned = jury.slice(0, 2);
              if (assigned.length === 1) assigned = [...assigned, jury.find(j => j.id !== assigned[0].id) || { id: 'jx', name: 'Jury Member 2', org: '' }];
              assigned = assigned.slice(0, 2);

              const jMetrics = [
                { key: 'problem', label: 'Problem statement' },
                { key: 'solution', label: 'Solution depth' },
                { key: 'tech', label: 'Technical depth' },
                { key: 'founders', label: 'Founder profile' },
                { key: 'commit', label: 'Commitment' }
              ];
              const recoLabel = {
                yes: 'Approve', approve: 'Approve',
                no: 'Pass', pass: 'Pass', reject: 'Pass',
                maybe: 'Hold', waitlist: 'Hold',
                interview: 'Interview'
              };
              const isUnderInterview = (s.chip === 'JURY REVIEW' || (s.jury && s.jury.reco === 'interview')) && !s.interviewCompleted;
              return (
                <div style={{ marginTop: 24 }}>
                  {isUnderInterview && (
                    <div className="os-banner amber" style={{ borderRadius: 2, marginBottom: 16 }}>
                      <div>
                        <div className="os-banner-title" style={{ color: '#9a6206' }}>Interview requested</div>
                        <div className="os-banner-text" style={{ fontSize: 13 }}>This application is under interview review process.</div>
                      </div>
                    </div>
                  )}
                  <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                      <span className="cem-kicker">&sect; Jury Evaluation</span>
                      <h3 className="cem-title">Final Jury Panel</h3>
                    </div>
                    <div className="rv-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      {assigned.map((j, ji) => {
                        const scores = ji === 0 ? s.jury : (s.juryScores && s.juryScores[j.id]) || s.jury;
                        const pVal = getJuryMetricScore(scores, 'problem', s.id);
                        const sVal = getJuryMetricScore(scores, 'solution', s.id);
                        const tVal = getJuryMetricScore(scores, 'tech', s.id);
                        const fVal = getJuryMetricScore(scores, 'founders', s.id);
                        const cVal = getJuryMetricScore(scores, 'commit', s.id);
                        const avg = (pVal + sVal + tVal + fVal + cVal) / 5;
                        const initials = j.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                        const isReqJury = s.juryRequestedBy && s.juryRequestedBy.includes(j.name);
                        const isInterviewer = (s.juryRequestedBy && s.juryRequestedBy.includes(j.name)) || (ji === 0);
                        const hasConducted = s.interviewCompleted && isInterviewer;
                        const isPrimary = hasConducted;

                        const jReco = getJuryReco(scores, j.id, s.id).toLowerCase();
                        const recoTone = (jReco === 'yes' || jReco === 'approve') ? 'green'
                          : (jReco === 'no' || jReco === 'pass' || jReco === 'reject') ? 'red'
                            : (jReco === 'interview') ? 'blue' : 'amber';
                        const badgeLabel = recoLabel[jReco] || jReco;
                        const juryNote = (scores && scores.notes) || (
                          (jReco === 'yes' || jReco === 'approve') ? 'Strong overall candidate — recommend advancing to the cohort.'
                            : (jReco === 'interview') ? 'Promising profile; recommend an interview to confirm execution capability.'
                              : (jReco === 'no' || jReco === 'pass' || jReco === 'reject') ? 'Not convinced this is the right fit for the cohort at this stage.'
                                : 'Solid potential; a few areas need further validation before a firm decision.'
                        );
                        const juryFlags = s.flags && hasConducted ? s.flags : [];

                        return (
                          <div key={j.id} className={"rv-card" + (isPrimary ? " is-primary" : "")}>
                            <div className="rv-card-head">
                              <div className="rv-card-id">
                                <span className="os-avatar" style={{ width: 38, height: 38, fontSize: 15, flexShrink: 0, background: isPrimary ? 'var(--brand-violet)' : 'var(--accent-soft)', color: isPrimary ? '#fff' : 'var(--artblue)' }}>{initials}</span>
                                <div style={{ minWidth: 0 }}>
                                  <div className="rv-card-name">{j.name}</div>
                                  <div className="rv-card-role">{j.org || 'Jury member'}</div>
                                </div>
                              </div>
                              <span className={`os-chip ${recoTone}`} style={{ flexShrink: 0 }}>{(badgeLabel || '').toUpperCase()}</span>
                            </div>

                            <div>
                              {hasConducted
                                ? <span className="os-chip green" style={{ fontSize: 10 }}>&#10003; Conducted interview</span>
                                : isReqJury
                                  ? <span className="os-chip purple" style={{ fontSize: 10 }}>Requested interview</span>
                                  : <span className="os-chip slate" style={{ fontSize: 10 }}>Panel evaluation</span>}
                            </div>

                            <div className="rv-overall">
                              <span className="rv-overall-label">Overall rating</span>
                              <span className="rv-overall-num">{avg > 0 ? avg.toFixed(1) : '—'}</span>
                            </div>

                            <div className="rv-scores">
                              {jMetrics.map(m => {
                                const val = getJuryMetricScore(scores, m.key, s.id);
                                const comment = getJuryMetricComment(j.id, m.key, s.id);
                                return (
                                  <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <div className="rv-score">
                                      <span className="rv-score-label">{m.label}</span>
                                      <span className="rv-bar"><span className="rv-bar-fill" style={{ width: Math.max(0, Math.min(100, (val || 0) * 10)) + '%' }} /></span>
                                      <span className="rv-score-num">{val != null ? val.toFixed(1) : '—'}</span>
                                    </div>
                                    {comment && <p className="rv-note-text" style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>"{comment}"</p>}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="rv-note">
                              <span className="rv-block-label">Jury note</span>
                              <p className="rv-note-text">{juryNote}</p>
                            </div>

                            <div className="rv-flags">
                              <span className="rv-block-label">Flags raised ({juryFlags.length})</span>
                              {juryFlags.length > 0 ? (
                                <div className="rv-flag-list">
                                  {juryFlags.map((f, fi) => (
                                    <div className="rv-flag" key={fi}><span className="rv-flag-mark">⚑</span><span>{f}</span></div>
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
                </div>
              );
            })()}

            {/* TIR Signal Profile Card */}
            {(() => {
              const tirOverall = TIR_METRICS.reduce((acc, m) => acc + getTIRSignalScore(s, m.key), 0) / TIR_METRICS.length;
              return (
                <div className="os-card" style={{ marginTop: 24, borderLeft: '4px solid #1f0a8a' }}>
                  <div className="os-card-title os-mb-sm" style={{ color: '#1f0a8a' }}>TIR Signal Profile</div>
                  <div className="os-stack gap-sm">
                    {TIR_METRICS.map(m => {
                      const tirVal = getTIRSignalScore(s, m.key);
                      return (
                        <div key={m.key}>
                          <div className="os-row between os-text-sm">
                            <span className="os-text-soft" style={{ fontSize: 12.5 }}>{m.label}</span>
                            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{tirVal.toFixed(1)}</span>
                          </div>
                          <div style={{ height: 6, background: '#eef0f4', borderRadius: 999, overflow: 'hidden', marginTop: 5 }}>
                            <div style={{ width: (tirVal * 10) + '%', height: '100%', background: '#1f0a8a', borderRadius: 999 }} />
                          </div>
                        </div>
                      );
                    })}
                    <hr className="os-divider" style={{ margin: '8px 0' }} />
                    <div className="os-row between">
                      <span className="os-text-xs os-text-dim os-uppercase" style={{ color: '#1f0a8a' }}>TIR Overall</span>
                      <span className="os-num-big" style={{ fontSize: 24, fontFamily: 'var(--font-sans)', fontWeight: 800, color: '#1f0a8a' }}>{tirOverall.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="os-stack">
          {s.interviewCompleted && s.juryInterviewRemarks && (
            <div className="os-card" style={{ background: '#eef5f1', borderLeft: '4px solid #2F6F62' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#2F6F62', letterSpacing: '0.1em', marginBottom: 6 }}>
                Jury Interview Remarks
              </div>
              <div style={{ fontSize: 13.5, fontStyle: 'italic', color: 'var(--ink)', lineHeight: 1.5 }}>
                "{s.juryInterviewRemarks}"
              </div>
            </div>
          )}

          <div className="os-card" style={{ background: 'var(--artlight)', border: '1px solid transparent' }}>
            <div className="os-row between" style={{ alignItems: 'center', marginBottom: 12 }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: '0.12em', color: 'var(--artblue)' }}>Reviewer Score</span>
              <span className="os-num-big" style={{ fontSize: 22, fontWeight: 600, color: 'var(--artblue)' }}>
                {s.rev ? calculateWeightedReviewerAverage(s, 'overall').toFixed(2) : '—'}
              </span>
            </div>
            <div className="os-row between" style={{ alignItems: 'center', marginBottom: 12 }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: '0.12em', color: 'var(--accent)' }}>Jury Avg Score</span>
              <span className="os-num-big" style={{ fontSize: 22, fontWeight: 600, color: 'var(--accent)' }}>
                {getJuryAvg(s) > 0 ? getJuryAvg(s).toFixed(2) : '—'}
              </span>
            </div>
            <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0' }} />
            <div className="os-row between" style={{ alignItems: 'center' }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 700, letterSpacing: '0.12em', color: 'var(--ink)' }}>Combined Score</span>
              <span className="os-num-big" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
                {getCombined(s) > 0 ? getCombined(s).toFixed(2) : '—'}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Decision</div>
            <div className="os-reco-group">
              <button className={'os-reco-btn approve ' + (decisions[s.id] === 'approve' ? 'active' : '')} onClick={() => decide('approve')}>Cohort</button>
              <button className={'os-reco-btn waitlist ' + (decisions[s.id] === 'waitlist' ? 'active' : '')} onClick={() => decide('waitlist')}>Waitlist</button>
              <button className={'os-reco-btn reject ' + (decisions[s.id] === 'reject' ? 'active' : '')} onClick={() => decide('reject')}>Reject</button>
            </div>
            <textarea
              className="os-input os-w-100 os-mt" rows="3" placeholder="Decision rationale (optional)…"
              value={notes[s.id] || ''}
              onChange={e => setNotes({ ...notes, [s.id]: e.target.value })}
            />
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Progress</div>
            <div className="os-row gap-sm" style={{ flexWrap: 'wrap' }}>
              {items.map((it, i) => {
                const dec = decisions[it.id];
                const t = dec === 'approve' ? { bg: '#eef5f1', fg: '#2F6F62', bd: '#bcd7cd' }
                  : dec === 'reject' ? { bg: '#fff0f0', fg: '#d23b40', bd: '#f8c2c4' }
                    : dec === 'waitlist' ? { bg: '#fff8e6', fg: '#9a6206', bd: '#f6d98a' }
                      : { bg: 'var(--bg-soft)', fg: 'var(--ink-dim)', bd: 'var(--line)' };
                const itReq = it.jury && (it.jury.reco === 'interview' || it.jury.reco === 'maybe' || it.jury.reco === 'yes');
                return (
                  <div key={i} onClick={() => setIdx(i)}
                    style={{
                      width: 26, height: 26, borderRadius: 6, display: 'grid', placeItems: 'center',
                      background: t.bg, color: t.fg, border: '1px solid ' + t.bd,
                      fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      outline: i === idx ? '2px solid var(--accent)' : 'none', outlineOffset: 1,
                      position: 'relative'
                    }}>
                    {i + 1}
                    {itReq && (
                      <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#6366f1', border: '1.5px solid #fff' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── JuryGateInterviews (Variant B) ───────────────────────────────────────────
function JuryGateInterviews({ startups, jury, setStartups, goDetail }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  const items = startups.filter(s => {
    const c = (s.chip || '').toUpperCase();
    const isJuryStage = c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
    const isInterviewReco = s.jury && (s.jury.reco === 'interview' || s.interviewRequested === true);
    return isJuryStage || isInterviewReco;
  });

  const getAssignedJuries = (st) => jury.filter(j => j.startups && j.startups.includes(st.id));

  const getJuriesWhoRequested = (st, assigned) => {
    if (!st.jury) return [];
    if (st.juryRequestedBy) return st.juryRequestedBy;
    if ((st.jury.reco === 'interview' || st.jury.reco === 'maybe' || st.jury.reco === 'yes') && assigned.length > 0) {
      return [assigned[0].name];
    }
    return [];
  };

  const getSimulatedJuryRemarks = (st) => {
    if (st.juryInterviewRemarks) return st.juryInterviewRemarks;
    const assigned = getAssignedJuries(st);
    const juryNames = assigned.map(j => j.name).join(' & ') || 'Jury Panel';
    const templates = [
      `Strong technical foundation. The team demonstrated deep understanding of their market. Recommend acceptance.`,
      `Excellent presentation by the founder. Defensibility is clear, but business model needs refinement.`,
      `Good progress, but market size might be a constraint. Calibrated well on fit.`,
      `Highly innovative product. The tech stack is mature, and they have solid IP potential.`
    ];
    const ti = st.id.charCodeAt(st.id.length - 1) % templates.length;
    return `[${juryNames}]: ${templates[ti]}`;
  };

  const handleSendCalendly = (s) => {
    setStartups(prev => prev.map(x => {
      if (x.id !== s.id) return x;
      return {
        ...x,
        calendlySent: true,
        calendlySentAt: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        chip: 'JURY REVIEW',
      };
    }));
    window.alert(`Email sent to founder of ${s.name} containing booking link (${s.interviewCalendarLink || 'https://calendly.com/artpark/cohort-interview'}).`);
    forceUpdate();
  };

  const handleDecision = (s, value) => {
    setStartups(prev => prev.map(x => {
      if (x.id !== s.id) return x;
      const copy = { ...x };
      if (value === 'ACCEPT') { copy.chip = 'ACCEPTED'; copy.adminDecision = 'APPROVED'; }
      else if (value === 'WAITLIST') { copy.chip = 'WAITLISTED'; copy.adminDecision = 'WAITLISTED'; }
      else if (value === 'REJECT') { copy.chip = 'REJECTED'; copy.adminDecision = 'REJECTED'; }
      else { copy.chip = 'JURY REVIEW'; copy.adminDecision = 'PENDING'; }
      return copy;
    }));
    forceUpdate();
  };

  const handleDateChange = (s, value) => {
    setStartups(prev => prev.map(x => x.id !== s.id ? x : { ...x, interviewDateTime: value }));
    forceUpdate();
  };

  const handleInterviewDone = (s, checked) => {
    setStartups(prev => prev.map(x => {
      if (x.id !== s.id) return x;
      return { ...x, interviewCompleted: checked, chip: checked ? 'JURY REVIEW' : x.chip };
    }));
    forceUpdate();
  };

  const handleLinkBlur = (s, value) => {
    setStartups(prev => prev.map(x => x.id !== s.id ? x : { ...x, interviewCalendarLink: value }));
  };

  const handleRemarksBlur = (s, value) => {
    setStartups(prev => prev.map(x => x.id !== s.id ? x : { ...x, juryInterviewRemarks: value }));
  };

  return (
    <div>
      <div className="os-row between os-mb" style={{ marginBottom: 20 }}>
        <div className="os-row gap-sm">
          <span className="os-chip purple">VARIANT B · INTERVIEWS</span>
          <span className="os-text-soft">Manage booking invites, input remarks, and finalize selections.</span>
        </div>
      </div>

      <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-soft)', borderRadius: 4, fontSize: 13, borderLeft: '4px solid var(--accent)' }}>
        <strong>Note:</strong> These applications have received explicit requests for interviews from the Jury. Below, you can track which jury members are deciding on each application, who requested the interview, schedule the date/time, send the booking invite link, and finalize decisions.
      </div>

      <div className="os-card" style={{ padding: 24 }}>
        <table className="os-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>Startup & Deciding Jury</th>
              <th style={{ width: '25%' }}>Booking Invite Link</th>
              <th style={{ width: '22%' }}>Interview Schedule</th>
              <th style={{ width: '28%' }}>Jury Remarks & Decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map(s => {
              const assigned = getAssignedJuries(s);
              const juryNamesStr = assigned.length > 0 ? assigned.map(j => j.name).join(', ') : 'No jury assigned';
              const requestedJuries = getJuriesWhoRequested(s, assigned);
              const requestedJuriesStr = requestedJuries.length > 0 ? requestedJuries.join(', ') : 'External Jury';

              return (
                <tr key={s.id} style={{ background: s.interviewCompleted ? 'rgba(47, 111, 98, 0.08)' : 'none', transition: 'background 0.3s ease' }}>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{s.domain} · {s.stage}</div>
                      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span style={{ fontWeight: 600 }}>Deciding:</span> {juryNamesStr}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span style={{ fontWeight: 600 }}>Requested by:</span> <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{requestedJuriesStr}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        {goDetail && <button className="os-btn xs secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => goDetail(s.id)}>View App</button>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        type="text"
                        className="os-input sm"
                        style={{ fontSize: 11, padding: '4px 6px', width: '100%' }}
                        placeholder="Invite link (e.g. Calendly)..."
                        defaultValue={s.interviewCalendarLink || 'https://calendly.com/artpark/cohort-interview'}
                        onBlur={e => handleLinkBlur(s, e.target.value)}
                      />
                      {s.calendlySent ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F6F62' }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#2F6F62' }}>Sent {s.calendlySentAt}</span>
                          </div>
                          <button className="os-btn sm secondary" style={{ fontSize: 10, padding: '2px 8px', marginTop: 2 }} onClick={() => handleSendCalendly(s)}>
                            Re-send Invite
                          </button>
                        </>
                      ) : (
                        <button className="os-btn sm" style={{ fontSize: 11, padding: '4px 10px', background: 'var(--accent)', color: '#fff', alignSelf: 'flex-start' }} onClick={() => handleSendCalendly(s)}>
                          Send invite link
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        type="datetime-local"
                        className="os-input sm"
                        style={{ fontSize: 11, padding: '4px 6px', width: '100%' }}
                        value={s.interviewDateTime || ''}
                        onChange={e => handleDateChange(s, e.target.value)}
                      />
                      {s.interviewDateTime && (
                        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--ink-soft)' }}>
                          Scheduled: {new Date(s.interviewDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                      <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={!!s.interviewCompleted}
                          onChange={e => handleInterviewDone(s, e.target.checked)}
                        />
                        <span style={{ fontWeight: 600 }}>Interview Done</span>
                      </label>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {s.interviewCompleted ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)' }}>Jury remarks · editable</span>
                          <textarea
                            className="os-input"
                            style={{ fontSize: 12, padding: '6px 8px', width: '100%', minHeight: 58, lineHeight: 1.5, resize: 'vertical' }}
                            defaultValue={getSimulatedJuryRemarks(s)}
                            placeholder="Record the jury's interview remarks…"
                            onBlur={e => handleRemarksBlur(s, e.target.value)}
                          />
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--ink-dim)', fontStyle: 'italic' }}>
                          Pending interview completion...
                        </div>
                      )}
                      <div className="os-row gap-xs" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                        <button className={`os-btn sm ${s.chip === 'ACCEPTED' ? 'green' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'ACCEPT')}>Accept</button>
                        <button className={`os-btn sm ${s.chip === 'WAITLISTED' ? 'amber' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'WAITLIST')}>Waitlist</button>
                        <button className={`os-btn sm ${s.chip === 'REJECTED' ? 'red' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'REJECT')}>Reject</button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── JuryGateBatchDecision (Variant C) ────────────────────────────────────────
function JuryGateBatchDecision({ startups, jury, setStartups }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  const pendingStartups = startups.filter(s => {
    const c = (s.chip || '').toUpperCase();
    return (c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'WAITLISTED') && s.adminDecision !== 'APPROVED' && s.adminDecision !== 'REJECTED';
  });

  const [draftDecisions, setDraftDecisions] = React.useState({});

  const handleDraftSelect = (id, dec) => {
    setDraftDecisions(prev => ({ ...prev, [id]: dec }));
  };

  const handlePushDecisions = () => {
    const selectedToPush = pendingStartups.filter(s => draftDecisions[s.id]);
    if (selectedToPush.length === 0) return;

    const listText = selectedToPush.map(s => `• ${s.name} → ${draftDecisions[s.id]}`).join('\n');
    const confirmed = window.confirm(`You are about to push final gate decisions for ${selectedToPush.length} startup(s):\n\n${listText}\n\nAre you sure you want to finalize these decisions?`);

    if (confirmed) {
      setStartups(prev => prev.map(x => {
        const dec = draftDecisions[x.id];
        if (!dec) return x;
        const copy = { ...x };
        if (dec === 'ACCEPT') { copy.chip = 'ACCEPTED'; copy.adminDecision = 'APPROVED'; }
        else if (dec === 'WAITLIST') { copy.chip = 'WAITLISTED'; copy.adminDecision = 'WAITLISTED'; }
        else if (dec === 'REJECT') { copy.chip = 'REJECTED'; copy.adminDecision = 'REJECTED'; }
        return copy;
      }));

      const remainingDrafts = { ...draftDecisions };
      selectedToPush.forEach(s => { delete remainingDrafts[s.id]; });
      setDraftDecisions(remainingDrafts);
      alert(`Successfully pushed final decisions for ${selectedToPush.length} application(s).`);
      forceUpdate();
    }
  };

  const getJuryAvg = (st) => globalGetJuryAvg(st, jury);
  const countPushed = pendingStartups.filter(s => draftDecisions[s.id]).length;

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">BATCH DECISIONS</span>
          <div className="os-text-soft" style={{ fontSize: 13, marginTop: 4 }}>Apply decisions to multiple applications at once.</div>
        </div>
      </div>

      <div className="os-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
            Showing <strong>{pendingStartups.length}</strong> applications pending final decision.
          </div>
          <button
            className="os-btn"
            style={{ background: countPushed > 0 ? 'var(--accent)' : 'var(--line)', borderColor: countPushed > 0 ? 'var(--accent)' : 'var(--line)', color: countPushed > 0 ? '#fff' : 'var(--ink-dim)', cursor: countPushed > 0 ? 'pointer' : 'not-allowed' }}
            disabled={countPushed === 0}
            onClick={handlePushDecisions}
          >
            Push {countPushed} Decisions
          </button>
        </div>

        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th className="num">Rev Score</th>
              <th className="num">Jury Score</th>
              <th>Jury Reco</th>
              <th>Draft Decision</th>
            </tr>
          </thead>
          <tbody>
            {pendingStartups.map(s => {
              const rScore = s.rev ? (s.rev.overall || 0) : 0;
              const jScore = getJuryAvg(s);
              const jReco = s.jury ? (s.jury.reco || 'maybe') : 'none';
              const draft = draftDecisions[s.id] || '';

              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{s.domain} · {s.stage}</div>
                  </td>
                  <td className="num">{rScore > 0 ? rScore.toFixed(1) : '—'}</td>
                  <td className="num">{jScore > 0 ? jScore.toFixed(1) : '—'}</td>
                  <td>
                    <Chip tone={jReco === 'approve' || jReco === 'yes' ? 'green' : jReco === 'reject' || jReco === 'no' ? 'red' : 'amber'}>
                      {jReco.toUpperCase()}
                    </Chip>
                  </td>
                  <td>
                    <div className="os-row gap-xs">
                      <button
                        className={`os-btn sm ${draft === 'ACCEPT' ? 'green' : 'secondary ghost'}`}
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'ACCEPT' ? null : 'ACCEPT')}
                      >
                        Accept
                      </button>
                      <button
                        className={`os-btn sm ${draft === 'WAITLIST' ? 'amber' : 'secondary ghost'}`}
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'WAITLIST' ? null : 'WAITLIST')}
                      >
                        Waitlist
                      </button>
                      <button
                        className={`os-btn sm ${draft === 'REJECT' ? 'red' : 'secondary ghost'}`}
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'REJECT' ? null : 'REJECT')}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pendingStartups.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: 24, color: 'var(--ink-soft)' }}>
                  All shortlisted startups have finalized decisions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── JuryGateHistory (Variant D) ──────────────────────────────────────────────
function JuryGateHistory({ startups, jury, setStartups, goDetail }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [editingId, setEditingId] = React.useState(null);

  const decidedStartups = startups.filter(s =>
    (s.chip === 'ACCEPTED' || s.chip === 'REJECTED' || s.chip === 'WAITLISTED') && s.adminDecision
  );

  const [sortCol, setSortCol] = React.useState(null);
  const [sortAsc, setSortAsc] = React.useState(true);

  const handleSort = (col) => {
    if (sortCol === col) { setSortAsc(!sortAsc); }
    else { setSortCol(col); setSortAsc(true); }
  };

  const renderHeader = (label, colKey) => {
    const isSorted = sortCol === colKey;
    return (
      <th onClick={() => handleSort(colKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-start', width: '100%' }}>
          {label}
          {isSorted ? (sortAsc ? ' ▲' : ' ▼') : ''}
        </span>
      </th>
    );
  };

  const getJuryAvg = (st) => globalGetJuryAvg(st, jury);
  const getCombined = (st) => {
    const rScore = st.rev ? (st.rev.overall || 0) : 0;
    const jScore = getJuryAvg(st);
    if (rScore > 0 && jScore > 0) return (rScore + jScore) / 2;
    return rScore > 0 ? rScore : jScore;
  };

  const sortedStartups = React.useMemo(() => {
    if (!sortCol) return decidedStartups;
    return [...decidedStartups].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') { valA = a.name || ''; valB = b.name || ''; }
      else if (sortCol === 'sub') { valA = a.sub || ''; valB = b.sub || ''; }
      else if (sortCol === 'rev') { valA = a.rev ? a.rev.overall : -1; valB = b.rev ? b.rev.overall : -1; }
      else if (sortCol === 'jury') { valA = getJuryAvg(a); valB = getJuryAvg(b); }
      else if (sortCol === 'combined') { valA = getCombined(a); valB = getCombined(b); }
      else if (sortCol === 'adminDecision') { valA = a.adminDecision || ''; valB = b.adminDecision || ''; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [decidedStartups, sortCol, sortAsc]);

  const handleSaveDecision = (id, newDec) => {
    setStartups(prev => prev.map(x => {
      if (x.id !== id) return x;
      const copy = { ...x };
      if (newDec === 'APPROVED') { copy.chip = 'ACCEPTED'; copy.adminDecision = 'APPROVED'; }
      else if (newDec === 'REJECTED') { copy.chip = 'REJECTED'; copy.adminDecision = 'REJECTED'; }
      else if (newDec === 'HOLD') { copy.chip = 'WAITLISTED'; copy.adminDecision = 'WAITLISTED'; }
      return copy;
    }));
    setEditingId(null);
    forceUpdate();
  };

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">HISTORY</span>
          <h2 className="lp-section-title">Final Gate decisions history</h2>
          <div className="lp-section-sub">All applications finalized at the cohort selection gate.</div>
        </div>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            {renderHeader('Startup', 'name')}
            {renderHeader('Submitted Date', 'sub')}
            {renderHeader('Reviewer Score', 'rev')}
            {renderHeader('Jury Score', 'jury')}
            {renderHeader('Combined Score', 'combined')}
            {renderHeader('Final Decision', 'adminDecision')}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedStartups.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-dim)', fontSize: 14 }}>
                No decisions recorded in final gate history yet.
              </td>
            </tr>
          ) : (
            sortedStartups.map((s) => {
              const isEditing = editingId === s.id;
              const rScore = s.rev ? (s.rev.overall || 0) : 0;
              const jScore = getJuryAvg(s);
              const combined = getCombined(s);
              const itReq = s.jury && (s.jury.reco === 'interview' || s.jury.reco === 'maybe' || s.jury.reco === 'yes');

              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14 }}>{s.name}</b>
                      {itReq && <span className="os-chip purple" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 'bold' }}>Interview Requested</span>}
                      {s.interviewCompleted && <span className="os-chip green" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 'bold' }}>Interviewed</span>}
                    </div>
                    {s.interviewCompleted && s.juryInterviewRemarks && (
                      <div style={{ fontSize: 10.5, color: '#2F6F62', fontStyle: 'italic', marginTop: 4 }}>
                        Remarks: "{s.juryInterviewRemarks}"
                      </div>
                    )}
                    <div style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.sub || '02 Jun 2026'}</td>
                  <td className="num">{rScore > 0 ? rScore.toFixed(1) : '—'}</td>
                  <td className="num">{jScore > 0 ? jScore.toFixed(1) : '—'}</td>
                  <td className="num"><b>{combined > 0 ? combined.toFixed(1) : '—'}</b></td>
                  <td>
                    {isEditing ? (
                      <div className="os-row gap-xs" style={{ flexWrap: 'nowrap' }}>
                        <button className="os-btn sm green" onClick={() => handleSaveDecision(s.id, 'APPROVED')} style={{ padding: '3px 8px', fontSize: 11 }}>Accept</button>
                        <button className="os-btn sm amber" onClick={() => handleSaveDecision(s.id, 'HOLD')} style={{ padding: '3px 8px', fontSize: 11 }}>Waitlist</button>
                        <button className="os-btn sm red" onClick={() => handleSaveDecision(s.id, 'REJECTED')} style={{ padding: '3px 8px', fontSize: 11 }}>Reject</button>
                      </div>
                    ) : (
                      <Chip tone={s.chip === 'ACCEPTED' ? 'green' : s.chip === 'WAITLISTED' ? 'amber' : 'red'}>
                        {(s.chip || '').toUpperCase()}
                      </Chip>
                    )}
                  </td>
                  <td>
                    <div className="os-row gap-xs">
                      {goDetail && <button className="os-btn sm secondary" onClick={() => goDetail(s.id)}>View App</button>}
                      {!isEditing && (
                        <button className="os-btn sm ghost" onClick={() => setEditingId(s.id)}>Edit</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── AdminGate2 — main tab controller (A-7) ───────────────────────────────────
export function AdminGate2({ goDetail }) {
  const [variant, setVariant] = React.useState('stack');
  // Seed local state from mock — all sub-views share this state so decisions propagate
  const [startups, setStartups] = React.useState(() => MOCK_STARTUPS.map(s => ({ ...s })));
  const jury = MOCK_JURY;

  return (
    <div>
      <PreviewBadge />
      <PageHead
        eyebrow="A-7 · FINAL GATE"
        title='Final <em>Decisions</em>'
        sub="Choose a workflow to finalize cohort onboarding decisions or schedule interviews."
      />
      <div className="os-row gap-sm os-mb-lg" style={{ marginBottom: 24 }}>
        <div className={'os-tab ' + (variant === 'stack' ? 'active' : '')} onClick={() => setVariant('stack')}>A · Status</div>
        <div className={'os-tab ' + (variant === 'interview' ? 'active' : '')} onClick={() => setVariant('interview')}>B · Interview Scheduling</div>
        <div className={'os-tab ' + (variant === 'batch' ? 'active' : '')} onClick={() => setVariant('batch')}>C · Batch decision</div>
        <div className={'os-tab ' + (variant === 'history' ? 'active' : '')} onClick={() => setVariant('history')}>D · My history</div>
      </div>
      {variant === 'stack' && <JuryGateStack startups={startups} jury={jury} setStartups={setStartups} goDetail={goDetail} />}
      {variant === 'interview' && <JuryGateInterviews startups={startups} jury={jury} setStartups={setStartups} goDetail={goDetail} />}
      {variant === 'batch' && <JuryGateBatchDecision startups={startups} jury={jury} setStartups={setStartups} />}
      {variant === 'history' && <JuryGateHistory startups={startups} jury={jury} setStartups={setStartups} goDetail={goDetail} />}
    </div>
  );
}

export default AdminGate2;
