import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricTrendPanel from "../components/MetricTrendPanel.jsx";

// Mirrors mis_catalog.METRICS' own template order (backend/app/services/
// mis_catalog.py) — 13 entries, only 6 of which are trend keys. Kept as a
// local fixture (not imported — this is a frontend test) so the ordering
// assertion below is meaningful: the six trend keys are NOT in this order
// in `trend.series` (see vipDashboardRollup.js's own TREND_METRIC_KEYS,
// which is a different order) — only `metricLabels` carries the catalog's
// real template order, and the panel must render in that order, not
// `Object.keys(trend.series)`'s order.
const METRIC_LABELS = [
  { key: "revenue_month", label: "Revenue this month (₹ Lakh)", group: "commercial", unit: "₹L", computed: false },
  { key: "active_customers", label: "Active paying customers / pilots", group: "commercial", unit: "count", computed: false },
  { key: "new_lois", label: "New LOIs / MoUs signed", group: "commercial", unit: "count", computed: false },
  { key: "weighted_pipeline", label: "Weighted pipeline (₹ Lakh)", group: "commercial", unit: "₹L", computed: false },
  { key: "deployments_field", label: "Deployments in field", group: "product_technology", unit: "count", computed: false },
  { key: "product_metric_1", label: "Key product metric #1", group: "product_technology", unit: "free", computed: false },
  { key: "product_metric_2", label: "Key product metric #2", group: "product_technology", unit: "free", computed: false },
  { key: "trl_level", label: "TRL Level (1–9)", group: "product_technology", unit: "1–9", computed: true },
  { key: "cash_in_bank", label: "Cash in bank (₹ Cr)", group: "financials", unit: "₹Cr", computed: false },
  { key: "net_burn_month", label: "Net burn / month (₹ Lakh)", group: "financials", unit: "₹L", computed: false },
  { key: "runway_months", label: "Runway (months)", group: "financials", unit: "months", computed: false },
  { key: "headcount_eom", label: "Headcount (end of month)", group: "team", unit: "count", computed: false },
  { key: "net_hires_month", label: "Net hires this month", group: "team", unit: "count", computed: false },
];

// Same six keys `vipDashboardRollup.metricTrend` always returns, but in
// THIS (different, already-locked) order — deliberately not the catalog's
// template order, so a test that only checked `Object.keys` would pass
// even with the ordering bug this test exists to catch.
const emptySeries = () => ({
  revenue_month: [], cash_in_bank: [], runway_months: [],
  headcount_eom: [], deployments_field: [], trl_level: [],
});

const point = (key, i, value) => ({ period_key: `2026-0${i}`, label: `Month ${i}`, value });

describe("MetricTrendPanel", () => {
  it("state 6 — not due yet: zero periods, exact copy, distinct from overdue-backlog", () => {
    render(
      <MetricTrendPanel
        trend={{ periods: [], series: emptySeries() }}
        emptyReason={{ cause: "not_due_yet", due_date: "2026-07-05", due_label: "June 2026" }}
        metricLabels={METRIC_LABELS}
      />,
    );
    expect(
      screen.getByText("No monthly update filed yet — your first one is due 2026-07-05."),
    ).toBeInTheDocument();
  });

  it("state 7 — overdue backlog: zero periods, exact copy, distinct from not-due-yet", () => {
    render(
      <MetricTrendPanel
        trend={{ periods: [], series: emptySeries() }}
        emptyReason={{ cause: "overdue_backlog", count: 2, oldest_label: "April 2026", oldest_due: "2026-05-05" }}
        metricLabels={METRIC_LABELS}
      />,
    );
    expect(
      screen.getByText(
        "No monthly update filed yet — 2 period(s) are overdue, starting with April 2026 (due 2026-05-05).",
      ),
    ).toBeInTheDocument();
    // These two states must never share copy — the exact bug class this plan exists to prevent.
    expect(screen.queryByText(/your first one is due/i)).not.toBeInTheDocument();
  });

  it("state 8 — exactly one submitted period: renders the point plus the single-point caption", () => {
    const series = emptySeries();
    series.cash_in_bank = [point("cash_in_bank", 1, 50)];
    render(
      <MetricTrendPanel
        trend={{ periods: ["2026-06"], series }}
        emptyReason={null}
        metricLabels={METRIC_LABELS}
      />,
    );
    expect(
      screen.getByText(/First reported period — a trend appears after your second submission/i),
    ).toBeInTheDocument();
    // One bar for the one metric that has data.
    const bars = document.querySelectorAll('[data-metric-key="cash_in_bank"] .vipd-trend-bar');
    expect(bars).toHaveLength(1);
  });

  it("2+ periods: renders a bar per period per metric, no single-point caption", () => {
    const series = emptySeries();
    series.cash_in_bank = [point("cash_in_bank", 1, 40), point("cash_in_bank", 2, 50)];
    render(
      <MetricTrendPanel
        trend={{ periods: ["2026-05", "2026-06"], series }}
        emptyReason={null}
        metricLabels={METRIC_LABELS}
      />,
    );
    expect(screen.queryByText(/First reported period/i)).not.toBeInTheDocument();
    const bars = document.querySelectorAll('[data-metric-key="cash_in_bank"] .vipd-trend-bar');
    expect(bars).toHaveLength(2);
    // Normalised to its OWN max (50): the second (larger) bar reaches 100%,
    // the first reaches 80% — never a shared cross-metric scale.
    expect(bars[1].style.height).toBe("100%");
    expect(bars[0].style.height).toBe("80%");
  });

  it("a metric whose every point is null renders zero-height bars, not a crash", () => {
    const series = emptySeries();
    series.trl_level = [point("trl_level", 1, null), point("trl_level", 2, null)];
    series.cash_in_bank = [point("cash_in_bank", 1, 10), point("cash_in_bank", 2, 20)];
    render(
      <MetricTrendPanel
        trend={{ periods: ["2026-05", "2026-06"], series }}
        emptyReason={null}
        metricLabels={METRIC_LABELS}
      />,
    );
    const bars = document.querySelectorAll('[data-metric-key="trl_level"] .vipd-trend-bar');
    expect(bars).toHaveLength(2);
    for (const b of bars) expect(b.style.height).toBe("0%");
  });

  it("renders the six metric keys in mis_catalog.METRICS' own template order, not trend.series' own key order", () => {
    const series = emptySeries();
    for (const key of Object.keys(series)) series[key] = [point(key, 1, 1)];
    render(
      <MetricTrendPanel
        trend={{ periods: ["2026-06"], series }}
        emptyReason={null}
        metricLabels={METRIC_LABELS}
      />,
    );
    const rendered = Array.from(document.querySelectorAll(".vipd-trend-metric")).map(
      (el) => el.getAttribute("data-metric-key"),
    );
    expect(rendered).toEqual([
      "revenue_month", "deployments_field", "trl_level",
      "cash_in_bank", "runway_months", "headcount_eom",
    ]);
  });
});
