// Every AdminPipeline filter against rows built from BACKEND-shaped payloads
// run through the real adaptPipelineRow, so adapter gaps show up too.
// Covers ADM-F1 (withdrawn chip), ADM-F2 (faceted chip counts), ADM-F3
// (dashboard drill-down resets the other sticky filters), ADM-F6 (org search).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createBatch: vi.fn(), renameBatch: vi.fn(), deleteBatch: vi.fn(),
    assignBatch: vi.fn(), unassignBatch: vi.fn(), bulkDecide: vi.fn(),
    removeAppFromBatch: vi.fn(),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adaptPipelineRow } from "../../../../lib/adminDataAdapter";
import { AdminPipeline } from "../screens/AdminPipeline";
import { AdminDashboard } from "../screens/AdminDashboard";

const be = (o) => ({
  id: o.id, applicationId: o.appId, track: o.track, native_track: o.native || o.track,
  name: o.name, founder: o.founder || "F " + o.name, industry: o.industry ?? null,
  stage: "Idea", ai_score_overall: 7, status: o.status || "submitted",
  decision: null, gate1_decision: null, isHidden: false, isArchived: false,
  batch: o.batches?.[0]?.name ?? null, batches: o.batches || [],
  reviewer_score: null, reviewers: null, review_count: o.reviewCount ?? 0,
  reco: o.reco || null, email: o.email || `${o.id}@x.in`,
  submitted_at: o.sub || "2026-07-01T00:00:00Z", flags: [],
  moved_to_track: o.moved || null, gate2_decision: o.g2 || null,
});

const BE_ROWS = [
  be({ id: "t1", appId: "TIR-27301", track: "tir", name: "RoboArm", industry: "Robotics", status: "submitted",
       batches: [{ id: "b1", name: "Batch A" }] }),
  be({ id: "t2", appId: "TIR-27302", track: "tir", name: "SunGrid", industry: "Climate", status: "under_review",
       batches: [{ id: "b1", name: "Batch A" }], reco: { yes: 1, maybe: 0, no: 0 }, reviewCount: 1 }),
  be({ id: "t3", appId: "TIR-27303", track: "tir", name: "Quitter", industry: "Health", status: "withdrawn" }),
  be({ id: "v1", appId: "VIP-26201", track: "sip", name: "AgriBot", industry: "Climate", status: "submitted",
       batches: [{ id: "b2", name: "Batch V" }] }),
  be({ id: "v2", appId: "VIP-26202", track: "sip", name: "MedScan", industry: "Climate", status: "evaluated",
       reco: { yes: 2, maybe: 0, no: 0 }, reviewCount: 2, email: "ceo@medscan.io" }),
  // TIR app moved to VIP — effective track sip, native tir
  be({ id: "m1", appId: "TIR-27304", track: "sip", native: "tir", moved: "sip", name: "MovedCo",
       industry: null, status: "submitted" }),
];

let PIPE;
function mockData(rows = BE_ROWS) {
  PIPE = { startups: rows.map(adaptPipelineRow), total: rows.length };
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches") return { data: { batches: [{ id: "b1", name: "Batch A" }, { id: "b2", name: "Batch V" }] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "stats") return { data: { pipelineBreakdown: null, totals: {}, funnel: {}, statusCounts: [] }, loading: false, error: null, reload: vi.fn() };
    return { data: PIPE, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => { vi.clearAllMocks(); mockData(); });

const rowNames = () => screen.queryAllByTestId(/^pipeline-row-/).map((tr) => tr.getAttribute("data-testid").replace("pipeline-row-", ""));
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
const panel = () => document.querySelector(".lp-filter-panel");
const panelBtn = (re) => within(panel()).getAllByRole("button").find((b) => re.test(b.textContent));

describe("AdminPipeline — each filter on its own (Applications tab)", () => {
  it("unfiltered shows every row", () => {
    render(<AdminPipeline scopeKey="applications" />);
    expect(rowNames().sort()).toEqual(["m1", "t1", "t2", "t3", "v1", "v2"]);
  });
  it("track VIP uses EFFECTIVE track (moved TIR→VIP row included)", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(rowNames().sort()).toEqual(["m1", "v1", "v2"]);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(rowNames().sort()).toEqual(["t1", "t2", "t3"]);
  });
  it("status Evaluated", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Evaluated/));
    expect(rowNames()).toEqual(["v2"]);
  });
  it("industry Climate + Unspecified", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Climate/));
    expect(rowNames().sort()).toEqual(["t2", "v1", "v2"]);
    fireEvent.click(panelBtn(/Unspecified/));
    expect(rowNames()).toEqual(["m1"]);
  });
  it("batch filter + Unassigned", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Batch A/));
    expect(rowNames().sort()).toEqual(["t1", "t2"]);
    fireEvent.click(panelBtn(/^Unassigned/));
    expect(rowNames().sort()).toEqual(["m1", "t3", "v2"]);
  });
  it("reco Yes / 1 review / No reviews", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Yes/));
    expect(rowNames()).toEqual(["v2"]);
    fireEvent.click(panelBtn(/^1 review/));
    expect(rowNames()).toEqual(["t2"]);
  });
  it("search by name, founder, email, display-ID (TIR-/VIP-/bare digits)", () => {
    render(<AdminPipeline scopeKey="applications" />);
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: "sungrid" } });
    expect(rowNames()).toEqual(["t2"]);
    fireEvent.change(box, { target: { value: "F AgriBot" } });
    expect(rowNames()).toEqual(["v1"]);
    fireEvent.change(box, { target: { value: "medscan.io" } });
    expect(rowNames()).toEqual(["v2"]);
    fireEvent.change(box, { target: { value: "TIR-27304" } });
    expect(rowNames()).toEqual(["m1"]);
    fireEvent.change(box, { target: { value: "vip-26201" } });
    expect(rowNames()).toEqual(["v1"]);
    fireEvent.change(box, { target: { value: "27302" } });
    expect(rowNames()).toEqual(["t2"]);
  });
  it("combined track VIP + industry Climate + status Submitted", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    openPanel();
    fireEvent.click(panelBtn(/^Climate/));
    fireEvent.click(panelBtn(/^Submitted/));
    expect(rowNames()).toEqual(["v1"]);
  });
  it("Clear filters resets everything", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    openPanel();
    fireEvent.click(panelBtn(/^Climate/));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowNames()).toHaveLength(6);
  });
  it("sort by ID ascending orders by prefix then seq", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByText("ID"));
    expect(rowNames()).toEqual(["t1", "t2", "t3", "m1", "v1", "v2"]);
  });
});

describe("AdminPipeline — withdrawn, faceted counts, org search", () => {
  it("ADM-F1: withdrawn rows do not count/filter as Submitted", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Submitted/));
    // correct: only true submitted rows (t1, v1, m1) — withdrawn t3 must not appear
    expect(rowNames().sort()).toEqual(["m1", "t1", "v1"]);
  });
  it("ADM-F1: a Withdrawn status chip is offered when a withdrawn row exists", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    expect(panelBtn(/^Withdrawn/)).toBeTruthy();
  });
  it("ADM-F2: status chip counts follow the selected track", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    openPanel();
    const chip = panelBtn(/^Under review/); // only TIR has an under_review row
    // correct: VIP has 0 under_review rows → chip hidden or shows 0
    expect(chip ? chip.textContent : "Under review0").toMatch(/0$/);
  });
  it("ADM-F2: reco chip counts follow the selected track", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    openPanel();
    expect(panelBtn(/^1 review/).textContent).toMatch(/0$/); // the 1-review row is TIR
  });
  it("ADM-F2: batch chip counts follow the selected track", () => {
    render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    openPanel();
    expect(panelBtn(/^Batch A/).textContent).toMatch(/0$/); // Batch A rows are TIR only
  });
  it("ADM-F2: chip counts are faceted by the other active filters", () => {
    render(<AdminPipeline scopeKey="applications" />);
    openPanel();
    fireEvent.click(panelBtn(/^Submitted/));
    const climate = panelBtn(/^Climate/);
    fireEvent.click(climate);
    const shown = rowNames().length;
    expect(climate.textContent).toContain(String(shown));
  });
  it("ADM-F6: search covers the TIR organisation name", () => {
    const rows = [be({ id: "o1", appId: "TIR-1", track: "tir", name: "RoboArm", industry: "Robotics" })];
    rows[0].org = "Acme Labs Pvt Ltd"; // fetch_pipeline `org` (TIR basic_org)
    mockData(rows);
    render(<AdminPipeline scopeKey="applications" />);
    expect(screen.getByPlaceholderText(/org/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "acme" } });
    expect(rowNames()).toEqual(["o1"]);
  });
});

describe("Dashboard industry drill-down → Applications tab", () => {
  it("ADM-F3: drill-down resets stale sticky track/status/search so the list matches the click", () => {
    // 1) Admin earlier filtered Applications to TIR + Evaluated, left the tab
    const first = render(<AdminPipeline scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    first.unmount();
    // 2) Dashboard: click "Climate" (3 apps incl. VIP)
    let page = null;
    const d = render(<AdminDashboard go={(p) => { page = p; }} />);
    fireEvent.click(screen.getAllByText("Climate")[0]);
    expect(page).toBe("pipeline");
    d.unmount();
    // 3) Applications tab remounts: should show every Climate app the chart counted
    render(<AdminPipeline scopeKey="applications" />);
    expect(rowNames().sort()).toEqual(["t2", "v1", "v2"]);
  });
});
