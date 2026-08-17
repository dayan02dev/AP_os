// AdminVipMisPeriod — one MIS period, read-only (spec §7: "opening one
// renders it read-only"), plus Reopen. Covers the 409
// mis_later_period_submitted conflict surfaced as a link to the blocking
// period (not a generic error), and the distinct empty states: a period
// with no data filled in yet vs. a period that simply has no entries in a
// given section. Seams mocked: lib/adminVipApi (network). useAsync (ui.jsx)
// is real.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../lib/adminVipApi.js", () => ({
  adminVipApi: {
    getMisMatrix: vi.fn(),
    getMisPeriod: vi.fn(),
    reopenMisPeriod: vi.fn(),
  },
}));

import { adminVipApi } from "../../../../../lib/adminVipApi.js";
import { AdminVipMisPeriod } from "../AdminVipMisPeriod.jsx";

const CATALOG = {
  kind: "monthly",
  sections: [
    { id: "exec_summary", number: 1, title: "Executive Summary", hint: null, type: "narrative" },
    { id: "milestones", number: 3, title: "Milestones", hint: null, type: "entries" },
    { id: "key_metrics", number: 2, title: "Key Metrics", hint: null, type: "metrics" },
  ],
  entry_fields: {
    milestones: [
      { key: "milestone", label: "Milestone", type: "text" },
      { key: "status", label: "Status", type: "choice", options: ["Done", "On Track"] },
    ],
  },
  narrative_fields: {
    exec_summary: [
      { id: "exec.headline_win", prompt: "Headline win" },
      { id: "exec.biggest_concern", prompt: "Biggest concern" },
    ],
  },
  metrics: [
    { key: "revenue_month", label: "Revenue this month (₹ Lakh)", group: "commercial", unit: "₹L", computed: false },
  ],
  metric_groups: [{ key: "commercial", label: "Commercial" }],
};

function bundle(overrides = {}) {
  return {
    catalog: CATALOG,
    period: {
      id: "p1", kind: "monthly", period_key: "2026-06", label: "Jun 2026",
      period_start: "2026-06-01", period_end: "2026-06-30", due_date: "2026-07-05",
      status: "submitted", submitted_at: "2026-07-01T00:00:00Z", reopened_at: null,
    },
    metrics: [{ metric_key: "revenue_month", label: "Revenue this month (₹ Lakh)", group_key: "commercial",
      unit: "₹L", target: 10, actual: 12, prev_actual: 8, rag: "green", commentary: "Ahead of plan" }],
    financials: [], headcount: [],
    entries: { milestones: [{ id: "m1", section: "milestones", sort_order: 0,
      data: { milestone: "Ship v1", status: "Done" } }] },
    narrative: { "exec.headline_win": "Signed 2 pilots" }, // exec.biggest_concern intentionally blank
    derived: { metrics: { vs_last: { revenue_month: 4 } }, financials: { needs_gap: {} }, headcount: { net_change: {}, total: {} } },
    application_id: "app-1", startup: "Helios Robotics",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminVipMisPeriod — loading / error", () => {
  it("shows a loading state", () => {
    adminVipApi.getMisPeriod.mockReturnValue(new Promise(() => {}));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("maps not_found to real copy", async () => {
    adminVipApi.getMisPeriod.mockRejectedValue({ code: "not_found", details: {} });
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/could not be found/i)).toBeTruthy());
  });
});

describe("AdminVipMisPeriod — read-only render", () => {
  it("renders narrative answers, filled and blank distinctly", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Signed 2 pilots")).toBeTruthy());
    expect(screen.getByText(/not filled in/i)).toBeTruthy();
  });

  it("renders the entries table with real rows", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Ship v1")).toBeTruthy());
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("gives a section with zero entries its own 'no entries yet' copy, distinct from a blank narrative prompt", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle({ entries: { milestones: [] } }));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no entries/i)).toBeTruthy());
  });

  it("renders the metrics grid with target / actual / vs last in their own columns", async () => {
    // Scoped to the row's cells, not just "does '12' appear on the page
    // somewhere" — that weaker form of this assertion still passed with
    // target/actual swapped and vs_last hardcoded to a wrong literal.
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Revenue this month (₹ Lakh)")).toBeTruthy());
    const row = screen.getByText("Revenue this month (₹ Lakh)").closest("tr");
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    // Metric | Target | Actual | vs last | RAG | Commentary
    expect(cells).toEqual(["Revenue this month (₹ Lakh)", "10", "12", "4", "green", "Ahead of plan"]);
  });

  it("has no editable form controls anywhere — it is read-only", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    const { container } = render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Ship v1")).toBeTruthy());
    expect(container.querySelectorAll("input, textarea").length).toBe(0);
  });
});

// ── quarterly: FinancialsSection / HeadcountSection ─────────────────────
// These two section types are quarterly-only (mis_catalog.SECTIONS has no
// monthly section of type "financials" or "headcount") and, until now, had
// no test at all — every fixture above is monthly. Shapes here are taken
// from mis_query.py's real catalog/derived contract, not guessed:
//   - financials rows: {series, bucket, amount} (mis_query._fetch_financials)
//   - headcount rows: {category, current_count, exited, remarks}
//     (mis_query._fetch_headcount)
//   - derived.financials.needs_gap: {bucket: number|null} — null, never a
//     fabricated 0, when any of total/confirmed/projected is unfilled
//     (mis_query._needs_gap)
//   - derived.headcount.net_change: {category: number|null} — a per-category
//     delta against the PREVIOUS quarter, computed server-side
//     (mis_query._net_change / _headcount_derived). null when there is no
//     previous quarter. The Total row carries no net_change key at all,
//     because the source template leaves that cell blank
//     (mis_query._headcount_derived docstring, Critical-1 part 2).

const QUARTERLY_CATALOG = {
  kind: "quarterly",
  sections: [
    { id: "glance", number: 1, title: "Quarter at a Glance", hint: null, type: "narrative" },
    {
      id: "financials", number: 6, title: "Financials",
      hint: "Split between orders / paid pilots on books versus payment actually received.",
      type: "financials",
    },
    { id: "headcount", number: 8, title: "People", hint: null, type: "headcount" },
  ],
  entry_fields: {},
  narrative_fields: {
    financials: [{ id: "fin6.cash_in_bank", prompt: "Cash in bank" }],
    headcount: [{ id: "people.diversity", prompt: "Diversity" }],
  },
  financial_series: {
    annual_revenue: [
      { key: "annual_revenue_booked", label: "Revenue: orders / paid pilots on books" },
      { key: "annual_revenue_received", label: "Revenue: payment received" },
    ],
    needs: [
      { key: "needs_total", label: "Total needs" },
      { key: "needs_confirmed", label: "Confirmed funding" },
      { key: "needs_projected", label: "Projected (likely, not confirmed)" },
      { key: "needs_gap", label: "Gap" },
    ],
  },
  financial_buckets: {
    annual_revenue: ["FY22-23", "FY23-24", "FY24-25", "FY25-26", "FY26-27 YTD", "FY26-27 Proj"],
    needs: ["Q1 (Current)", "Q2 (Next)", "Q3", "Q4", "Q5"],
  },
  headcount_categories: [
    { key: "artpark_associated", label: "Employees (ARTPARK, associated with startup)" },
    { key: "startup", label: "Employees (Startup, not ARTPARK)" },
    { key: "consultants", label: "Consultants" },
    { key: "interns", label: "Interns" },
  ],
};

function quarterlyBundle(overrides = {}) {
  return {
    catalog: QUARTERLY_CATALOG,
    period: {
      id: "p-q1", kind: "quarterly", period_key: "2026-Q1", label: "Q1 FY26-27",
      period_start: "2026-04-01", period_end: "2026-06-30", due_date: "2026-07-10",
      status: "submitted", submitted_at: "2026-07-05T00:00:00Z", reopened_at: null,
    },
    metrics: [],
    financials: [
      { series: "annual_revenue_booked", bucket: "FY25-26", amount: 120 },
      { series: "annual_revenue_received", bucket: "FY25-26", amount: 80 },
      { series: "needs_total", bucket: "Q1 (Current)", amount: 50 },
      { series: "needs_confirmed", bucket: "Q1 (Current)", amount: 30 },
      { series: "needs_projected", bucket: "Q1 (Current)", amount: 0 },
    ],
    headcount: [
      { category: "artpark_associated", current_count: 3, exited: 0, remarks: "Stable" },
      // Chosen so a naive "current_count - exited" recompute (8 - 5 = 3)
      // would silently match the historical +3-vs-truth-of-−2 defect if the
      // component ever stopped reading the server-derived net_change.
      { category: "startup", current_count: 8, exited: 5, remarks: "2 hires, 5 exits" },
      { category: "consultants", current_count: 0, exited: 0, remarks: null },
      // "interns" deliberately has NO row at all — the founder never filled
      // it in for this period. Current/exited must read "—", never "0".
    ],
    entries: {},
    narrative: {},
    derived: {
      metrics: { vs_last: {} },
      financials: {
        needs_gap: {
          "Q1 (Current)": 20, // 50 - 30 - 0, all three filled
          "Q2 (Next)": null,  // nothing filled for Q2 at all
          "Q3": null, "Q4": null, "Q5": null,
        },
      },
      headcount: {
        net_change: {
          artpark_associated: 1,
          startup: -2, // the server-computed truth; NOT 8 - 5
          consultants: null, // no previous quarter to compare against
          // "interns" has no row in `headcount` above, so mis_query never
          // emits a net_change entry for it either — key absent entirely.
        },
        total: {
          current_count: 11, // partial sum: 3 + 8 + 0 (interns has no row)
          exited: 5,          // 0 + 5 + 0
        },
      },
    },
    application_id: "app-1", startup: "Helios Robotics",
    ...overrides,
  };
}

describe("AdminVipMisPeriod — quarterly Financials section", () => {
  it("renders both financial_series groups against their own buckets", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Revenue: orders / paid pilots on books")).toBeTruthy());
    expect(screen.getByText("Revenue: payment received")).toBeTruthy();
    expect(screen.getByText("Total needs")).toBeTruthy();
    expect(screen.getByText("FY25-26")).toBeTruthy();
    expect(screen.getByText("Q1 (Current)")).toBeTruthy();
  });

  it("renders real filled amounts, including a real zero (not blank)", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("120")).toBeTruthy());
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    // needs_projected for Q1 is a real, entered 0 — must render "0", not "—".
    const projectedRow = screen.getByText("Projected (likely, not confirmed)").closest("tr");
    expect(projectedRow.querySelectorAll("td")[1].textContent).toBe("0");
  });

  it("renders the derived Gap row from derived.financials.needs_gap, not a typed amount", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    const { container } = render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Gap")).toBeTruthy());
    const gapRow = screen.getByText("Gap").closest("tr");
    const cells = Array.from(gapRow.querySelectorAll("td")).map((td) => td.textContent);
    // Q1 (Current) = 20 (50 - 30 - 0); every other bucket has nothing typed
    // at all for needs_total/confirmed/projected, so needs_gap is null there
    // — must render "—", never a fabricated 0.
    expect(cells).toEqual(["Gap", "20", "—", "—", "—", "—"]);
    expect(container.textContent).not.toMatch(/Gap.*\b0\b/);
  });
});

describe("AdminVipMisPeriod — quarterly Headcount section", () => {
  it("renders per-category current / exited / net change from the server-derived values", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Employees (Startup, not ARTPARK)")).toBeTruthy());

    const startupRow = screen.getByText("Employees (Startup, not ARTPARK)").closest("tr");
    const startupCells = Array.from(startupRow.querySelectorAll("td")).map((td) => td.textContent);
    // current 8, exited 5, net change is the server value -2 — NOT
    // current_count - exited (which would be +3, the exact shape of the
    // historical defect this build's notes call out).
    expect(startupCells).toEqual(["Employees (Startup, not ARTPARK)", "8", "5", "-2", "2 hires, 5 exits"]);
  });

  it("renders null net_change (no previous quarter) as em-dash, not 0", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Consultants").closest("tr")).toBeTruthy());
    const row = screen.getByText("Consultants").closest("tr");
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    // current_count 0 and exited 0 are REAL zeros (must show "0"); net_change
    // is null (no previous quarter) and must show "—", not a fabricated 0.
    expect(cells).toEqual(["Consultants", "0", "0", "—", "—"]);
  });

  it("renders a category with no row at all as '—' for current/exited/net change, not 0", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Interns").closest("tr")).toBeTruthy());
    const row = screen.getByText("Interns").closest("tr");
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["Interns", "—", "—", "—", "—"]);
  });

  it("never shows a net change figure on the Total row, even when the categories above it have real deltas", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Total").closest("tr")).toBeTruthy());
    const totalRow = screen.getByText("Total").closest("tr");
    const cells = Array.from(totalRow.querySelectorAll("td")).map((td) => td.textContent);
    // Total current_count 11, exited 5 (partial sums), net change column
    // blank — the source template's own Total row has no Net Change input
    // cell (mis_query._headcount_derived docstring).
    expect(cells).toEqual(["Total", "11", "5", "—", ""]);
  });

  it("still shows no Total net-change even if the bundle carries a stray total.net_change value", async () => {
    // Regression guard: the backend contract promises derived.headcount.total
    // never carries a net_change key, but if a future bundle accidentally
    // included one, the Total row must still not surface it as real data —
    // that cell has no server-computed meaning (see _headcount_derived).
    adminVipApi.getMisPeriod.mockResolvedValue(quarterlyBundle({
      derived: {
        ...quarterlyBundle().derived,
        headcount: { ...quarterlyBundle().derived.headcount, total: { current_count: 11, exited: 5, net_change: 3 } },
      },
    }));
    render(<AdminVipMisPeriod applicationId="app-1" kind="quarterly" periodKey="2026-Q1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Total").closest("tr")).toBeTruthy());
    const totalRow = screen.getByText("Total").closest("tr");
    const cells = Array.from(totalRow.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["Total", "11", "5", "—", ""]);
  });
});

describe("AdminVipMisPeriod — reopen", () => {
  it("offers Reopen only for a submitted period", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle({ period: { ...bundle().period, status: "draft" } }));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("hides Reopen when canWrite is false", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={false} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("reopens a submitted period and reports the result", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    adminVipApi.reopenMisPeriod.mockResolvedValue(bundle({ period: { ...bundle().period, status: "draft" } }));
    const onChanged = vi.fn();
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={onChanged} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reopen period$/i }));
    await waitFor(() => expect(adminVipApi.reopenMisPeriod).toHaveBeenCalledWith("app-1", "monthly", "2026-06"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("surfaces mis_later_period_submitted as a link to the blocking period, not a generic error", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    adminVipApi.reopenMisPeriod.mockRejectedValue({
      code: "mis_later_period_submitted",
      details: { period_key: "2026-07", label: "Jul 2026" },
    });
    const onNavigatePeriod = vi.fn();
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={onNavigatePeriod} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reopen period$/i }));

    const link = await screen.findByRole("button", { name: /Jul 2026/i });
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(onNavigatePeriod).toHaveBeenCalledWith("2026-07");
  });
});
