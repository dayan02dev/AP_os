import { describe, it, expect } from "vitest";
import {
  activityFeed,
  airTile,
  cashRunway,
  metricTrend,
  milestonesAndRisks,
  misEmptyCopy,
  misEmptyReason,
  nextDue,
  reportingCompliance,
} from "../vipDashboardRollup.js";

const period = (over = {}) => ({
  period_key: "2026-06", label: "June 2026", status: "draft",
  due_date: "2026-07-05", overdue: false, ...over,
});

describe("misEmptyReason", () => {
  it("returns null when at least one period is submitted (not empty)", () => {
    expect(misEmptyReason([period({ status: "submitted" })])).toBeNull();
  });
  it("state 6 — not due yet: zero submitted, zero overdue", () => {
    const r = misEmptyReason([period({ due_date: "2026-07-05", overdue: false })]);
    expect(r).toEqual({ cause: "not_due_yet", due_date: "2026-07-05", due_label: "June 2026" });
  });
  it("state 7 — overdue backlog: zero submitted, N overdue, names the OLDEST", () => {
    const r = misEmptyReason([
      period({ period_key: "2026-04", label: "April 2026", due_date: "2026-05-05", overdue: true }),
      period({ period_key: "2026-05", label: "May 2026", due_date: "2026-06-05", overdue: true }),
    ]);
    expect(r).toEqual({ cause: "overdue_backlog", count: 2, oldest_label: "April 2026", oldest_due: "2026-05-05" });
  });
  it("mixes an overdue backlog with a not-yet-due period: counts only the overdue ones", () => {
    const r = misEmptyReason([
      period({ period_key: "2026-04", label: "April 2026", due_date: "2026-05-05", overdue: true }),
      period({ period_key: "2026-06", label: "June 2026", due_date: "2026-07-05", overdue: false }),
    ]);
    expect(r).toEqual({ cause: "overdue_backlog", count: 1, oldest_label: "April 2026", oldest_due: "2026-05-05" });
  });
});

describe("reportingCompliance", () => {
  it("state 9 — nothing due yet: total_due 0, not '0%'", () => {
    expect(reportingCompliance({ monthly: [period({ overdue: false })], quarterly: [] }))
      .toEqual({ total_due: 0, submitted: 0, pct: null });
  });
  it("state 10 — something due, none submitted", () => {
    const r = reportingCompliance({ monthly: [period({ overdue: true })], quarterly: [] });
    expect(r).toEqual({ total_due: 1, submitted: 0, pct: 0 });
  });
  it("counts a submitted period as due even though overdue is always false once submitted", () => {
    const r = reportingCompliance({ monthly: [period({ status: "submitted", overdue: false })], quarterly: [] });
    expect(r).toEqual({ total_due: 1, submitted: 1, pct: 100 });
  });
  it("never reads due_date directly — composes only from status/overdue (Global Constraints)", () => {
    // A period with a due_date in the past but overdue:false (should not happen from the
    // real backend, but this proves the function does not do its own date comparison).
    const r = reportingCompliance({ monthly: [period({ due_date: "2020-01-01", overdue: false })], quarterly: [] });
    expect(r.total_due).toBe(0);
  });
  it("combines monthly and quarterly into one denominator", () => {
    const r = reportingCompliance({
      monthly: [period({ status: "submitted" })],
      quarterly: [period({ period_key: "FY26-27-Q1", label: "Q1 FY26-27", overdue: true })],
    });
    expect(r).toEqual({ total_due: 2, submitted: 1, pct: 50 });
  });
});

describe("nextDue", () => {
  it("state 11 — no draft period at all: fully caught up", () => {
    expect(nextDue({ monthly: [period({ status: "submitted" })], quarterly: [] }, "2026-06-20")).toBeNull();
  });
  it("picks the earliest draft by due_date across monthly and quarterly", () => {
    const r = nextDue({
      monthly: [period({ due_date: "2026-07-05" })],
      quarterly: [period({ period_key: "FY26-27-Q1", label: "Q1 FY26-27", due_date: "2026-06-15" })],
    }, "2026-06-01");
    expect(r.period_key).toBe("FY26-27-Q1");
    expect(r.kind).toBe("quarterly");
    expect(r.days_remaining).toBe(14);
  });
  it("days_remaining is negative for an overdue period, not clamped to zero", () => {
    const r = nextDue({ monthly: [period({ due_date: "2026-06-01", overdue: true })], quarterly: [] }, "2026-06-10");
    expect(r.days_remaining).toBe(-9);
  });
});

// ── cashRunway ────────────────────────────────────────────────────────────

const monthlyBundle = (over = {}) => ({
  period: { id: "p1", kind: "monthly", period_key: "2026-06", label: "June 2026", status: "submitted", ...over.period },
  metrics: over.metrics ?? [
    { metric_key: "cash_in_bank", actual: 50 },
    { metric_key: "net_burn_month", actual: 10 },
    { metric_key: "runway_months", actual: 8 },
  ],
  entries: over.entries ?? {},
});

describe("cashRunway", () => {
  it("no submitted monthly bundle -> null", () => {
    expect(cashRunway([monthlyBundle({ period: { status: "draft" } })])).toBeNull();
  });
  it("no bundles at all -> null", () => {
    expect(cashRunway([])).toBeNull();
  });
  it("reads runway_months.actual verbatim — never cash_in_bank / net_burn_month (Open Question 4)", () => {
    // cash_in_bank / net_burn_month here would be 50 / 10 = 5, which
    // deliberately disagrees with the founder-typed runway_months (8) — so
    // a "helpful" refactor to compute it trips this test.
    const r = cashRunway([monthlyBundle()]);
    expect(r).toEqual({
      period_key: "2026-06", period_label: "June 2026",
      cash_in_bank: 50, net_burn_month: 10, runway_months: 8,
    });
  });
  it("picks the latest submitted period when more than one exists", () => {
    const older = monthlyBundle({ period: { period_key: "2026-05", label: "May 2026", status: "submitted" } });
    const newer = monthlyBundle({
      period: { period_key: "2026-06", label: "June 2026", status: "submitted" },
      metrics: [{ metric_key: "runway_months", actual: 3 }],
    });
    const r = cashRunway([older, newer]);
    expect(r.period_key).toBe("2026-06");
    expect(r.runway_months).toBe(3);
  });
});

// ── metricTrend ───────────────────────────────────────────────────────────

describe("metricTrend", () => {
  it("zero submitted -> empty periods and empty series for every key", () => {
    const t = metricTrend([monthlyBundle({ period: { status: "draft" } })]);
    expect(t.periods).toEqual([]);
    expect(Object.keys(t.series)).toEqual([
      "revenue_month", "cash_in_bank", "runway_months",
      "headcount_eom", "deployments_field", "trl_level",
    ]);
    for (const key of Object.keys(t.series)) expect(t.series[key]).toEqual([]);
  });

  it("state 8 — exactly one submitted: each series has exactly one point", () => {
    const t = metricTrend([monthlyBundle()]);
    expect(t.periods).toEqual(["2026-06"]);
    expect(t.series.cash_in_bank).toEqual([{ period_key: "2026-06", label: "June 2026", value: 50 }]);
    expect(t.series.revenue_month).toEqual([{ period_key: "2026-06", label: "June 2026", value: null }]);
  });

  it("sorts ascending by period_key across two submitted periods", () => {
    const may = monthlyBundle({
      period: { period_key: "2026-05", label: "May 2026", status: "submitted" },
      metrics: [{ metric_key: "cash_in_bank", actual: 40 }],
    });
    const june = monthlyBundle({ metrics: [{ metric_key: "cash_in_bank", actual: 50 }] });
    const t = metricTrend([june, may]);
    expect(t.periods).toEqual(["2026-05", "2026-06"]);
    expect(t.series.cash_in_bank.map((p) => p.value)).toEqual([40, 50]);
  });

  it("a metric never entered renders a null value, not a crash", () => {
    const t = metricTrend([monthlyBundle({ metrics: [] })]);
    expect(t.series.trl_level).toEqual([{ period_key: "2026-06", label: "June 2026", value: null }]);
  });
});

// ── milestonesAndRisks ────────────────────────────────────────────────────

describe("milestonesAndRisks", () => {
  it("null bundle -> null", () => {
    expect(milestonesAndRisks(null)).toBeNull();
  });

  it("a Done milestone is excluded from every status group", () => {
    const bundle = monthlyBundle({
      entries: {
        milestones: [
          { data: { milestone: "Ship v1", status: "Done" } },
          { data: { milestone: "Pilot #2", status: "On Track" } },
        ],
        risks: [],
      },
    });
    const r = milestonesAndRisks(bundle);
    expect(r.milestones_by_status["On Track"]).toHaveLength(1);
    expect(r.milestones_by_status["At Risk"]).toHaveLength(0);
    expect(r.milestones_by_status["Blocked"]).toHaveLength(0);
    const allShown = [
      ...r.milestones_by_status["On Track"],
      ...r.milestones_by_status["At Risk"],
      ...r.milestones_by_status["Blocked"],
    ];
    expect(allShown.some((m) => m.data.status === "Done")).toBe(false);
  });

  it("every risk row is returned unfiltered — risks has no closed state and no carry-forward to exclude", () => {
    const bundle = monthlyBundle({
      entries: {
        milestones: [],
        risks: [
          { data: { severity: "red", what_happened: "Vendor slip" } },
          { data: { severity: "amber", what_happened: "Hiring delay" } },
        ],
      },
    });
    const r = milestonesAndRisks(bundle);
    expect(r.risks).toHaveLength(2);
  });
});

// ── airTile ────────────────────────────────────────────────────────────────

describe("airTile", () => {
  it("returns exactly the locked shape, delta always unavailable (Open Questions 2/5)", () => {
    const bundle = {
      round: { id: "r1", round_label: "FY26-27-Q2", status: "draft", submitted_at: null, verified_at: null },
      rollups: {
        claimed: { technology: 3, commercial: 2, overall: 2 },
        verified: { technology: null, commercial: null, overall: null },
      },
    };
    expect(airTile(bundle)).toEqual({
      overall_claimed: 2, overall_verified: null, tech_claimed: 3, comm_claimed: 2,
      delta: { available: false, reason: "no_endpoint_for_prior_rounds" },
    });
  });

  it("delta.available is false even when verified levels ARE populated", () => {
    const bundle = {
      round: { id: "r1", round_label: "FY26-27-Q2", status: "submitted" },
      rollups: {
        claimed: { technology: 3, commercial: 2, overall: 2 },
        verified: { technology: 3, commercial: 2, overall: 2 },
      },
    };
    expect(airTile(bundle).delta).toEqual({ available: false, reason: "no_endpoint_for_prior_rounds" });
  });
});

// ── activityFeed ───────────────────────────────────────────────────────────

describe("activityFeed", () => {
  const roundBase = { id: "r1", round_label: "FY26-27-Q2" };

  it("never emits a milestone-status-flip event (Open Question 6), even when two bundles' milestones differ", () => {
    const monthA = monthlyBundle({
      period: { period_key: "2026-05", label: "May 2026", status: "submitted", submitted_at: "2026-06-01T00:00:00Z" },
      entries: { milestones: [{ data: { milestone: "Pilot", status: "On Track" } }] },
    });
    const monthB = monthlyBundle({
      period: { period_key: "2026-06", label: "June 2026", status: "submitted", submitted_at: "2026-07-01T00:00:00Z" },
      entries: { milestones: [{ data: { milestone: "Pilot", status: "At Risk" } }] },
    });
    const events = activityFeed({ round: roundBase }, [monthA, monthB], []);
    expect(events.some((e) => /flip/i.test(e.text))).toBe(false);
    expect(events.some((e) => /pilot/i.test(e.text))).toBe(false);
  });

  it("an AIR round with verified_at null contributes no verified event but submitted_at still does", () => {
    const events = activityFeed(
      { round: { ...roundBase, submitted_at: "2026-06-01T00:00:00Z", verified_at: null } },
      [],
      [],
    );
    expect(events).toHaveLength(1);
    expect(events[0].text).toMatch(/submitted/i);
    expect(events.some((e) => /verified/i.test(e.text))).toBe(false);
  });

  it("sorts newest-first and caps at 8", () => {
    const bundles = Array.from({ length: 10 }, (_, i) =>
      monthlyBundle({
        period: {
          period_key: `2026-${String(i + 1).padStart(2, "0")}`,
          label: `Month ${i + 1}`,
          status: "submitted",
          submitted_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        },
      }));
    const events = activityFeed({ round: roundBase }, bundles, []);
    expect(events).toHaveLength(8);
    expect(events[0].text).toContain("Month 10");
    expect(events[7].text).toContain("Month 3");
  });
});

// misEmptyCopy lived in three files as three byte-identical copies until it
// was consolidated into the rollup module. The point of one definition is
// that the two causes stay distinguishable; these assert exactly that, so a
// future edit collapsing them back into one sentence fails loudly.
describe("misEmptyCopy", () => {
  it("returns null when there is no empty reason", () => {
    expect(misEmptyCopy(null)).toBeNull();
  });

  it("names the backlog size and the oldest period when periods are overdue", () => {
    const copy = misEmptyCopy({
      cause: "overdue_backlog", count: 3,
      oldest_label: "May 2026", oldest_due: "2026-06-10",
    });
    expect(copy).toContain("3 period(s) are overdue");
    expect(copy).toContain("May 2026");
    expect(copy).toContain("2026-06-10");
  });

  it("says when the first report is due when nothing is overdue yet", () => {
    const copy = misEmptyCopy({ cause: "not_due_yet", due_date: "2026-09-10" });
    expect(copy).toContain("first one is due 2026-09-10");
    expect(copy).not.toContain("overdue");
  });

  it("gives the two causes genuinely different copy", () => {
    const backlog = misEmptyCopy({
      cause: "overdue_backlog", count: 2,
      oldest_label: "May 2026", oldest_due: "2026-06-10",
    });
    const notDue = misEmptyCopy({ cause: "not_due_yet", due_date: "2026-09-10" });
    expect(backlog).not.toEqual(notDue);
  });
});
