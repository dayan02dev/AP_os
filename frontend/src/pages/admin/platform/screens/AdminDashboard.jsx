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
  const handleIndustryClick = (indName) => {
    if (!window.OS_FILTERS) window.OS_FILTERS = {};
    window.OS_FILTERS.industry = indName;
    go('pipeline');
  };

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
          onClick={() => {
            if (!window.OS_FILTERS) window.OS_FILTERS = {};
            window.OS_FILTERS.industry = 'all';
            go('pipeline');
          }}
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

// ─── AdminDashboard ───────────────────────────────────────────────────────────
export function AdminDashboard({ go, decisionMode }) {
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

  const totals       = data?.totals       || {};
  const funnel       = data?.funnel       || {};
  const decisions    = data?.decisions    || {};

  // ── Reviewer-mode KPI values ──
  const totalSubmitted = totals.apps_submitted ?? 0;
  const inReview       = funnel.in_review      ?? 0;
  const shortlisted    = funnel.advanced       ?? 0;   // "advanced past review" in /stats
  const finalDecided   = funnel.decided        ?? 0;
  const accepted       = totals.onboarded      ?? 0;
  const rejected       = decisions.rejected    ?? 0;

  // ── Jury-mode KPI values (best-effort; jury backend deferred) ──
  const juryTotal    = funnel.advanced ?? 0;           // apps that reached jury stage
  const juryDecided  = decisions.shortlisted != null
    ? (decisions.shortlisted ?? 0) + (decisions.rejected ?? 0)
    : (accepted + rejected);
  const juryPending  = Math.max(0, juryTotal - juryDecided);

  const isJury = decisionMode === 'jury';

  // ── Pipeline funnel — maxCount is max across all rows so bar widths are proportional ──
  const funnelCounts = [totalSubmitted, inReview, shortlisted, finalDecided, accepted];
  const maxCount = Math.max(1, ...funnelCounts);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>

      {isJury ? (
        /* ── JURY MODE KPIs (real stats — jurors pick, no scoring) ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>IN JURY EVALUATION</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{juryTotal}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>in the jury round</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>PENDING DECISION</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{juryPending}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>awaiting final decision</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>FINAL DECISIONS</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{juryDecided}</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--ink-soft)' }}>
              <span style={{ color: '#2F6F62', fontWeight: 600 }}>{accepted} accepted</span>
              <span>·</span>
              <span style={{ color: '#d23b40', fontWeight: 600 }}>{rejected} rejected</span>
            </div>
          </div>
        </div>
      ) : (
        /* ── REVIEWER MODE KPIs ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>APPLICATIONS SUBMITTED</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{totalSubmitted}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>total in system</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>UNDER REVIEW</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{inReview}</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>SHORTLISTED</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{shortlisted}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>advanced past review</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>JURY EVALUATION</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>0</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>FINAL DECISIONS</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{finalDecided}</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--ink-soft)' }}>
              <span style={{ color: '#2F6F62', fontWeight: 600 }}>{accepted} accepted</span>
              <span>·</span>
              <span style={{ color: '#d23b40', fontWeight: 600 }}>{rejected} rejected</span>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline funnel — mode-aware */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ {isJury ? 'Jury' : 'Pipeline'} funnel</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)' }}>{isJury ? 'Jury evaluation pipeline' : 'From submission to onboarded'}</h2>
        </div>
        {isJury ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FunnelRow label="IN JURY EVALUATION" sublabel="in the jury round" count={juryTotal} maxCount={juryTotal || 1} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="ACCEPTED" sublabel="cohort onboarded" count={accepted} maxCount={juryTotal || 1} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="REJECTED" sublabel="not selected" count={rejected} maxCount={juryTotal || 1} filledColor="#1f0a8a" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FunnelRow label="SUBMITTED" sublabel="complete" count={totalSubmitted} maxCount={maxCount} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="IN REVIEW" sublabel="under reviewer eval" count={inReview} maxCount={maxCount} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="SHORTLISTED" sublabel="advanced past admin review" count={shortlisted} maxCount={maxCount} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="JURY EVALUATION" sublabel="in final jury process" count={0} maxCount={maxCount} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="ACCEPTED" sublabel="cohort onboarded" count={accepted} maxCount={maxCount} filledColor="#1f0a8a" />
          </div>
        )}
      </div>

      {/* Applications by Industry */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ Applications by industry</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center' }}>
            Where the cohort is concentrated
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            Click an industry to jump into the Applications tab pre-filtered.
          </div>
        </div>
        {pipelineLoading && industries.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>…</div>
          : <ApplicationsByIndustry go={go} industries={industries} />}
      </div>

    </div>
  );
}
