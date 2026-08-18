// Process dashboard — VIP. Replaces the Phase-1 placeholder (see git
// history for that version's own rationale). Shares the TIR residency
// dashboard's visual grammar (FounderDashboard.jsx): four stat tiles, the
// fourth dark, then panels — but every value here is derived from the AIR
// and MIS backends (see docs/superpowers/specs/2026-08-15-vip-onboarding-
// design.md §6), nothing hardcoded, nothing new stored. This file is the
// ONLY place in the VIP dashboard surface that fetches; every panel below
// (AirScorecardPanel, AirTrajectoryPanel, ActivityFeedPanel, MetricTrend
// Panel, MilestonesRisksPanel) is presentational, and every derived value
// comes from vipDashboardRollup.js's pure functions — this file never
// recomputes one of them inline.
import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtL, Loading, ErrorState } from "./ui.jsx";
import StatTile from "./components/StatTile.jsx";
import AirScorecardPanel from "./components/AirScorecardPanel.jsx";
import AirTrajectoryPanel from "./components/AirTrajectoryPanel.jsx";
import ActivityFeedPanel from "./components/ActivityFeedPanel.jsx";
import MetricTrendPanel from "./components/MetricTrendPanel.jsx";
import MilestonesRisksPanel from "./components/MilestonesRisksPanel.jsx";
import { activityFeed, airTile, cashRunway, metricTrend, milestonesAndRisks, nextDue, reportingCompliance } from "./vipDashboardRollup.js";
import { misEmptyCopy, misEmptyReason } from "../../lib/misEmptyState.js";
import "../../styles/vip-dashboard.css";

// The one place in this file that reads the browser clock — display-only
// (the cosmetic "days remaining" count on Tile 4), never used for a
// compliance/overdue determination, which always comes from the backend's
// own `overdue` flag (Global Constraints). Not exported from
// vipDashboardRollup.js on purpose: every function there is pure and takes
// "today" as a parameter rather than reading it itself.
const todayISO = () => new Date().toISOString().slice(0, 10);

// Duplicated verbatim from MetricTrendPanel.jsx / MilestonesRisksPanel.jsx
// — see either file's header comment for why this is a literal copy
// (small-guard-duplication precedent) rather than a shared import: all
// three surfaces must render states 6/7 with byte-identical copy.
export default function VipDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, air, mis] = await Promise.all([
          founderApi.me(), founderApi.getAir(), founderApi.getMis(),
        ]);
        const [monthlyBundles, quarterlyBundles] = await Promise.all([
          Promise.all(mis.monthly.map((p) => founderApi.getMisPeriod("monthly", p.period_key))),
          Promise.all(mis.quarterly.map((p) => founderApi.getMisPeriod("quarterly", p.period_key))),
        ]);
        if (!cancelled) setData({ me, air, mis, monthlyBundles, quarterlyBundles });
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading your dashboard…" />;

  const { me, air, mis, monthlyBundles, quarterlyBundles } = data;

  const t1 = airTile(air);
  // t1.delta.available is unconditionally false today (Open Questions 2/5
  // — no founder-facing endpoint returns any AIR round but the current
  // quarter's, so there is no prior round to diff against). No delta
  // indicator is rendered anywhere in Tile 1 as a result — this is a
  // deliberate omission, not an oversight.
  const t2 = reportingCompliance(mis);
  // `overdue` isn't a field reportingCompliance returns directly, but it's
  // exactly `total_due - submitted`: every "due" period is either
  // submitted or overdue (composed from the backend's own flags, see
  // reportingCompliance's own header comment) and those two sets are
  // disjoint, so this is arithmetic on an already-derived value, not a new
  // date computation.
  const t2Overdue = t2.total_due - t2.submitted;
  const t3 = cashRunway(monthlyBundles);
  const t3EmptyReason = misEmptyReason(mis.monthly);
  const t4 = nextDue(mis, todayISO());

  return (
    <div className="fj-dash">
      <div className="fj-dash-header">
        <div>
          <span className="eyebrow eyebrow-rule">Process dashboard</span>
          <h1 className="fj-h1">{me.project_name}</h1>
          <div className="fj-dash-sub">VIP programme</div>
        </div>
      </div>

      <div className="fj-dash-tiles">
        <StatTile
          label="AIR Scorecard"
          value={
            <>
              {t1.overall_claimed ?? "—"}
              {t1.overall_claimed != null && t1.overall_verified == null && (
                // State 1 — verified is structurally null (no admin
                // verification surface exists yet, Phase 7); this only
                // shows once there is a claimed overall to await
                // verification ON, mirroring AirScorecardPanel's own
                // showVerifyBadge condition.
                <span className="vipd-tile-badge">Awaiting verification</span>
              )}
            </>
          }
          sub={`Technology ${t1.tech_claimed ?? "—"} · Commercial ${t1.comm_claimed ?? "—"}`}
        />
        <StatTile
          label="Reporting compliance"
          value={t2.pct == null ? "Nothing due yet" : <>{t2.pct}<small>%</small></>}
          sub={
            t2Overdue > 0
              ? `${t2.submitted} of ${t2.total_due} periods filed + ${t2Overdue} overdue`
              : `${t2.submitted} of ${t2.total_due} periods filed`
          }
        />
        <StatTile
          label="Cash & runway"
          value={t3 ? fmtL(t3.cash_in_bank) : "—"}
          sub={t3 ? `${t3.runway_months} mo runway · as of ${t3.period_label}` : misEmptyCopy(t3EmptyReason)}
        />
        <StatTile
          dark
          label="Next due"
          value={t4 ? t4.label : "All caught up — nothing due right now."}
          sub={t4 ? (t4.days_remaining >= 0 ? `Due in ${t4.days_remaining} days` : `${-t4.days_remaining} days overdue`) : ""}
        />
      </div>

      <div className="fj-dash-two">
        <AirScorecardPanel round={air.round} levers={air.levers} rollups={air.rollups} />
        <ActivityFeedPanel events={activityFeed(air, monthlyBundles, quarterlyBundles)} />
      </div>

      <MetricTrendPanel
        trend={metricTrend(monthlyBundles)}
        emptyReason={misEmptyReason(mis.monthly)}
        metricLabels={mis.catalog.metrics}
      />

      <MilestonesRisksPanel
        // `monthlyBundles` is ascending by period_key (mis_query._fetch_
        // periods' own guarantee) — `.at(-1)` is "the latest monthly
        // period, draft or submitted". `?? null` covers the defensive case
        // even though an onboarded founder always has at least the
        // current period (`ensure_periods`).
        data={milestonesAndRisks(monthlyBundles.at(-1) ?? null)}
        emptyReason={misEmptyReason(mis.monthly)}
      />

      <AirTrajectoryPanel round={air.round} rollups={air.rollups} />
    </div>
  );
}
