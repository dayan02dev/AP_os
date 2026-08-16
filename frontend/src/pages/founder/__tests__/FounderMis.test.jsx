import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderMis from "../FounderMis.jsx";
import { founderApi } from "../../../lib/founderApi.js";
import { ApiError } from "../../../lib/api.js";

// ── Fixture builders ──────────────────────────────────────────────────────
//
// Field ids/labels below are transcribed from mis_catalog.py (backend,
// frozen) — real ids, trimmed to the minimum set each test needs, not
// invented shapes. `bundle.catalog.sections` at the PERIOD level is a FLAT
// array already scoped to `kind` (mis_query._catalog_for_kind sets
// catalog["sections"] = cat.SECTIONS[kind] directly) — NOT keyed by kind a
// second time the way the INDEX-level catalog.sections is
// ({monthly: [...], quarterly: [...]}, per founder_mis._index_catalog).
// Fixtures here follow the real backend shape.

const MONTHLY_SECTIONS = [
  { id: "exec_summary", number: 1, title: "Executive Summary", hint: "5 bullets.", type: "narrative" },
  { id: "key_metrics", number: 2, title: "Key Metrics", hint: "Keep stable.", type: "metrics" },
  { id: "milestones", number: 3, title: "Technical Milestones", hint: null, type: "entries" },
];

const QUARTERLY_SECTIONS = [
  { id: "glance", number: 1, title: "Quarter at a Glance", hint: null, type: "narrative" },
  { id: "ip_assets", number: 2, title: "IP Register", hint: null, type: "entries" },
  { id: "financials", number: 6, title: "Financials", hint: "Gap row (red) matters most.", type: "financials" },
  { id: "headcount", number: 8, title: "People", hint: null, type: "headcount" },
  { id: "planned_vs_actual", number: 9, title: "Milestone Review & Next-Quarter Plan", hint: "Include slipped ones.", type: "entries" },
];

const METRIC_GROUPS = [{ key: "commercial", label: "Commercial" }];
const HEADCOUNT_CATEGORIES = [
  { key: "startup", label: "Startup employees" },
  { key: "interns", label: "Interns" },
];
const FINANCIAL_SERIES = {
  annual_revenue: [{ key: "annual_revenue_booked", label: "Revenue booked" }],
  needs: [{ key: "needs_total", label: "Total needs" }, { key: "needs_gap", label: "Gap" }],
};
const FINANCIAL_BUCKETS_INDEX = { needs: ["Q1 (Current)", "Q2 (Next)", "Q3", "Q4", "Q5"] };
const FINANCIAL_BUCKETS_PERIOD = {
  annual_revenue: ["FY22-23", "FY23-24", "FY24-25", "FY25-26", "FY26-27 YTD", "FY26-27 Proj"],
  needs: FINANCIAL_BUCKETS_INDEX.needs,
};

function monthlyPeriodCatalog(over = {}) {
  return {
    kind: "monthly",
    sections: MONTHLY_SECTIONS,
    entry_fields: {
      milestones: [
        { key: "milestone", label: "Milestone", type: "text" },
        { key: "status", label: "Status", type: "choice", options: ["Done", "On Track"] },
      ],
    },
    narrative_fields: { exec_summary: [{ id: "exec.headline_win", prompt: "Headline win" }] },
    metrics: [],
    metric_groups: METRIC_GROUPS,
    ...over,
  };
}

function quarterlyPeriodCatalog(over = {}) {
  return {
    kind: "quarterly",
    sections: QUARTERLY_SECTIONS,
    entry_fields: {
      ip_assets: [
        { key: "bucket", label: "Bucket", type: "choice", options: ["filed", "granted"] },
        { key: "title", label: "IP Title", type: "text" },
      ],
      planned_vs_actual: [
        { key: "planned", label: "Planned", type: "text" },
        { key: "outcome", label: "Outcome", type: "choice", options: ["met", "missed"] },
      ],
      next_milestones: [
        { key: "milestone", label: "Next Milestone", type: "text" },
        { key: "target_date", label: "Target date", type: "date" },
      ],
    },
    narrative_fields: {
      glance: [{ id: "glance.strategic_theme", prompt: "Strategic theme" }],
      financials: [{ id: "fin6.cash_in_bank", prompt: "Cash in bank" }],
      headcount: [{ id: "people.diversity", prompt: "Diversity" }],
      planned_vs_actual: [{ id: "gc.strategic_questions", prompt: "Strategic questions for the Governing Council" }],
    },
    financial_series: FINANCIAL_SERIES,
    financial_buckets: FINANCIAL_BUCKETS_PERIOD,
    headcount_categories: HEADCOUNT_CATEGORIES,
    ...over,
  };
}

function indexCatalog() {
  return {
    kinds: ["monthly", "quarterly"],
    sections: { monthly: MONTHLY_SECTIONS, quarterly: QUARTERLY_SECTIONS },
    narrative_fields: {
      ...monthlyPeriodCatalog().narrative_fields,
      ...quarterlyPeriodCatalog().narrative_fields,
    },
    entry_fields: {
      ...monthlyPeriodCatalog().entry_fields,
      ...quarterlyPeriodCatalog().entry_fields,
    },
    metrics: [],
    metric_groups: METRIC_GROUPS,
    headcount_categories: HEADCOUNT_CATEGORIES,
    financial_series: FINANCIAL_SERIES,
    financial_buckets: FINANCIAL_BUCKETS_INDEX,
  };
}

function metricRow(key, over = {}) {
  return {
    id: `metric-${key}`, period_id: "p1", metric_key: key, label: `Label ${key}`,
    group_key: "commercial", unit: "₹L", target: null, actual: null, prev_actual: null,
    rag: null, commentary: null, is_custom: false, sort_order: 1, ...over,
  };
}

function entryRow(section, data, over = {}) {
  return { id: `${section}-${JSON.stringify(data)}`, period_id: "p1", section, sort_order: 1, data, ...over };
}

function emptyDerived() {
  return {
    metrics: { vs_last: {} },
    financials: { needs_gap: {} },
    headcount: { net_change: {}, total: { current_count: null, exited: null } },
  };
}

function monthlyPeriodRow(periodKey, label, over = {}) {
  return {
    id: `m-${periodKey}`, kind: "monthly", period_key: periodKey, label,
    period_start: `${periodKey}-01`, period_end: `${periodKey}-28`, due_date: `${periodKey}-30`,
    status: "draft", submitted_at: null, reopened_at: null, ...over,
  };
}

function quarterlyPeriodRow(periodKey, label, over = {}) {
  return {
    id: `q-${periodKey}`, kind: "quarterly", period_key: periodKey, label,
    period_start: "2026-04-01", period_end: "2026-06-30", due_date: "2026-07-15",
    status: "draft", submitted_at: null, reopened_at: null, ...over,
  };
}

// The default monthly bundle: period_key "2026-06", the earliest DRAFT in
// MONTHLY_PERIODS_3 below (index 1 of 3) — so `isFirstPeriod` is FALSE for
// it, which is what drives the E7 assertion in the isFirstPeriod test.
function monthlyBundleJun(over = {}) {
  return {
    catalog: monthlyPeriodCatalog(),
    period: monthlyPeriodRow("2026-06", "Jun 2026"),
    metrics: [metricRow("revenue_month", {
      label: "Revenue this month", actual: 40, target: 12, rag: "green", commentary: "steady growth",
    })],
    financials: [],
    headcount: [],
    entries: {
      milestones: [
        entryRow("milestones", { milestone: "Ship MVP", status: "Done" }),
        entryRow("milestones", { milestone: "Pilot launch", status: "On Track" }),
      ],
    },
    narrative: {},
    derived: { ...emptyDerived(), metrics: { vs_last: { revenue_month: null } } },
    ...over,
  };
}

// The FIRST monthly period (index 0) — used for the E6 half of the
// isFirstPeriod test. Deliberately `submitted` so the same fixture also
// covers "submitted periods still read, and disable every input."
function monthlyBundleMay(over = {}) {
  return {
    catalog: monthlyPeriodCatalog(),
    period: monthlyPeriodRow("2026-05", "May 2026", { status: "submitted", submitted_at: "2026-06-01T00:00:00Z" }),
    metrics: [metricRow("revenue_month", { label: "Revenue this month", actual: 20 })],
    financials: [],
    headcount: [],
    entries: { milestones: [] },
    narrative: {},
    derived: { ...emptyDerived(), metrics: { vs_last: { revenue_month: null } } },
    ...over,
  };
}

function quarterlyBundleQ1(over = {}) {
  return {
    catalog: quarterlyPeriodCatalog(),
    period: quarterlyPeriodRow("FY26-27-Q1", "FY26-27 Q1"),
    metrics: [],
    financials: [{ id: "f1", period_id: "q1", series: "needs_total", bucket: "Q1 (Current)", amount: 100, sort_order: 1 }],
    headcount: [{ id: "h1", period_id: "q1", category: "startup", current_count: 5, exited: 1, remarks: "steady" }],
    entries: {
      ip_assets: [
        entryRow("ip_assets", { bucket: "filed", title: "Patent A" }),
        entryRow("ip_assets", { bucket: "granted", title: "Patent B" }),
      ],
      planned_vs_actual: [entryRow("planned_vs_actual", { planned: "Ship v2", outcome: "met" })],
      next_milestones: [entryRow("next_milestones", { milestone: "Launch v3", target_date: "2026-09-01" })],
    },
    narrative: {},
    derived: {
      ...emptyDerived(),
      financials: { needs_gap: { "Q1 (Current)": 40, "Q2 (Next)": null, "Q3": null, "Q4": null, "Q5": null } },
      headcount: { net_change: { startup: 2, interns: null }, total: { current_count: 5, exited: 1 } },
    },
    ...over,
  };
}

// Oldest-first, 3 periods: submitted, draft (earliest draft), draft (later).
// Default selection must land on "2026-06" — proving it over both a LATER
// draft ("2026-07") and an EARLIER submitted period ("2026-05").
const MONTHLY_PERIODS_3 = [
  { period_key: "2026-05", label: "May 2026", status: "submitted", due_date: "2026-06-05", overdue: false },
  { period_key: "2026-06", label: "Jun 2026", status: "draft", due_date: "2026-07-05", overdue: true },
  { period_key: "2026-07", label: "Jul 2026", status: "draft", due_date: "2026-08-05", overdue: false },
];
const QUARTERLY_PERIODS_1 = [
  { period_key: "FY26-27-Q1", label: "FY26-27 Q1", status: "draft", due_date: "2026-07-15", overdue: false },
];

function mainIndex(over = {}) {
  return { catalog: indexCatalog(), monthly: MONTHLY_PERIODS_3, quarterly: QUARTERLY_PERIODS_1, ...over };
}

// Resolves getMisPeriod(kind, key) against a plain {key: bundle} map so
// each test only has to declare the bundles it actually needs; a request
// for an undeclared key rejects loudly rather than silently returning
// undefined, so a wiring bug fails the test instead of hanging it.
function mockGetMisPeriod(map) {
  return vi.fn((kind, key) => {
    const b = map[key];
    if (!b) return Promise.reject(new Error(`no fixture for ${kind}/${key}`));
    return Promise.resolve(b);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("FounderMis — the MIS shell", () => {
  it("E1: renders the not-onboarded copy, no tabs, no getMisPeriod call, when both calendars are empty", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue({ catalog: indexCatalog(), monthly: [], quarterly: [] });
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod");
    render(<FounderMis />);
    await screen.findByText(/MIS reporting opens once your venture is onboarded/i);
    expect(screen.queryByText("Monthly")).not.toBeInTheDocument();
    expect(screen.queryByText("Quarterly")).not.toBeInTheDocument();
    expect(getMisPeriod).not.toHaveBeenCalled();
  });

  it("initial load calls getMis() exactly once and renders both kind tabs", async () => {
    const getMis = vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");
    expect(getMis).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
  });

  it("default selection picks the earliest DRAFT period, not a later draft or an earlier submitted one", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod")
      .mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");
    expect(getMisPeriod).toHaveBeenCalledWith("monthly", "2026-06");
    expect(getMisPeriod).not.toHaveBeenCalledWith("monthly", "2026-05");
    expect(getMisPeriod).not.toHaveBeenCalledWith("monthly", "2026-07");
  });

  it("default selection falls back to the most recent SUBMITTED period when none are draft", async () => {
    const idx = mainIndex({
      monthly: [
        { period_key: "2026-03", label: "Mar 2026", status: "submitted", due_date: "2026-04-05", overdue: false },
        { period_key: "2026-04", label: "Apr 2026", status: "submitted", due_date: "2026-05-05", overdue: false },
      ],
      quarterly: [],
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-04": monthlyBundleJun({ period: monthlyPeriodRow("2026-04", "Apr 2026", { status: "submitted" }) }),
    }));
    render(<FounderMis />);
    await waitFor(() => expect(getMisPeriod).toHaveBeenCalledWith("monthly", "2026-04"));
    expect(getMisPeriod).not.toHaveBeenCalledWith("monthly", "2026-03");
  });

  it("switching kind tabs does not call getMis() again, only fetches that kind's default period", async () => {
    const getMis = vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": monthlyBundleJun(),
      "FY26-27-Q1": quarterlyBundleQ1(),
    }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    fireEvent.click(screen.getByText("Quarterly"));
    await screen.findByText("Quarter at a Glance");

    expect(getMis).toHaveBeenCalledTimes(1);
    expect(getMisPeriod).toHaveBeenCalledWith("quarterly", "FY26-27-Q1");
  });

  it("selecting a period from PeriodPicker calls getMisPeriod(kind, key) and renders that period's sections", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": monthlyBundleJun(),
      "2026-05": monthlyBundleMay(),
    }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    fireEvent.click(screen.getByText("May 2026"));
    await waitFor(() => expect(getMisPeriod).toHaveBeenCalledWith("monthly", "2026-05"));
  });

  it("renders every section from the period bundle's catalog, in order, dispatched by type", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Executive Summary", "Key Metrics", "Technical Milestones"]);

    // narrative
    expect(screen.getByLabelText("Headline win")).toBeInTheDocument();
    // metrics
    expect(screen.getByLabelText("Actual")).toBeInTheDocument();
    // entries
    expect(screen.getByText("+ Add row")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Milestone").length).toBe(2);
  });

  it("quarterly planned_vs_actual renders both its own entries table and next_milestones, plus its narrative field", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "FY26-27-Q1": quarterlyBundleQ1() }));
    render(<FounderMis />);
    fireEvent.click(await screen.findByText("Quarterly"));
    await screen.findByText("Quarter at a Glance");

    // planned_vs_actual's own field
    expect(screen.getByDisplayValue("Ship v2")).toBeInTheDocument();
    // next_milestones' distinct field, unreachable unless SECTION_EXTRA_ENTRIES is unioned in
    expect(screen.getByDisplayValue("Launch v3")).toBeInTheDocument();
    // its §9.3 narrative sub-field
    expect(screen.getByLabelText("Strategic questions for the Governing Council")).toBeInTheDocument();
  });

  it("catalog-driven: renaming a section title in the fixture makes the new text appear", async () => {
    const idx = mainIndex({
      catalog: indexCatalog(),
    });
    idx.catalog.sections = {
      ...idx.catalog.sections,
      monthly: MONTHLY_SECTIONS.map((s) => (s.id === "exec_summary" ? { ...s, title: "Totally Renamed Section" } : s)),
    };
    const bundle = monthlyBundleJun();
    bundle.catalog = { ...bundle.catalog, sections: idx.catalog.sections.monthly };
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": bundle }));
    render(<FounderMis />);
    await screen.findByText("Totally Renamed Section");
    expect(screen.queryByText("Executive Summary")).not.toBeInTheDocument();
  });

  it("a narrative field edit calls putMisNarrative(kind, key, {field_id: value}) with just that one field", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    const putMisNarrative = vi.spyOn(founderApi, "putMisNarrative").mockResolvedValue(monthlyBundleJun());
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    const field = screen.getByLabelText("Headline win");
    fireEvent.change(field, { target: { value: "Big customer signed" } });
    fireEvent.blur(field);

    await waitFor(() => expect(putMisNarrative).toHaveBeenCalledWith(
      "monthly", "2026-06", { "exec.headline_win": "Big customer signed" },
    ));
  });

  it("a metrics field edit sends the FULL current row, not just the changed field (putMisMetrics)", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    const putMisMetrics = vi.spyOn(founderApi, "putMisMetrics").mockResolvedValue(monthlyBundleJun());
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    const actual = screen.getByLabelText("Actual");
    fireEvent.change(actual, { target: { value: "55" } });
    fireEvent.blur(actual);

    // `target: 12`, `rag: "green"`, `commentary: "steady growth"` were
    // already on the row before this edit — put_metrics is a full-row
    // upsert (vip_mis_metrics.upsert(..., on_conflict="period_id,metric_key")
    // writing every listed column), so omitting them here would silently
    // null them out server-side. Only `actual` changed.
    await waitFor(() => expect(putMisMetrics).toHaveBeenCalledWith("monthly", "2026-06", [{
      metric_key: "revenue_month", label: "Revenue this month",
      target: 12, actual: 55, rag: "green", commentary: "steady growth",
    }]));
  });

  it("an entries field edit calls putMisEntries with the section's FULL row array, not a partial diff", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    const putMisEntries = vi.spyOn(founderApi, "putMisEntries").mockResolvedValue(monthlyBundleJun());
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    const notesFields = screen.getAllByLabelText("Milestone");
    fireEvent.change(notesFields[0], { target: { value: "Ship MVP v2" } });
    fireEvent.blur(notesFields[0]);

    await waitFor(() => expect(putMisEntries).toHaveBeenCalled());
    const [kindArg, keyArg, sectionArg, rowsArg] = putMisEntries.mock.calls[0];
    expect(kindArg).toBe("monthly");
    expect(keyArg).toBe("2026-06");
    expect(sectionArg).toBe("milestones");
    expect(rowsArg).toHaveLength(2);
    expect(rowsArg[0].milestone).toBe("Ship MVP v2");
    expect(rowsArg[1].milestone).toBe("Pilot launch");
  });

  it("a financials cell edit calls putMisFinancials(kind, key, [oneRow])", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "FY26-27-Q1": quarterlyBundleQ1() }));
    const putMisFinancials = vi.spyOn(founderApi, "putMisFinancials").mockResolvedValue(quarterlyBundleQ1());
    render(<FounderMis />);
    fireEvent.click(await screen.findByText("Quarterly"));
    await screen.findByText("Quarter at a Glance");

    const cell = screen.getByLabelText("Total needs — Q1 (Current)");
    fireEvent.change(cell, { target: { value: "150" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(putMisFinancials).toHaveBeenCalledWith(
      "quarterly", "FY26-27-Q1", [{ series: "needs_total", bucket: "Q1 (Current)", amount: 150 }],
    ));
  });

  it("a headcount cell edit sends the FULL current row (putMisHeadcount), preserving untouched fields", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "FY26-27-Q1": quarterlyBundleQ1() }));
    const putMisHeadcount = vi.spyOn(founderApi, "putMisHeadcount").mockResolvedValue(quarterlyBundleQ1());
    render(<FounderMis />);
    fireEvent.click(await screen.findByText("Quarterly"));
    await screen.findByText("Quarter at a Glance");

    const cell = screen.getByLabelText("Startup employees — Current count");
    fireEvent.change(cell, { target: { value: "8" } });
    fireEvent.blur(cell);

    // `exited: 1` and `remarks: "steady"` were already on the row —
    // put_headcount is a full-row upsert too, so these must survive.
    await waitFor(() => expect(putMisHeadcount).toHaveBeenCalledWith(
      "quarterly", "FY26-27-Q1", [{ category: "startup", current_count: 8, exited: 1, remarks: "steady" }],
    ));
  });

  it("isFirstPeriod: E7 for the default (non-first) period, E6 after switching to the first period", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": monthlyBundleJun(),
      "2026-05": monthlyBundleMay(),
    }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");
    expect(screen.getByText("No comparable figure last period.")).toBeInTheDocument();
    expect(screen.queryByText("First reporting period — nothing to compare yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("May 2026"));
    await waitFor(() => expect(screen.getByText("First reporting period — nothing to compare yet.")).toBeInTheDocument());
    expect(screen.queryByText("No comparable figure last period.")).not.toBeInTheDocument();
  });

  it("a submitted period's bundle disables every input", async () => {
    const idx = mainIndex({ monthly: [{ period_key: "2026-05", label: "May 2026", status: "submitted", due_date: "2026-06-05", overdue: false }], quarterly: [] });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-05": monthlyBundleMay() }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");
    expect(screen.getByLabelText("Actual")).toBeDisabled();
    expect(screen.getByLabelText("Headline win")).toBeDisabled();
    expect(screen.queryByText("+ Add row")).not.toBeInTheDocument();
  });

  it("submit succeeds: calls submitMisPeriod, flips every input disabled, Submit no longer offered", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({ "2026-06": monthlyBundleJun() }));
    const submitMisPeriod = vi.spyOn(founderApi, "submitMisPeriod").mockResolvedValue(
      monthlyBundleJun({ period: monthlyPeriodRow("2026-06", "Jun 2026", { status: "submitted", submitted_at: "2026-08-17T00:00:00Z" }) }),
    );
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    fireEvent.click(screen.getByRole("button", { name: "Submit Jun 2026" }));

    await waitFor(() => expect(submitMisPeriod).toHaveBeenCalledWith("monthly", "2026-06"));
    await waitFor(() => expect(screen.getByLabelText("Actual")).toBeDisabled());
    expect(screen.queryByRole("button", { name: /^Submit/i })).not.toBeInTheDocument();
  });

  it("submit 409s mis_earlier_period_open: renders the dedicated blocked banner, not the generic error banner", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": monthlyBundleJun(),
      "2026-05": monthlyBundleMay(),
    }));
    vi.spyOn(founderApi, "submitMisPeriod").mockRejectedValue(new ApiError({
      status: 409, code: "mis_earlier_period_open", message: "Request failed",
      details: { period_key: "2026-05", label: "May 2026" },
    }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    fireEvent.click(screen.getByRole("button", { name: "Submit Jun 2026" }));

    await screen.findByText(/Submit May 2026 first\./);
    expect(screen.queryByText("Something went wrong saving that change.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to May 2026" }));
    await waitFor(() => expect(founderApi.getMisPeriod).toHaveBeenCalledWith("monthly", "2026-05"));
  });

  it("a write 409s mis_already_submitted: shows the distinct E24 copy and refetches, flipping the UI to disabled", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue(mainIndex());
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod")
      .mockResolvedValueOnce(monthlyBundleJun())
      .mockResolvedValueOnce(monthlyBundleJun({
        period: monthlyPeriodRow("2026-06", "Jun 2026", { status: "submitted", submitted_at: "2026-08-17T00:00:00Z" }),
      }));
    vi.spyOn(founderApi, "putMisNarrative").mockRejectedValue(new ApiError({
      status: 409, code: "mis_already_submitted", message: "Request failed",
    }));
    render(<FounderMis />);
    await screen.findByText("Executive Summary");

    const field = screen.getByLabelText("Headline win");
    fireEvent.change(field, { target: { value: "Late edit" } });
    fireEvent.blur(field);

    await screen.findByText("This period was submitted elsewhere — refreshing.");
    await waitFor(() => expect(getMisPeriod).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Actual")).toBeDisabled());
  });
});
