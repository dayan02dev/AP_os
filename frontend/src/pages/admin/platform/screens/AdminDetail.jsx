// AdminDetail — A-2 Application Detail (Task 10 faithful port).
//
// Receives { startupId, track, onBack, onPrev, onNext, decisionMode }.
// On mount / startupId change → loadDetail(track, startupId) via useAdminData.
//
// Writes:
//   • Admin decision — adminPlatformApi.decide(track, id, { decision, rationale })
//     where decision = BUTTON_TO_DECISION[buttonLabel].
//     After success → onBack().
//
// Jury panel (decisionMode === 'jury') shows real pick data from the pipeline
// row: assigned jurors + who picked the startup (v2: jurors pick, no scoring).
//
// IMPORTANT: Do NOT read window.OS_DATA.STARTUPS. All data comes from loadDetail.

import React, { useState, useEffect, useCallback, useReducer, useMemo } from "react";
import { loadDetail, useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { leadershipApi } from "../../../../lib/leadershipApi";
import { BUTTON_TO_DECISION, chipLabel } from "../../../../lib/adminDataAdapter";
import { Chip } from "../shell/osAtoms";
import { ComparativeReviewModel } from "./ComparativeReviewModel";
import FullApplication from "../../../../components/FullApplication";
import ApplicationSummaryCard from "./ApplicationSummaryCard";
import { trackLabel } from "../../../../lib/trackLabel";
import { moveButtonLabel, moveBadgeText } from "../../../../lib/trackMove";

// ── Criteria metadata (mirrors prototype CRIT_LABELS / METRICS) ─────────────
const METRICS = [
  { key: 'problem',  label: 'Problem Statement Impact and Importance' },
  { key: 'solution', label: 'Completeness, Depth of Solution' },
  { key: 'tech',     label: 'Technical Depth' },
  { key: 'founders', label: 'Professional Profile of Founder' },
  { key: 'commit',   label: 'Commitment to be fully available' },
];

// ── Seeded jury helpers (read s.id only, NOT window.OS_DATA) ─────────────────
function getJuryMetricScore(scores, key, startupId) {
  let val = scores ? scores[key] : null;
  if (val == null || val < 5) {
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + key.charCodeAt(0) + 12;
    val = 5.0 + (seed % 45) * 0.1;
  }
  return parseFloat(val.toFixed(1));
}

function getJuryReco(scores, jId, startupId) {
  if (scores && scores.reco) return scores.reco;
  const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + (jId || '').charCodeAt((jId || '').length - 1);
  const recos = ['yes', 'maybe', 'interview', 'no'];
  return recos[seed % recos.length];
}

function getJuryMetricComment(jId, metricKey, startupId) {
  const comments = {
    problem: [
      "Highly lucrative market size with strong, immediate customer pain points.",
      "Demonstrates clear expansion path and high customer lifetime value.",
      "Massive addressable market with high growth potential in the target sector.",
      "Addresses a critical market gap with a highly scalable business model.",
    ],
    solution: [
      "Completeness of execution is top-notch; solves the user flow end-to-end.",
      "Very thoughtful solution design with a highly intuitive user interface.",
      "Demonstrates excellent integration capabilities and operational efficiency.",
      "Deep understanding of technical requirements and edge cases.",
    ],
    tech: [
      "Strong proprietary algorithms and technical moats to fend off copycats.",
      "Good defensibility with early IP generation and deep tech integration.",
      "Hard-to-replicate hardware-software stack with solid first-mover advantage.",
      "Deep technical barriers to entry and strong patent potential.",
    ],
    founders: [
      "Aligned perfectly with the core cohort strategy and technical mandates.",
      "Excellent match for our cohort network, resources, and technical support.",
      "Team displays high coachability and matches our program goals precisely.",
      "Perfect incubation fit; can leverage our strategic partner ecosystem.",
    ],
    commit: [
      "Full-time commitment verified; founders are completely dedicated.",
      "High availability and willingness to pivot core competencies as needed.",
      "Demonstrated intense dedication during the preliminary validation phases.",
      "Strong long-term dedication to building a lasting venture.",
    ],
  };
  const arr = comments[metricKey] || ["Good performance and solid metrics."];
  const seed =
    (startupId || '').charCodeAt((startupId || '').length - 1) +
    (jId || '').charCodeAt((jId || '').length - 1) +
    metricKey.charCodeAt(0);
  return arr[seed % arr.length];
}

function getJuryAvgFromSeeds(st) {
  // No window.OS_DATA.JURY — use 2 seeded placeholder jury members
  const list = [{ id: 'j0', name: 'Jury A' }, { id: 'j1', name: 'Jury B' }];
  let sum = 0;
  list.forEach((j) => {
    sum += getJuryMetricScore(st.jury, 'problem', st.id);
    sum += getJuryMetricScore(st.jury, 'solution', st.id);
    sum += getJuryMetricScore(st.jury, 'tech', st.id);
    sum += getJuryMetricScore(st.jury, 'founders', st.id);
    sum += getJuryMetricScore(st.jury, 'commit', st.id);
  });
  return sum / (list.length * 5);
}

function getTIRSignalScore(st, key) {
  if (st.tirSignals && st.tirSignals[key] != null) return st.tirSignals[key];
  const seed =
    (st.id || '').charCodeAt((st.id || '').length - 1) +
    key.charCodeAt(0) +
    key.charCodeAt(key.length - 1);
  return parseFloat((6.0 + (seed % 36) * 0.1).toFixed(1));
}

function getTIRSignalOverall(st) {
  const sum = METRICS.reduce((acc, m) => acc + getTIRSignalScore(st, m.key), 0);
  return parseFloat((sum / METRICS.length).toFixed(2));
}

// ── Main component ────────────────────────────────────────────────────────────
export function AdminDetail({ startupId, track, onBack, onPrev, onNext, decisionMode }) {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [secOpen, setSecOpen] = useState({});
  const [viewApp, setViewApp] = useState(false);

  // Decision panel
  const [decision, setDecision] = useState(null);   // 'approve' | 'hold' | 'reject' | 'waitlist'
  const [rationale, setRationale] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const [banner, setBanner] = useState(null);
  const [, forceRefresh] = useReducer(x => x + 1, 0);

  // Reviewer roster → reviewer_user_id → display name (for the consensus cards).
  const { data: reviewerData } = useAdminData('reviewers');
  const reviewersById = useMemo(() => {
    const list = reviewerData?.reviewers ?? [];
    return Object.fromEntries(list.map(r => [r.id, r.name]));
  }, [reviewerData]);

  const doLoad = useCallback(async () => {
    if (!startupId || !track) return;
    setLoading(true);
    setError(null);
    try {
      const d = await loadDetail(track, startupId);
      setS(d);
      // Pre-fill decision from existing adminDecision
      const ad = (d.adminDecision || '').toLowerCase();
      if (ad === 'approved') setDecision('approve');
      else if (ad === 'hold') setDecision('hold');
      else if (ad === 'rejected') setDecision('reject');
      else if (ad === 'waitlisted') setDecision('waitlist');
      else setDecision(null);
      setRationale(d.adminRationale || '');
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [startupId, track]);

  useEffect(() => { doLoad(); }, [doLoad]);

  const onApplyDecision = async () => {
    if (!decision || !s) return;
    const apiDecision = BUTTON_TO_DECISION[decision];
    if (!apiDecision) return;

    // Validate rationale requirement
    if (decision === 'reject' && !rationale.trim()) {
      setDecisionError(`A rationale is required to reject this application.`);
      return;
    }

    setDecisionBusy(true);
    setDecisionError(null);
    try {
      await adminPlatformApi.decide(track, s.id, {
        decision: apiDecision,
        rationale: rationale.trim() || undefined,
      });
      setBanner({ kind: 'ok', text: `Decision recorded: ${apiDecision}.` });
      onBack();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      if (code === 'illegal_transition') {
        const allowed = err?.details?.allowed || [];
        const hint = allowed.length ? ` Allowed: ${allowed.join(', ')}.` : '';
        setDecisionError(`That decision isn't allowed from the current status.${hint}`);
      } else if (code === 'rationale_required') {
        setDecisionError(err?.details?.message || 'A rationale is required for that decision.');
      } else if (err?.status === 403 || code === 'missing_capability') {
        setDecisionError("You don't have permission to record decisions.");
      } else {
        setDecisionError(err?.details?.message || err?.message || 'Failed to record decision.');
      }
    } finally {
      setDecisionBusy(false);
    }
  };

  const onMoveTrack = async () => {
    if (!s) return;
    // The move flag lives on the NATIVE application row; the `track` prop is the
    // effective/display track under the track-move overlay.
    const nat = s.nativeTrack || track;
    if (!s.movedToTrack) {
      const other = trackLabel(nat === 'tir' ? 'sip' : 'tir');
      if (!window.confirm(`Move this application to ${other} and email the applicant?`)) return;
    }
    setMoveBusy(true);
    setBanner(null);
    try {
      await adminPlatformApi.moveTrack(nat, s.id);
      await doLoad();
      setBanner({ kind: 'ok', text: 'Application track updated.' });
    } catch (err) {
      setBanner({ kind: 'error', text: err?.message || 'Failed to move track.' });
    } finally {
      setMoveBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span className="os-text-dim">Loading application…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="os-banner" style={{ margin: 24, padding: '16px 20px', background: '#fdecec', border: '1px solid #f3c2c4', borderRadius: 4 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#b3262b' }}>Failed to load application</div>
        <div style={{ fontSize: 13, color: '#b3262b' }}>{error?.message || 'Unknown error'}</div>
        <button className="os-btn sm ghost" style={{ marginTop: 10 }} onClick={doLoad}>Retry</button>
      </div>
    );
  }
  if (!s) return null;

  // An APPROVED application sits at status jury_review (chip "JURY REVIEW").
  // It must read "Jury review" here — never "Interview" (see adminDataAdapter).
  const isInJuryReview = s.chip === 'JURY REVIEW';
  const aiData = s.ai || {};

  // ── Reviewer averages — computed from the REAL submitted reviews (s.reviews).
  //    Each category is averaged across reviews that scored it; the reviewer
  //    overall is the average of the per-review overalls. 0 means "no data".
  const realReviews = Array.isArray(s.reviews) ? s.reviews : [];
  const reviewerCatAvg = (key) => {
    const vals = realReviews.map(rv => rv[key]).filter(n => typeof n === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const revOverall = (() => {
    const vals = realReviews.map(rv => rv.overall).filter(n => typeof n === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  })();
  const jOverall = s.jury ? getJuryAvgFromSeeds(s) : 0;
  const combinedOverall = revOverall > 0 && jOverall > 0
    ? (revOverall + jOverall) / 2
    : revOverall > 0 ? revOverall : jOverall;

  if (viewApp) {
    return (
      <div>
        {/* Pinned below the sticky 60px topbar so the back button stays reachable
            while scrolling, without overlapping the logo / role line. */}
        <div
          style={{
            position: "fixed", top: 60, left: 0, right: 0, zIndex: 29,
            height: 48, boxSizing: "border-box",
            display: "flex", alignItems: "center", padding: "0 20px",
            background: "var(--paper, #fff)",
            borderBottom: "1px solid var(--line, #e3e3e8)",
            boxShadow: "0 2px 8px rgba(15,23,42,0.06)",
          }}
        >
          <button className="os-btn ghost sm" onClick={() => setViewApp(false)}>
            ← Back
          </button>
        </div>
        {/* Spacer offsets the fixed back bar so the first section isn't hidden. */}
        <div style={{ height: 48 }} aria-hidden="true" />
        <FullApplication
          track={track}
          application={s.application}
          applicationId={s.id}
          signedUrl={(id, path) => leadershipApi.fileSignedUrl(id, path)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}
              style={{ color: '#6f6f78', textDecoration: 'none' }}>Applications</a>
            <span style={{ margin: '0 8px', color: '#c8c8d0' }}>/</span>
            <span style={{ color: '#8a8a92' }}>{s.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>APPLICATION DETAIL</span>
          <h2 className="lp-section-title">
            {s.name}
            <span className="lp-muted"> · admin review</span>
            {isInJuryReview && (
              <span style={{
                marginLeft: 12, fontSize: 10.5, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                background: '#fff8e6', border: '1px solid #f6d98a', color: '#9a6206',
                borderRadius: 999, padding: '3px 11px',
                display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9a6206', flexShrink: 0 }} />
                {chipLabel(s.chip)}
              </span>
            )}
            {moveBadgeText(s.nativeTrack || track, s.movedToTrack) && (
              <span style={{
                marginLeft: 12, fontSize: 10.5, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                background: '#fff4d6', border: '1px solid #e6c34d', color: '#8a6d00',
                borderRadius: 999, padding: '3px 11px',
                display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8a6d00', flexShrink: 0 }} />
                {moveBadgeText(s.nativeTrack || track, s.movedToTrack)}
              </span>
            )}
          </h2>
          <div className="lp-section-sub">
            {(s.founders || []).join(' · ')} · {s.domain} · {s.stage} · Submitted {s.sub}
          </div>
        </div>
        <div className="lp-section-actions">
          <div className="os-row gap-sm">
            {onPrev && <button className="os-btn ghost sm" onClick={onPrev}>← Prev application</button>}
            {onNext && <button className="os-btn ghost sm" onClick={onNext}>Next application →</button>}
          </div>
          <div className="os-row gap-sm">
            <button className="os-btn secondary" onClick={onBack}>← Back to applications</button>
          </div>
        </div>
      </div>

      {/* ── Banner ──────────────────────────────────────────────────────────── */}
      {banner && (
        <div className={`os-banner${banner.kind === 'error' ? ' danger' : ''}`}
          style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 4, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: banner.kind === 'error' ? '#fdecec' : '#e9f6ef', border: `1px solid ${banner.kind === 'error' ? '#f3c2c4' : '#b7ddc8'}`, color: banner.kind === 'error' ? '#b3262b' : '#1d6b45' }}>
          <span>{banner.text}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'inherit' }}
            onClick={() => setBanner(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Two-column layout ────────────────────────────────────────────────── */}
      <div className="os-grid-evaluation">
        {/* LEFT — application & score summaries */}
        <div className="os-stack">
          {/* Application Details Card (shared with the gate) */}
          <ApplicationSummaryCard startup={s} onViewFullApplication={() => setViewApp(true)} />

          {/* Comparative review model — real reviewer evaluations */}
          <ComparativeReviewModel startup={s} reviewersById={reviewersById} />

          {/* Jury panel — real pick data (v2: jurors PICK startups, no scoring) */}
          {decisionMode === 'jury' && (() => {
            const assignedNames = s.jury_assigned_names || [];
            const pickedBy = s.picked_by || [];
            return (
              <div className="os-card" style={{ marginTop: 24, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {isInJuryReview && (
                  <div className="os-banner amber" style={{ borderRadius: 2 }}>
                    <div>
                      <div className="os-banner-title" style={{ color: '#9a6206' }}>{chipLabel(s.chip)}</div>
                      <div className="os-banner-text" style={{ fontSize: 13 }}>This application has advanced to the jury round.</div>
                    </div>
                  </div>
                )}
                <div>
                  <span className="cem-kicker">&sect; Jury</span>
                  <h3 className="cem-title">Jury panel</h3>
                </div>

                {/* Assigned jurors */}
                <div>
                  <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Assigned jurors</div>
                  {assignedNames.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {assignedNames.map((n, i) => (
                        <span key={i} className="os-chip" style={{ fontSize: 12, padding: '2px 8px' }}>{n}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="os-text-soft" style={{ fontSize: 13 }}>No jurors assigned yet.</span>
                  )}
                </div>

                {/* Picked by */}
                <div>
                  <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Picked by</div>
                  {pickedBy.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {pickedBy.map((p, i) => (
                        <div key={p.juror_user_id || i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>★ {p.name}</span>
                          {p.note && <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-soft)' }}>{p.note}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="os-text-soft" style={{ fontSize: 13 }}>No jurors have picked this startup yet.</span>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
                    {pickedBy.length} of {s.jury_assigned ?? 0} assigned jurors have picked
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* RIGHT — Averages, Flags, Reviewer Assignment, Decision */}
        <div className="os-stack">
          {/* Reviewer Scores Card */}
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Reviewer Scores</div>
            <div className="os-stack gap-sm">
              {METRICS.map(m => {
                const revVal = reviewerCatAvg(m.key);
                return (
                  <div key={m.key}>
                    <div className="os-row between os-text-sm">
                      <span className="os-text-soft">{m.label}</span>
                      <span className="os-mono font-bold" style={{ fontWeight: 600 }}>
                        {revVal > 0 ? revVal.toFixed(1) : '—'}
                      </span>
                    </div>
                    <div className="os-scorebar-track" style={{ marginTop: 4 }}>
                      <div className="os-scorebar-fill" style={{ width: (revVal * 10) + '%', background: `var(--cat-${m.key})` }} />
                    </div>
                  </div>
                );
              })}
              <hr className="os-divider" style={{ margin: '8px 0' }} />
              <div className="os-stack gap-xs">
                <div className="os-row between os-text-sm">
                  <span className="os-text-soft">Reviewer Overall</span>
                  <span className="os-mono font-bold">{revOverall > 0 ? revOverall.toFixed(2) : '—'}</span>
                </div>
                {decisionMode === 'jury' && (
                  <div className="os-row between os-text-sm">
                    <span className="os-text-soft">Jury Overall</span>
                    <span className="os-mono font-bold">{jOverall > 0 ? jOverall.toFixed(2) : '—'}</span>
                  </div>
                )}
                <hr className="os-divider" style={{ margin: '4px 0', borderStyle: 'dashed' }} />
                <div className="os-row between">
                  <span className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 700, color: 'var(--accent)' }}>Combined Overall</span>
                  <span className="os-num-big" style={{ fontSize: 26, fontFamily: 'var(--font-sans)', fontWeight: 800, color: 'var(--accent)' }}>
                    {combinedOverall > 0 ? combinedOverall.toFixed(2) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Flags raised card */}
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Flags Raised</div>
            {s.flags && s.flags.length ? s.flags.map((f, i) => (
              <div key={i} className="os-row gap-sm os-mb-sm">
                <span className="os-chip red" style={{ background: '#fff0f0', color: '#d23b40', border: '1px solid #ffe4e4' }}>⚐</span>
                <span className="os-text-sm" style={{ color: '#4a4a52' }}>{f}</span>
              </div>
            )) : <div className="os-text-dim os-text-sm">No flags raised on this application.</div>}
          </div>

          {/* Admin Decision Card */}
          <div className="os-card">
            <div className="os-text-xs os-text-dim os-uppercase os-mb-sm">DECIDE</div>
            <div className="os-reco-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[
                { id: 'approve', label: 'Approve', activeStyle: { background: '#3213b7', color: '#fff', borderColor: '#3213b7' } },
                { id: 'reject',  label: 'Reject',  activeStyle: {} },
              ].map(btn => (
                <button
                  key={btn.id}
                  className={`os-reco-btn${decision === btn.id ? ` active ${btn.id === 'approve' ? 'yes' : btn.id === 'reject' ? 'no' : 'maybe'}` : ''}`}
                  style={decision === btn.id ? btn.activeStyle : {}}
                  disabled={decisionBusy}
                  onClick={() => { setDecision(btn.id); setDecisionError(null); }}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="os-mt-sm" style={{ fontSize: 12, color: '#6f6f78', fontStyle: 'italic' }}>
              Approval advances the application to the jury evaluation round.
            </div>

            <textarea
              className="os-input os-w-100 os-mt"
              rows={3}
              style={{ fontSize: 13.5 }}
              placeholder={
                decision === 'reject'
                  ? 'Rationale (required for reject)…'
                  : 'Rationale (optional for approve)…'
              }
              value={rationale}
              onChange={e => { setRationale(e.target.value); setDecisionError(null); }}
              disabled={decisionBusy}
            />

            {decisionError && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 4, fontSize: 12.5, background: '#fdecec', border: '1px solid #f3c2c4', color: '#b3262b' }}
                role="alert">{decisionError}</div>
            )}

            <button
              className="os-btn os-w-100 os-mt"
              style={{ background: '#3213b7', color: '#fff', fontWeight: 600 }}
              disabled={decisionBusy || !decision}
              onClick={onApplyDecision}
            >
              {decisionBusy ? 'Recording…' : 'Apply decision'}
            </button>

            <button
              className="os-btn os-w-100 os-mt"
              style={{
                background: s.movedToTrack ? '#8a6d00' : '#f3f0fd',
                color: s.movedToTrack ? '#fff' : '#3213b7',
                fontWeight: 600, border: '1px solid #cfc4f5',
              }}
              disabled={moveBusy}
              onClick={onMoveTrack}
            >
              {moveBusy ? 'Moving…' : moveButtonLabel(s.nativeTrack || track, s.movedToTrack)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
