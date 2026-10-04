// screens/AdminDashboard.jsx — A-0 Dashboard (Task 8)
//
// Faithful port of AdminDashboard + FunnelRow + ArrowDown + ApplicationsByIndustry +
// StatusBreakdown from admin-ui-prototype/os/admin-1.jsx.
//
// Data source: useAdminData('stats') → adaptStats shape:
//   { totals, funnel, statusCounts, aiScores, decisions }
//
// Components NOT ported (not rendered by AdminDashboard in the prototype):
//   AIScoreHistogram, AIScoreComponents

import React from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { writeStickyState } from "../../../../hooks/useStickyState.js";

// The Applications tab (AdminPipeline scopeKey="applications") reads its
// industry filter from this sticky key — write it, then switch tabs.
const presetIndustry = (go, name) => {
  writeStickyState('admin.pipeline.applications', 'industry', name);
  go('pipeline');
};

// ─── FunnelRow ────────────────────────────────────────────────────────────────
function FunnelRow({ label, sublabel, count, maxCount, filledColor = '#1f0a8a' }) {
  const percent = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const isZero = count === 0;
  const filled = isZero ? 0 : Math.max(percent, 7);
  return (
    <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 18 }}>
      <div style={{ flex: 1, position: 'relative', height: 30, background: '#f0f0f3', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${filled}%`,
          background: filledColor,
          opacity: isZero ? 0 : 1,
          borderRadius: 3, transition: 'width 0.4s ease'
        }} />
        <div style={{
          position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
          display: 'inline-flex', alignItems: 'center',
          background: '#fff', border: `1px solid ${isZero ? 'var(--line)' : filledColor}`,
          borderRadius: 2, padding: '1px 9px',
          fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 700,
          color: isZero ? 'var(--ink-dim)' : 'var(--ink)', lineHeight: 1.55,
          fontVariantNumeric: 'tabular-nums'
        }}>{count}</div>
      </div>
      <div style={{ width: '176px', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 11.5, color: 'var(--ink)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 1, fontFamily: 'var(--font-sans)' }}>{sublabel}</div>
      </div>
    </div>
  );
}

// ─── ArrowDown ────────────────────────────────────────────────────────────────
const ArrowDown = () => (
  <div style={{ display: 'flex', width: '100%', gap: 18 }}>
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', color: 'var(--line-strong)', fontSize: 11, lineHeight: '8px', padding: '4px 0' }}>↓</div>
    <div style={{ width: '176px' }} />
  </div>
);

// ─── ApplicationsByIndustry ───────────────────────────────────────────────────
// Real industry breakdown: derived from the pipeline (grouped on `domain`).
// `industries` is [{ name, count, pct }] sorted desc, computed by the caller.
function ApplicationsByIndustry({ go, industries }) {
  const handleIndustryClick = (indName) => presetIndustry(go, indName);

  const maxCount = Math.max(1, ...industries.map(i => i.count));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {industries.map((ind, i) => {
          const percent = (ind.count / maxCount) * 100;
          return (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
              onClick={() => handleIndustryClick(ind.name)}
              className="industry-bar-row"
            >
              <span style={{ width: '280px', fontSize: 13, fontWeight: '500', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{ind.name}</span>
              <div style={{ flex: 1, height: 16, background: '#f0f0f3', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: '#1f0a8a', borderRadius: 4 }} />
              </div>
              <div style={{ width: '80px', textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                <strong style={{ color: 'var(--ink)' }}>{ind.count}</strong>
                <span style={{ color: 'var(--ink-dim)', marginLeft: 8 }}>{ind.pct}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 16, borderTop: '1px dashed var(--line)', marginTop: 8 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', textTransform: 'uppercase', marginRight: 8 }}>FILTER:</span>
        <button
          style={{ padding: '4px 12px', borderRadius: '16px', background: '#242424', color: '#fff', border: 'none', fontSize: 12, fontWeight: '500', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          onClick={() => presetIndustry(go, 'all')}
        >
          All
        </button>
        {industries.map(ind => (
          <button
            key={ind.name}
            style={{ padding: '4px 12px', borderRadius: '16px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', fontSize: 12, fontWeight: '500', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            onClick={() => handleIndustryClick(ind.name)}
          >
            {ind.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Kpi tile ─────────────────────────────────────────────────────────────────
function Kpi({ id, label, value, sub }) {
  return (
    <div data-testid={id ? `kpi-${id}` : undefined} style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
      <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{sub}</div>}
    </div>
  );
}

const FUNNEL_CARD = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 };

// ─── BreakdownOverview ────────────────────────────────────────────────────────
// /stats `pipeline_breakdown` (contract C1): every non-draft app sits in exactly
// one stage, so the tiles and funnel rows add up to `total`. Raw status — no
// accepted-overlay — so shortlisted (`jury_review`) apps are not hidden.
function BreakdownOverview({ breakdown }) {
  const st = breakdown.stages || {};
  const n = (k) => st[k] ?? 0;
  const total = breakdown.total ?? 0;
  const finalSelected = n('final_selected');
  const gate1Selected = breakdown.gate1_selected
    ?? (n('final_pending') + n('final_rejected') + finalSelected + n('offered') + n('onboarded'));
  const rejectedTotal = breakdown.rejected_total ?? (n('gate1_rejected') + n('final_rejected'));
  const held = n('on_hold') + n('waitlisted');

  // Mutually exclusive parts of `total` — the reconciliation line below.
  const parts = [
    ['awaiting assignment', n('submitted')],
    ['under review', n('under_review')],
    ['reviewed', n('reviewed')],
    ['1st-gate rejected', n('gate1_rejected')],
    ['1st-gate selected', gate1Selected],
    ['on hold / waitlisted', held],
    ['withdrawn', n('withdrawn')],
  ].filter(([label, v]) => v > 0 || label !== 'withdrawn');

  const finalSub = [
    `${finalSelected} selected`,
    `${n('final_rejected')} rejected`,
    `${n('final_pending')} pending`,
    n('offered') ? `${n('offered')} offered` : null,
    n('onboarded') ? `${n('onboarded')} onboarded` : null,
  ].filter(Boolean).join(' · ');

  const maxCount = Math.max(1, total);
  const rows = [
    ['TOTAL', 'non-draft applications', total],
    ['AWAITING ASSIGNMENT', 'submitted, no reviewer yet', n('submitted')],
    ['UNDER REVIEW', 'with reviewers', n('under_review')],
    ['REVIEWED', 'awaiting admin decision', n('reviewed')],
    ['1ST-GATE REJECTED', 'rejected at admin review', n('gate1_rejected')],
    ['1ST-GATE SELECTED', 'shortlisted for the final round', gate1Selected],
    ['FINAL SELECTED', 'every IC memo approved', finalSelected, true],
    ['FINAL REJECTED', 'rejected in the final round', n('final_rejected'), true],
    ['FINAL PENDING', 'IC memo not yet approved', n('final_pending'), true],
    ['OFFERED / ONBOARDED', 'offer issued or onboarded', n('offered') + n('onboarded'), true],
    ['ON HOLD / WAITLISTED', 'parked', held],
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
        <Kpi id="total" label="Total applications" value={total}
          sub={`${finalSelected} accepted · ${rejectedTotal} rejected`} />
        <Kpi id="under_review" label="Under review" value={n('under_review')}
          sub={n('submitted') ? `+ ${n('submitted')} awaiting assignment` : 'with reviewers'} />
        <Kpi id="reviewed" label="Reviewed" value={n('reviewed')} sub="awaiting admin decision" />
        <Kpi id="gate1_rejected" label="1st-gate rejected" value={n('gate1_rejected')} sub="at admin review" />
        <Kpi id="gate1_selected" label="1st-gate selected" value={gate1Selected} sub={`Final: ${finalSub}`} />
        <Kpi id="held" label="On hold / waitlisted" value={held}
          sub={n('withdrawn') ? `${n('withdrawn')} withdrawn` : `${n('on_hold')} on hold · ${n('waitlisted')} waitlisted`} />
      </div>
      <div data-testid="breakdown-reconcile" style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: -12 }}>
        {parts.map(([label, v]) => `${v} ${label}`).join(' + ')} = {total}
      </div>

      <div data-testid="pipeline-funnel" style={FUNNEL_CARD}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ Pipeline</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)' }}>Where every application sits</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(([label, sub, count, nested]) => (
            <div key={label} style={{ paddingLeft: nested ? 32 : 0 }}>
              <FunnelRow label={label} sublabel={sub} count={count} maxCount={maxCount}
                filledColor={nested ? '#5a45c8' : '#1f0a8a'} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── LegacyOverview ───────────────────────────────────────────────────────────
// Older /stats without `pipeline_breakdown`: the previous tiles + funnel.
function LegacyOverview({ data, selectedCount }) {
  const totals       = data?.totals       || {};
  const funnel       = data?.funnel       || {};
  const decisions    = data?.decisions    || {};

  // ── KPI values ──
  const totalSubmitted = totals.apps_submitted ?? 0;
  const inReview       = funnel.in_review      ?? 0;
  const shortlisted    = funnel.advanced       ?? 0;   // "advanced past review" in /stats
  const finalDecided   = funnel.decided        ?? 0;
  const onboarded      = totals.onboarded      ?? 0;
  const rejected       = decisions.rejected    ?? 0;
  // /stats runs overlay_admin_decisions, which moves every shortlisted
  // `jury_review` app into the `accepted` bucket — so read both (same fallback
  // as lib/adminBadges.pipelineBadges), or the tile would sit at ~0.
  const countFor       = (id) => (data?.statusCounts || []).find(c => c.id === id)?.n ?? 0;
  const acceptedStage  = countFor('jury_review') + countFor('accepted');
  // Tile + funnel "ACCEPTED" = the Accepted tab badge: shortlisted apps whose
  // IC memo is approved (green). Passed down from AdminPortal, which already
  // computes it; falls back to the shortlist bucket if not supplied.
  const acceptedCount  = typeof selectedCount === 'number' ? selectedCount : acceptedStage;

  const funnelCounts = [totalSubmitted, inReview, shortlisted, acceptedCount, onboarded];
  const maxCount = Math.max(1, ...funnelCounts);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
        <Kpi label="APPLICATIONS SUBMITTED" value={totalSubmitted} sub="total in system" />
        <Kpi label="UNDER REVIEW" value={inReview} />
        <Kpi label="SHORTLISTED" value={shortlisted} sub="advanced past review" />
        <Kpi label="ACCEPTED" value={acceptedCount} sub="IC memo approved" />
        <Kpi label="FINAL DECISIONS" value={finalDecided} sub={(
          <span style={{ display: 'flex', gap: 10, fontSize: 10 }}>
            <span style={{ color: '#2F6F62', fontWeight: 600 }}>{onboarded} onboarded</span>
            <span>·</span>
            <span style={{ color: '#d23b40', fontWeight: 600 }}>{rejected} rejected</span>
          </span>
        )} />
      </div>

      <div data-testid="pipeline-funnel" style={FUNNEL_CARD}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ Pipeline funnel</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)' }}>From submission to onboarded</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FunnelRow label="SUBMITTED" sublabel="complete" count={totalSubmitted} maxCount={maxCount} filledColor="#1f0a8a" />
          <ArrowDown />
          <FunnelRow label="IN REVIEW" sublabel="under reviewer eval" count={inReview} maxCount={maxCount} filledColor="#1f0a8a" />
          <ArrowDown />
          <FunnelRow label="SHORTLISTED" sublabel="advanced past admin review" count={shortlisted} maxCount={maxCount} filledColor="#1f0a8a" />
          <ArrowDown />
          <FunnelRow label="ACCEPTED" sublabel="interviewed · final selection" count={acceptedCount} maxCount={maxCount} filledColor="#1f0a8a" />
          <ArrowDown />
          <FunnelRow label="ONBOARDED" sublabel="cohort onboarded" count={onboarded} maxCount={maxCount} filledColor="#1f0a8a" />
        </div>
      </div>
    </>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────
export function AdminDashboard({ go, selectedCount = null }) {
  const { data, loading, error } = useAdminData('stats');
  // Pipeline drives the real "Applications by industry" breakdown.
  const { data: pipelineData, loading: pipelineLoading } = useAdminData('pipeline', {});

  // Group pipeline rows on their `domain` field → [{ name, count, pct }] sorted desc.
  const industries = React.useMemo(() => {
    const rows = pipelineData?.startups || [];
    const total = rows.length;
    const counts = new Map();
    for (const r of rows) {
      const name = (r.domain && r.domain !== '—') ? r.domain : 'Unspecified';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({
        name,
        count,
        pct: total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0%',
      }))
      .sort((a, b) => b.count - a.count);
  }, [pipelineData]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24 }} className="os-banner red">Failed to load dashboard.</div>;

  const breakdown = data?.pipelineBreakdown;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {breakdown && breakdown.stages
        ? <BreakdownOverview breakdown={breakdown} />
        : <LegacyOverview data={data} selectedCount={selectedCount} />}

      {/* Applications by Industry */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ Applications by industry</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center' }}>
            Where the cohort is concentrated
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            All {(pipelineData?.startups || []).length} applications, every stage (including rejected and accepted).
            Click an industry to jump into the Applications tab pre-filtered — that tab holds only apps still in review.
          </div>
        </div>
        {pipelineLoading && industries.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>…</div>
          : <ApplicationsByIndustry go={go} industries={industries} />}
      </div>

    </div>
  );
}
