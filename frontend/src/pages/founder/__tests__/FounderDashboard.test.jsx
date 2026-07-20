import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderDashboard from "../FounderDashboard.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const TEAM = [
  { id: "m1", name: "Priya Ramachandran" },
  { id: "m2", name: "Arjun Nair" },
  { id: "m3", name: "Meera Das" },
];

// Amounts are deliberately all distinct so fmtL(...) renders a unique ₹XL
// string per field (avoids ambiguous getByText matches) — except
// budget_drawn, which — like the mockup's drawnLabel — is intentionally
// reused in both the "Budget drawn" stat tile and the "Total drawn" row.
const RESIDENCY = {
  app: {
    project_name: "Neonatal sepsis monitor",
    cohort: "Cohort 04",
    team_names: ["Priya Ramachandran", "Arjun Nair", "Meera Das"],
    week: 3,
    weeks_total: 24,
    weeks_remaining: 21,
  },
  tiles: {
    derisking_pct: 20,
    validated: 1,
    total_experiments: 5,
    tasks_done: 2,
    tasks_total: 5,
    budget_drawn: 1577000, // -> ₹15.77L
    budget_pct: 63,
    next_milestone: { label: "Gate 1 · Discovery", week: 8, in_weeks: 5 },
  },
  experiments: [
    { id: "e1", short: "Acoustic features carry signal.", status: "running", status_label: "Running", risk: "high", range_label: "Wk 1–6" },
    { id: "e2", short: "Bedside unit runs in power budget.", status: "not-started", status_label: "Not started", risk: "medium", range_label: "Wk 14–19" },
    { id: "e3", short: "Clinicians act on pre-culture alert.", status: "validated", status_label: "Validated", risk: "high", range_label: "Wk 1–5" },
  ],
  feed: [
    { color: "green", text: "MoU with partner NICU signed", meta: "Priya · 2 days ago" },
    { color: "amber", text: "Shadow-mode logging harness in progress", meta: "Arjun · T3" },
    { color: "blue", text: "Office hours with Dr. Krishnan", meta: "Tomorrow, Tue · 30 min" },
    { color: "dim", text: "Retrospective recordings pending hospital export", meta: "Meera · T1" },
  ],
  expense: {
    monthly_payroll: 540000, // -> ₹5.4L
    payroll_drawn: 373000, // -> ₹3.73L
    bom_total: 92300, // -> ₹0.92L
    equip_total: 450000, // -> ₹4.5L
    remaining: 923000, // -> ₹9.23L
    drawn_pct: 63,
    segments: {
      payroll_amount: 373000,
      capital_amount: 542300,
      remaining_amount: 923000,
      payroll_pct: 14.92,
      capital_pct: 21.69,
      remaining_pct: 63.39,
    },
    proc_committed: 150000, // -> ₹1.5L
    proc_quoted: 465000, // -> ₹4.65L
    proc_count: 4,
  },
  review_status: "approved",
};

function mockLoad({ residency = RESIDENCY, team = TEAM } = {}) {
  vi.spyOn(founderApi, "getResidency").mockResolvedValue(residency);
  vi.spyOn(founderApi, "listTeam").mockResolvedValue(team);
}

function renderDash() {
  return render(<MemoryRouter><FounderDashboard /></MemoryRouter>);
}

describe("FounderDashboard — residency command center", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the header and the 4 stat tiles", async () => {
    mockLoad();
    renderDash();

    expect(await screen.findByText("Neonatal sepsis monitor")).toBeInTheDocument();
    expect(screen.getByText("TIR · Cohort 04 · Priya Ramachandran, Arjun Nair, Meera Das")).toBeInTheDocument();
    expect(screen.getByText("Week 3 of 24")).toBeInTheDocument();
    expect(screen.getByText("21 weeks remaining")).toBeInTheDocument();

    // Derisking progress — value is "20" as a direct text node + a nested
    // <small>%</small> (RTL's default text matcher only considers an
    // element's own direct text nodes, so "20" matches the value div alone).
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("1 of 5 experiments validated")).toBeInTheDocument();

    // Workplan — value is "2" as a direct text node + a nested <small>/5</small>.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("activities complete")).toBeInTheDocument();

    // Budget drawn — reused verbatim in the expense card's "Total drawn" row.
    expect(screen.getAllByText("₹15.77L").length).toBe(2);
    expect(screen.getByText("63% of ₹25L non-dilutive")).toBeInTheDocument();

    // Next milestone (dark tile)
    expect(screen.getByText("Gate 1 · Discovery")).toBeInTheDocument();
    expect(screen.getByText("Week 8 · in 5 weeks")).toBeInTheDocument();
  });

  it("renders the Experiments panel and the This-week feed", async () => {
    mockLoad();
    const { container } = renderDash();
    await screen.findByText("Neonatal sepsis monitor");

    const expRows = container.querySelectorAll(".fj-dash-exp-row");
    expect(expRows.length).toBe(3);
    expect(expRows[0].textContent).toContain("Acoustic features carry signal.");
    expect(expRows[0].textContent).toContain("Running");
    expect(expRows[0].textContent).toContain("Wk 1–6");
    expect(expRows[2].textContent).toContain("Validated");

    const feedRows = container.querySelectorAll(".fj-dash-feed-row");
    expect(feedRows.length).toBe(4);
    expect(feedRows[0].textContent).toContain("MoU with partner NICU signed");
    expect(feedRows[0].textContent).toContain("Priya · 2 days ago");
  });

  it("renders the expense tracking tiles and the stacked budget bar", async () => {
    mockLoad();
    const { container } = renderDash();
    await screen.findByText("Neonatal sepsis monitor");

    // 4 expense mini-tiles
    expect(screen.getByText("₹5.4L")).toBeInTheDocument(); // monthly payroll
    expect(screen.getByText("3 people · ₹3.73L drawn")).toBeInTheDocument();
    expect(screen.getByText("₹0.92L")).toBeInTheDocument(); // BOM
    expect(screen.getByText("₹4.5L")).toBeInTheDocument(); // equipment
    expect(screen.getByText("₹9.23L")).toBeInTheDocument(); // remaining
    expect(screen.getByText("of ₹25L account")).toBeInTheDocument();

    // Stacked bar + legend (from the reused BudgetBar component)
    expect(container.querySelector(".fj-budget-bar")).toBeInTheDocument();
    expect(screen.getByText("Payroll drawn")).toBeInTheDocument();
    expect(screen.getByText("Capital (BOM + equipment)")).toBeInTheDocument();
    // "Remaining" labels both the mini-tile and the legend swatch.
    expect(screen.getAllByText("Remaining").length).toBe(2);

    // Procurement footer line
    const procText = container.querySelector(".fj-dash-proc-text");
    expect(procText.textContent).toContain("₹1.5L");
    expect(procText.textContent).toContain("committed");
    expect(procText.textContent).toContain("₹4.65L");
    expect(procText.textContent).toContain("quoted");
    expect(procText.textContent).toContain("4 items");
  });

  it("renders the read-only compact Gantt at the bottom", async () => {
    mockLoad();
    const { container } = renderDash();
    await screen.findByText("Neonatal sepsis monitor");

    const gantt = container.querySelector(".fj-gantt.compact");
    expect(gantt).toBeInTheDocument();
    expect(gantt.querySelectorAll(".fj-gantt-rail-row").length).toBe(3);
    // compact mode has no start/weeks number inputs (read-only)
    expect(gantt.querySelectorAll("input").length).toBe(0);
  });

  it("exposes the cross-navigation links and doesn't throw on click", async () => {
    mockLoad();
    renderDash();
    await screen.findByText("Neonatal sepsis monitor");

    expect(screen.getByText("Manage organization →")).toBeInTheDocument();
    expect(screen.getByText("View procurement →")).toBeInTheDocument();
    expect(screen.getByText("Adjust →")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Manage organization →"));
    fireEvent.click(screen.getByText("View procurement →"));
    fireEvent.click(screen.getByText("Adjust →"));
  });

  it("waits for both the residency bundle and the team roster before rendering", async () => {
    mockLoad();
    renderDash();
    await waitFor(() => expect(founderApi.getResidency).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(founderApi.listTeam).toHaveBeenCalledTimes(1));
  });
});
