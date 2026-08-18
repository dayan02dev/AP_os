// Founder-side chart series builder for /founder/mis's four charts (spec
// §4). Pure — no fetching, no React, no Date.now(). Mirrors
// vipDashboardRollup.js's own metricTrend()/cashRunway() filter-sort
// pattern verbatim rather than importing it — this codebase's own
// established small-guard-duplication precedent (see VipDashboard.jsx's
// header comment): the two consumers are independent surfaces that may
// evolve separately, and the shared piece is a few lines, not a load-
// bearing function.
//
// Three properties that matter here:
// - Submitted-only: a draft period is a report nobody has filed yet: plot
//   nothing for it, regardless of what values happen to be present.
// - Oldest-first, always sorted explicitly. The API gives no ordering
//   guarantee and this codebase's fake Supabase `.order()` is a no-op, so a
//   function that only works because its input happened to arrive sorted
//   would pass its own tests and still be wrong in production.
// - Never invent values: a metric absent from a submitted period is
//   reported as `null`, never coerced to 0 or dropped from the series.
import { GRAPH } from "../../components/MisChartCard.jsx";

function metricActual(bundle, metricKey) {
  const row = (bundle.metrics || []).find((m) => m.metric_key === metricKey);
  return row ? row.actual ?? null : null;
}

export function buildMisChartSeries(monthlyBundles) {
  const submitted = (monthlyBundles || [])
    .filter((b) => b.period?.status === "submitted")
    .slice()
    .sort((a, b) => {
      if (a.period.period_key < b.period.period_key) return -1;
      if (a.period.period_key > b.period.period_key) return 1;
      return 0;
    });

  const out = {};
  for (const g of GRAPH) {
    out[g.key] = submitted.map((b) => ({
      period_key: b.period.period_key,
      label: b.period.label,
      value: metricActual(b, g.metricKey),
    }));
  }
  return out;
}
