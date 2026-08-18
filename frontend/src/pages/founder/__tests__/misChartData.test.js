import { describe, it, expect } from "vitest";
import { buildMisChartSeries } from "../misChartData.js";

function bundle(periodKey, label, status, metrics) {
  return {
    period: { period_key: periodKey, label, status },
    metrics: Object.entries(metrics).map(([metric_key, actual]) => ({ metric_key, actual })),
  };
}

describe("buildMisChartSeries", () => {
  it("sorts submitted periods oldest-first even when none of the input positions are already ascending", () => {
    // Deliberately out of order in a way filter+map alone would not fix:
    // array order is Jul, May, Jun — the submitted subset itself (Jul, May,
    // Jun) is not already sorted, unlike a naive fixture where the draft
    // entry is the only one out of place. The real API gives no ordering
    // guarantee and this codebase's fake Supabase `.order()` is a no-op, so
    // a function that relies on caller order would pass here only by luck.
    const bundles = [
      bundle("2026-07", "Jul 2026", "submitted", { revenue_month: 9 }),
      bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 }),
      bundle("2026-06", "Jun 2026", "submitted", { revenue_month: 6.2 }),
    ];
    const series = buildMisChartSeries(bundles);
    expect(series.revenue.map((p) => p.period_key)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(series.revenue.map((p) => p.value)).toEqual([4.5, 6.2, 9]);
  });

  it("includes only submitted periods, oldest first, regardless of input order", () => {
    const bundles = [
      bundle("2026-07", "Jul 2026", "draft", { revenue_month: 99 }),
      bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5, net_burn_month: 22, headcount_eom: 7, active_customers: 2 }),
      bundle("2026-06", "Jun 2026", "submitted", { revenue_month: 6.2, net_burn_month: 24, headcount_eom: 8, active_customers: 3 }),
    ];
    const series = buildMisChartSeries(bundles);
    expect(series.revenue.map((p) => p.period_key)).toEqual(["2026-05", "2026-06"]);
    expect(series.revenue.map((p) => p.value)).toEqual([4.5, 6.2]);
  });

  it("maps each GRAPH key to its own metric_key", () => {
    const bundles = [bundle("2026-05", "May 2026", "submitted", {
      revenue_month: 1, net_burn_month: 2, headcount_eom: 3, active_customers: 4,
    })];
    const series = buildMisChartSeries(bundles);
    expect(series.revenue[0].value).toBe(1);
    expect(series.burn[0].value).toBe(2);
    expect(series.headcount[0].value).toBe(3);
    expect(series.paying[0].value).toBe(4);
  });

  it("null for a metric a submitted period never reported, rather than dropping the point", () => {
    const bundles = [bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 })];
    const series = buildMisChartSeries(bundles);
    expect(series.paying[0]).toEqual({ period_key: "2026-05", label: "May 2026", value: null });
  });

  it("does not invent a zero when a metric row is explicitly null", () => {
    const bundles = [bundle("2026-05", "May 2026", "submitted", { revenue_month: null })];
    const series = buildMisChartSeries(bundles);
    expect(series.revenue[0].value).toBeNull();
  });

  it("returns empty arrays for every key when there are no submitted periods", () => {
    const bundles = [bundle("2026-05", "May 2026", "draft", { revenue_month: 4.5 })];
    const series = buildMisChartSeries(bundles);
    expect(series.revenue).toEqual([]);
    expect(series.burn).toEqual([]);
    expect(series.headcount).toEqual([]);
    expect(series.paying).toEqual([]);
  });

  it("returns empty arrays for every key when given no bundles at all", () => {
    expect(buildMisChartSeries([])).toEqual({ revenue: [], burn: [], headcount: [], paying: [] });
  });
});
