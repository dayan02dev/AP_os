// Small multiples across submitted monthly periods — the VIP process
// dashboard's revenue/cash/runway/headcount/deployments/TRL trend (Task 5,
// full-width card, sits above MilestonesRisksPanel). Presentational only:
// no founderApi import, no fetching. Consumes `trend` (the exact shape
// `vipDashboardRollup.metricTrend()` returns) and `emptyReason` (the exact
// shape `vipDashboardRollup.misEmptyReason()` returns), never re-derives
// either from raw bundles itself.
//
// `metricLabels` is `GET /founder/mis`'s own `catalog.metrics` — the
// backend's `mis_catalog.METRICS`, in that module's own template order.
// `trend.series`'s six keys come from vipDashboardRollup.js's own
// TREND_METRIC_KEYS constant, a DIFFERENT, already-locked order — so this
// panel reorders by filtering `metricLabels` down to the keys `trend.series`
// actually has, rather than trusting `Object.keys(trend.series)` (see the
// panel's own ordering test, the one most likely to silently regress here).
// Nothing about a metric's label/unit is hardcoded — always read from
// `metricLabels`, matching the "nothing about the framework is hardcoded"
// discipline the AIR wizard already established.

// Duplicated verbatim from MilestonesRisksPanel.jsx (small-guard-
// duplication precedent, same as FAMILY_LABEL/FEED_COLOR elsewhere in this
// codebase) rather than factored into a shared module neither component
// otherwise needs — both panels must render states 6/7 with byte-identical
// copy, which is exactly what keeping the same literal string in both
// places (not a shared import) makes trivially auditable at a glance.
// Normalised to THIS metric's own series max — never a shared cross-metric
// scale (cash-in-bank and headcount are different units). A series whose
// every point is null (or whose max is otherwise <= 0) renders every bar at
// 0%, not a crash and not a divide-by-zero NaN height.
import { misEmptyCopy } from "../vipDashboardRollup.js";
function barHeightPct(value, max) {
  if (value == null || !(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function seriesMax(points) {
  return points.reduce((m, p) => (p.value != null && p.value > m ? p.value : m), 0);
}

export default function MetricTrendPanel({ trend, emptyReason, metricLabels }) {
  const periods = trend?.periods || [];
  const series = trend?.series || {};
  // Catalog template order, filtered to only the keys this trend actually
  // carries — see the header comment for why this is NOT `Object.keys(series)`.
  const orderedMetrics = (metricLabels || []).filter((m) => series[m.key] !== undefined);

  return (
    <div className="card fj-dash-card">
      <div className="fj-dash-card-title">Metric Trend</div>

      {periods.length === 0 ? (
        <p className="vipd-air-status">{misEmptyCopy(emptyReason)}</p>
      ) : (
        <>
          {periods.length === 1 && (
            <p className="vipd-air-status">
              First reported period — a trend appears after your second submission.
            </p>
          )}
          <div className="vipd-trend-grid">
            {orderedMetrics.map((m) => {
              const points = series[m.key] || [];
              const max = seriesMax(points);
              return (
                <div className="vipd-trend-metric" data-metric-key={m.key} key={m.key}>
                  <div className="vipd-trend-metric-label">{m.label}</div>
                  <div className="vipd-trend-bars">
                    {points.map((p) => (
                      <span
                        key={p.period_key}
                        className="vipd-trend-bar"
                        style={{ height: `${barHeightPct(p.value, max)}%` }}
                        title={`${p.label}: ${p.value ?? "—"}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
