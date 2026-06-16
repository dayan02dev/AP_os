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
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";

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
// industry breakdown not in /stats yet — preview; derive from pipeline in a follow-up
function ApplicationsByIndustry({ go }) {
  const industries = [
    { name: 'Robotics & Automation', count: 48, pct: '19.3%' },
    { name: 'Healthcare / MedTech', count: 43, pct: '17.3%' },
    { name: 'Artificial Intelligence / Foundational Models', count: 42, pct: '16.9%' },
    { name: 'Defense & Aerospace', count: 39, pct: '15.7%' },
    { name: 'Advanced Manufacturing / Industry 5.0', count: 20, pct: '8%' },
    { name: 'EV Mobility & Services', count: 17, pct: '6.8%' },
    { name: 'Other / Frontier', count: 10, pct: '4%' },
    { name: 'Semiconductor / Hardware', count: 10, pct: '4%' },
    { name: 'Climate Fintech / Urban Resilience', count: 6, pct: '2.4%' },
    { name: 'Developer Tools / DevOps', count: 6, pct: '2.4%' },
    { name: 'EdTech', count: 6, pct: '2.4%' },
    { name: 'E-commerce & Artisanal Crafts', count: 2, pct: '0.8%' }
  ];

  const handleIndustryClick = (indName) => {
    if (!window.OS_FILTERS) window.OS_FILTERS = {};
    window.OS_FILTERS.industry = indName;
    go('pipeline');
  };

  const maxCount = 48;

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

// ─── StatusBreakdown ──────────────────────────────────────────────────────────
// Renders one tile per entry from statusCounts (array of { id, label, n }).
// Falls back to prototype color palette via STATUS_DOT map.
const STATUS_DOT = {
  submitted:    '#b7a06a',
  'ai-screening': '#3213b7',
  'under-review': '#3213b7',
  evaluated:    '#3213b7',
  shortlisted:  '#2a8f5a',
  interview:    '#2a8f5a',
  offered:      '#242424',
  onboarded:    '#242424',
  'not-selected': '#242424',
  waitlisted:   '#242424',
  withdrawn:    '#242424',
};

function StatusBreakdown({ go, statusCounts }) {
  const handleStatusClick = (statusId) => {
    if (!window.OS_FILTERS) window.OS_FILTERS = {};
    window.OS_FILTERS.status = statusId;
    go('pipeline');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {statusCounts.map(st => (
        <div
          key={st.id}
          onClick={() => handleStatusClick(st.id)}
          style={{
            border: '1px solid var(--line)',
            borderRadius: '2px',
            padding: '12px 16px',
            background: 'var(--bg-paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          className="status-breakdown-tile"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[st.id] || '#8a8a92', display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: '500', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{st.label}</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>{st.n}</span>
        </div>
      ))}
    </div>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────
export function AdminDashboard({ go, decisionMode }) {
  const { data, loading, error } = useAdminData('stats');

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24 }} className="os-banner red">Failed to load dashboard.</div>;

  const totals       = data?.totals       || {};
  const funnel       = data?.funnel       || {};
  const statusCounts = data?.statusCounts || [];
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
  const juryInterview = 0;                             // jury interview backend deferred
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
        /* ── JURY MODE KPIs (jury backend deferred — wrapped in PreviewBadge) ── */
        <div>
          <PreviewBadge />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 12 }}>
            <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>IN JURY EVALUATION</div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{juryTotal}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>shortlisted for jury</div>
            </div>
            <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>INTERVIEW REQUESTED</div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{juryInterview}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>jury requested interview</div>
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
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{totalSubmitted ? Math.round(inReview / totalSubmitted * 100) : 0}% of submissions</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>SHORTLISTED</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>{shortlisted}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>advanced past review</div>
          </div>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>JURY EVALUATION</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0' }}>0</div>
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center' }}>
              <PreviewBadge />
            </div>
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
            <FunnelRow label="IN JURY EVALUATION" sublabel="shortlisted for jury" count={juryTotal} maxCount={juryTotal || 1} filledColor="#1f0a8a" />
            <ArrowDown />
            <FunnelRow label="INTERVIEW REQUESTED" sublabel="jury flagged for interview" count={juryInterview} maxCount={juryTotal || 1} filledColor="#1f0a8a" />
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
            <PreviewBadge />
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            Click an industry to jump into the Applications tab pre-filtered.
          </div>
        </div>
        <ApplicationsByIndustry go={go} />
      </div>

      {/* Status breakdown */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>§ Status breakdown</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>Where every application sits right now</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            Click a status to open the Applications tab filtered to it.
          </div>
        </div>
        <StatusBreakdown go={go} statusCounts={statusCounts} />
      </div>
    </div>
  );
}
