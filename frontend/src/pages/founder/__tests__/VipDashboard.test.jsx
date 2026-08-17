import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import VipDashboard from "../VipDashboard.jsx";
import { founderApi } from "../../../lib/founderApi.js";

// Mirrors mis_catalog.METRICS' own template order — see MetricTrendPanel's
// own test fixture for why this must not be alphabetical/insertion order.
const METRIC_LABELS = [
  { key: "revenue_month", label: "Revenue this month (₹ Lakh)", group: "commercial", unit: "₹L", computed: false },
  { key: "active_customers", label: "Active paying customers / pilots", group: "commercial", unit: "count", computed: false },
  { key: "deployments_field", label: "Deployments in field", group: "product_technology", unit: "count", computed: false },
  { key: "trl_level", label: "TRL Level (1–9)", group: "product_technology", unit: "1–9", computed: true },
  { key: "cash_in_bank", label: "Cash in bank (₹ Cr)", group: "financials", unit: "₹Cr", computed: false },
  { key: "net_burn_month", label: "Net burn / month (₹ Lakh)", group: "financials", unit: "₹L", computed: false },
  { key: "runway_months", label: "Runway (months)", group: "financials", unit: "months", computed: false },
  { key: "headcount_eom", label: "Headcount (end of month)", group: "team", unit: "count", computed: false },
];

const meFixture = (over = {}) => ({
  status: "onboarded", track: "sip", project_name: "Dharini", mou_signed: true,
  locked: { cohort: false, dashboard: false }, ...over,
});

const LEVER_DEFS = [
  ["architecture", "technology"], ["manufacturability", "technology"], ["reliability", "technology"],
  ["market", "commercial"], ["business_model", "commercial"], ["supply_chain", "commercial"],
];

const airFixture = (over = {}) => ({
  catalog: { levers: [], questions: {}, criteria: {}, documents: {} },
  round: { id: "r1", round_label: "FY26-27-Q2", status: "draft", submitted_at: null, verified_at: null, ...over.round },
  levers: over.levers || LEVER_DEFS.map(([lever, family]) => ({
    lever, name: lever, family, claimed_level: null, verified_level: null,
  })),
  rollups: over.rollups || {
    claimed: { technology: null, commercial: null, overall: null },
    verified: { technology: null, commercial: null, overall: null },
  },
});

const periodRow = (over = {}) => ({
  period_key: "2026-06", label: "June 2026", status: "draft",
  due_date: "2026-07-05", overdue: false, kind: "monthly", ...over,
});

const misFixture = (over = {}) => ({
  catalog: { metrics: METRIC_LABELS },
  monthly: over.monthly || [],
  quarterly: over.quarterly || [],
});

const periodBundle = (row, over = {}) => ({
  period: {
    id: row.period_key, kind: row.kind || "monthly", period_key: row.period_key, label: row.label,
    status: row.status, due_date: row.due_date, overdue: row.overdue,
    submitted_at: row.status === "submitted" ? "2026-06-01T00:00:00Z" : null, reopened_at: null,
    ...over.period,
  },
  metrics: over.metrics || [],
  entries: over.entries || {},
});

// Scoped lookup — several stat-tile labels ("AIR Scorecard", "Next due")
// are reused verbatim as headings inside the panels below the tile row, so
// screen.getByText(label) is ambiguous for them.
function statTile(label) {
  return Array.from(document.querySelectorAll(".fj-dash-tiles .fj-stat-tile"))
    .find((el) => el.querySelector(".fj-stat-label")?.textContent === label);
}

function mockRun({ me, air, mis, bundles = {} }) {
  vi.spyOn(founderApi, "me").mockResolvedValue(me);
  vi.spyOn(founderApi, "getAir").mockResolvedValue(air);
  vi.spyOn(founderApi, "getMis").mockResolvedValue(mis);
  vi.spyOn(founderApi, "getMisPeriod").mockImplementation((kind, key) => {
    const b = bundles[`${kind}:${key}`];
    if (!b) throw new Error(`unexpected getMisPeriod(${kind}, ${key})`);
    return Promise.resolve(b);
  });
}

describe("VipDashboard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fresh-onboarded: state-2 AIR copy, empty activity feed, state-6 trend/cash copy, state-12 milestones/risks copy, no state due yet", async () => {
    const monthly = [periodRow({ period_key: "2026-06", label: "June 2026", due_date: "2026-07-05", overdue: false, status: "draft" })];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: { "monthly:2026-06": periodBundle(monthly[0]) },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    // Tile 1 — AIR, nothing claimed.
    expect(screen.getByText(/haven't started this quarter's AIR self-assessment yet/i)).toBeInTheDocument();
    // Activity feed — one genuine cause, not two.
    expect(screen.getByText(/Nothing to show yet — your first submission will appear here/i)).toBeInTheDocument();
    // Metric trend AND the Cash & Runway tile both show state 6 (not due
    // yet), not state 7 — the plan requires byte-identical copy across
    // both surfaces, so more than one match is expected here.
    expect(screen.getAllByText("No monthly update filed yet — your first one is due 2026-07-05.").length).toBeGreaterThanOrEqual(1);
    // Milestones & risks — a current draft period DOES exist, so this is
    // state 12 (independent empty copy), never state 6/7's "no period at all" text.
    expect(screen.getByText(/No open milestones this period/i)).toBeInTheDocument();
    expect(screen.getByText(/No risks reported this period/i)).toBeInTheDocument();
    // Tile 2 — nothing due yet, never "0%".
    expect(screen.getByText("Nothing due yet")).toBeInTheDocument();
    // Tile 4 — a draft period exists and is due in the future.
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.queryByText(/All caught up/i)).not.toBeInTheDocument();
  });

  it("overdue backlog: state-7 copy in the trend panel + cash tile, Tile 4 points at the oldest overdue period", async () => {
    const monthly = [
      periodRow({ period_key: "2020-01", label: "Jan 2020", due_date: "2020-02-05", overdue: true, status: "draft" }),
      periodRow({ period_key: "2020-02", label: "Feb 2020", due_date: "2020-03-05", overdue: true, status: "draft" }),
      periodRow({ period_key: "2020-03", label: "Mar 2020", due_date: "2020-04-05", overdue: true, status: "draft" }),
    ];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: {
        "monthly:2020-01": periodBundle(monthly[0]),
        "monthly:2020-02": periodBundle(monthly[1]),
        "monthly:2020-03": periodBundle(monthly[2]),
      },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    const expected = "No monthly update filed yet — 3 period(s) are overdue, starting with Jan 2020 (due 2020-02-05).";
    expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
    // Tile 4 — dark "next due" tile points at the OLDEST overdue period.
    expect(screen.getByText("Jan 2020")).toBeInTheDocument();
    expect(screen.getByText(/days overdue/i)).toBeInTheDocument();
  });

  it("two submitted monthly periods: metric trend shows two real points, no single-point caption", async () => {
    const monthly = [
      periodRow({ period_key: "2026-05", label: "May 2026", due_date: "2026-06-05", overdue: false, status: "submitted" }),
      periodRow({ period_key: "2026-06", label: "June 2026", due_date: "2026-07-05", overdue: false, status: "submitted" }),
    ];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: {
        "monthly:2026-05": periodBundle(monthly[0], { metrics: [{ metric_key: "cash_in_bank", actual: 40 }, { metric_key: "runway_months", actual: 9 }] }),
        "monthly:2026-06": periodBundle(monthly[1], { metrics: [{ metric_key: "cash_in_bank", actual: 50 }, { metric_key: "runway_months", actual: 8 }] }),
      },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    expect(screen.queryByText(/First reported period/i)).not.toBeInTheDocument();
    const bars = document.querySelectorAll('[data-metric-key="cash_in_bank"] .vipd-trend-bar');
    expect(bars).toHaveLength(2);
    // Cash & runway tile reads the LATEST submitted period verbatim.
    expect(screen.getByText(/8 mo runway/i)).toBeInTheDocument();
  });

  it("calls getMisPeriod exactly once per period_key across monthly + quarterly combined", async () => {
    const monthly = [periodRow({ period_key: "2026-06", label: "June 2026" })];
    const quarterly = [periodRow({ period_key: "FY26-27-Q1", label: "Q1 FY26-27", kind: "quarterly", due_date: "2026-07-15" })];
    const mis = misFixture({ monthly, quarterly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: {
        "monthly:2026-06": periodBundle(monthly[0]),
        "quarterly:FY26-27-Q1": periodBundle(quarterly[0]),
      },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    expect(founderApi.getMisPeriod).toHaveBeenCalledTimes(2);
    expect(founderApi.getMisPeriod).toHaveBeenCalledWith("monthly", "2026-06");
    expect(founderApi.getMisPeriod).toHaveBeenCalledWith("quarterly", "FY26-27-Q1");
  });

  it("claimed-but-unverified AIR round: Tile 1 shows the claimed overall + 'Awaiting verification', and the tech/commercial sub split", async () => {
    // Seam-level gap: airTile()'s output shape is unit-tested in
    // vipDashboardRollup.test.js, but nothing exercised VipDashboard.jsx's
    // own inline JSX that turns { overall_claimed, overall_verified } into
    // the stat tile's badge — a duplicate of AirScorecardPanel's own
    // showVerifyBadge condition (see VipDashboard.jsx's header comment on
    // the duplication), which could silently drift out of sync from it.
    const monthly = [periodRow({ period_key: "2026-06", label: "June 2026", due_date: "2026-07-05", overdue: false, status: "draft" })];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture({
        rollups: {
          claimed: { technology: 6, commercial: 4, overall: 5 },
          verified: { technology: null, commercial: null, overall: null },
        },
      }),
      mis,
      bundles: { "monthly:2026-06": periodBundle(monthly[0]) },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    const tile = statTile("AIR Scorecard");
    expect(tile.querySelector(".fj-stat-value").textContent).toBe("5Awaiting verification");
    expect(tile.querySelector(".fj-stat-sub").textContent).toBe("Technology 6 · Commercial 4");
  });

  it("reporting compliance tile shows the exact 'filed + overdue' sub-text once something is overdue", async () => {
    // Seam gap: reportingCompliance()'s {total_due, submitted, pct} is unit
    // tested, but the sub-text string VipDashboard.jsx builds from it
    // (`${submitted} of ${total_due} periods filed + ${overdue} overdue`)
    // was asserted nowhere at the integration level.
    const monthly = [
      periodRow({ period_key: "2026-04", label: "Apr 2026", due_date: "2026-05-05", overdue: false, status: "submitted" }),
      periodRow({ period_key: "2026-05", label: "May 2026", due_date: "2026-06-05", overdue: true, status: "draft" }),
    ];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: {
        "monthly:2026-04": periodBundle(monthly[0]),
        "monthly:2026-05": periodBundle(monthly[1]),
      },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    const tile = statTile("Reporting compliance");
    expect(tile.querySelector(".fj-stat-value").textContent).toBe("50%");
    expect(tile.querySelector(".fj-stat-sub").textContent).toBe("1 of 2 periods filed + 1 overdue");
  });

  it("Tile 4 shows 'Due in N days' (positive form) for a draft period due in the future", async () => {
    // The overdue (negative-days) branch is covered by the "overdue
    // backlog" test above; the positive branch had no assertion anywhere.
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const monthly = [periodRow({ period_key: "2099-01", label: "Future Period", due_date: future, overdue: false, status: "draft" })];
    const mis = misFixture({ monthly });
    mockRun({
      me: meFixture(),
      air: airFixture(),
      mis,
      bundles: { "monthly:2099-01": periodBundle(monthly[0]) },
    });

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());

    const tile = statTile("Next due");
    expect(tile.querySelector(".fj-stat-value").textContent).toBe("Future Period");
    expect(tile.querySelector(".fj-stat-sub").textContent).toBe("Due in 10 days");
  });

  it("a failing getAir call surfaces ErrorState, not a partial render", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(meFixture());
    vi.spyOn(founderApi, "getAir").mockRejectedValue(new Error("boom"));
    vi.spyOn(founderApi, "getMis").mockResolvedValue(misFixture());

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.queryByText("Dharini")).not.toBeInTheDocument();
  });

  it("a failing getMisPeriod call surfaces ErrorState, not a partial render", async () => {
    const monthly = [periodRow({ period_key: "2026-06", label: "June 2026" })];
    vi.spyOn(founderApi, "me").mockResolvedValue(meFixture());
    vi.spyOn(founderApi, "getAir").mockResolvedValue(airFixture());
    vi.spyOn(founderApi, "getMis").mockResolvedValue(misFixture({ monthly }));
    vi.spyOn(founderApi, "getMisPeriod").mockRejectedValue(new Error("period fetch failed"));

    render(<VipDashboard />);
    await waitFor(() => expect(screen.getByText("period fetch failed")).toBeInTheDocument());
    expect(screen.queryByText("Dharini")).not.toBeInTheDocument();
  });
});
