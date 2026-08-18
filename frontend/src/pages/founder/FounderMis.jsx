// MIS — read-only chart view (spec §5). Reports now arrive by email and are
// ingested by a parser; this page is the record of what ARTPARK has
// received, never a form — the founder types nothing here. Four charts
// (misChartData.buildMisChartSeries) sourced from submitted monthly periods
// only, plus period cards for both calendars so a founder can see what's
// been received without any path to edit it.
//
// Fetch/error idiom mirrors VipDashboard.jsx's own MIS read (same
// established, tested pattern): one `getMis()` for the index, then one
// `getMisPeriod` per period of both kinds, in parallel, inside a single
// cancelled-guarded effect — no genRef/autosave machinery needed here since
// this page never writes.
import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";
import MisChartCard, { GRAPH } from "../../components/MisChartCard.jsx";
import { buildMisChartSeries } from "./misChartData.js";
import { misEmptyReason, misEmptyCopy } from "../../lib/misEmptyState.js";
import "../../styles/founder-mis-charts.css";

const KIND_LABELS = { monthly: "Monthly", quarterly: "Quarterly" };

function MisHeader() {
  return (
    <header className="eir-os-view-head">
      <div className="eir-mono eir-dim eir-os-crumb">Cohort management · MIS</div>
      <h1 className="eir-os-view-title">Monthly and quarterly reporting</h1>
      <p className="eir-os-view-sub">
        Reports arrive by email — this page is the record of what ARTPARK has received, not a form to fill in.
      </p>
    </header>
  );
}

// Newest first (reverse of `buildMisChartSeries`'s own oldest-first order —
// a chart reads left-to-right as a timeline, but a list of received reports
// reads top-to-bottom as an inbox).
function PeriodCards({ periodBundles }) {
  const sorted = [...(periodBundles || [])].sort((a, b) => (a.period.period_key < b.period.period_key ? 1 : -1));
  if (sorted.length === 0) {
    return <p className="hint">No periods yet — check back once your first one opens.</p>;
  }
  return (
    <div className="mis-period-cards">
      {sorted.map((b) => {
        const p = b.period;
        return (
          <div className="mis-period-card" key={p.period_key} data-status={p.status}>
            <span className="mis-period-card-label">{p.label}</span>
            <span className={`mis-period-card-status is-${p.status}`}>
              {p.status === "submitted" ? "Submitted" : "Not yet received"}
            </span>
            <span className="mis-period-card-date">
              {p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function FounderMis() {
  const [index, setIndex] = useState(null);
  const [bundles, setBundles] = useState(null); // {monthly: [...], quarterly: [...]}
  const [error, setError] = useState(null);
  const [kind, setKind] = useState("monthly");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await founderApi.getMis();
        if (cancelled) return;
        setIndex(idx);
        const isOnboarded = (idx.monthly?.length || 0) > 0 || (idx.quarterly?.length || 0) > 0;
        if (!isOnboarded) return; // G1 — venture not onboarded, nothing to fetch
        const [monthly, quarterly] = await Promise.all([
          Promise.all((idx.monthly || []).map((p) => founderApi.getMisPeriod("monthly", p.period_key))),
          Promise.all((idx.quarterly || []).map((p) => founderApi.getMisPeriod("quarterly", p.period_key))),
        ]);
        if (!cancelled) setBundles({ monthly, quarterly });
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!index) return <Loading label="Loading your MIS reporting…" />;

  const isOnboarded = (index.monthly?.length || 0) > 0 || (index.quarterly?.length || 0) > 0;
  if (!isOnboarded) {
    // G1: application is `offered`, not yet `onboarded` — get_mis returns
    // empty calendars rather than guessing a start date. No tabs, no charts.
    return (
      <div className="mis-shell">
        <MisHeader />
        <p className="hint" style={{ marginTop: 24 }}>
          MIS reporting opens once your venture is onboarded. Nothing is due yet.
        </p>
      </div>
    );
  }

  if (!bundles) return <Loading label="Loading your MIS reporting…" />;

  const chartSeries = buildMisChartSeries(bundles.monthly);
  // Composed purely from `status`/`overdue` (index.monthly, the server's own
  // flags) — never a frontend due_date <= today comparison. A period still
  // `draft` here means "not yet received", never "you have something left
  // to finish" — there is no founder-facing finish action anymore.
  const emptyReason = misEmptyReason(index.monthly);

  return (
    <div className="mis-shell">
      <MisHeader />

      <div className="mis-charts-grid">
        {emptyReason ? (
          // G2: onboarded, periods exist, but zero submitted monthly
          // periods yet — the two-cause, two-copy distinction
          // (misEmptyCopy) is the whole point of importing from the shared
          // module rather than writing a single message here.
          <p className="mis-charts-empty">{misEmptyCopy(emptyReason)}</p>
        ) : (
          GRAPH.map((g) => (
            <MisChartCard key={g.key} chartKey={g.key} title={g.title} series={chartSeries[g.key]} />
          ))
        )}
      </div>

      <div className="mis-kind-tabs" role="tablist">
        {["monthly", "quarterly"].map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`mis-kind-tab${kind === k ? " is-active" : ""}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <PeriodCards periodBundles={bundles[kind]} />
    </div>
  );
}
