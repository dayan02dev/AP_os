import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "lead@x.io", roles: ["leadership"] }, logout: () => {} }),
}));

const row = (over) => ({
  track: "tir", native_track: "tir", display_id: "TIR-1", status: "under_review",
  project_name: "P", founder: { name: "F", affiliation: "O" },
  industry: { label: "Robotics" }, stage: { label: "Lab" },
  ai_score_overall: 7, submitted_at: "2026-07-01T00:00:00Z",
  reco: { yes: 0, maybe: 0, no: 0 }, ...over,
});

const REJECTED = [
  row({ id: "R1", project_name: "GateOneReject", status: "rejected", gate2_decision: null, pipeline_stage: "gate1_rejected" }),
  row({ id: "R2", project_name: "FinalReject", status: "rejected", gate2_decision: "rejected", pipeline_stage: "final_rejected" }),
];
const ALL = [
  row({ id: "U1", project_name: "Under", track: "sip", native_track: "sip", status: "under_review", review_count: 1, reco: { yes: 1, maybe: 0, no: 0 } }),
  row({ id: "J1", project_name: "Pending", status: "jury_review", pipeline_stage: "final_pending", review_count: 2, reco: { yes: 2, maybe: 0, no: 0 } }),
  row({ id: "M1", project_name: "Moved", status: "evaluated", pipeline_stage: "reviewed", review_count: 0, track: "sip", native_track: "tir", moved_to_track: "sip" }),
  ...REJECTED,
];

const STAGES = {
  submitted: 2, under_review: 76, reviewed: 345, gate1_rejected: 134, final_pending: 10,
  final_rejected: 20, final_selected: 16, offered: 0, onboarded: 2, on_hold: 0, waitlisted: 0, withdrawn: 0,
};
const STATS = {
  totals: { apps_submitted: 605, tir_count: 400, sip_count: 205, avg_ai_score: 7.6 },
  funnel: { profiles: 1250, started: 1117, drafted: 1421, submitted: 605, in_review: 76, advanced: 48, decided: 18 },
  ai_score_overalls: Array.from({ length: 602 }, () => 7),
  ai_scored_count: 602,
  ai_component_means: { problem: 7.70, solution: 7.91, tech: 7.82, founders: 6.38, commitment: 7.25 },
  status_counts: [{ id: "accepted", label: "Accepted", n: 26 }],
  pipeline_breakdown: { total: 605, stages: STAGES, gate1_selected: 48, rejected_total: 154, by_track: {} },
};

vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getStats: vi.fn(),
    getIndustryCategories: vi.fn(),
    listApplications: vi.fn(),
    getApplication: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock("../../../lib/icDocumentsApi.js", () => ({
  icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) },
}));

import LeadershipDashboard, { buildApplicationsCsv } from "../LeadershipDashboard.jsx";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { clearStickyState } from "../../../hooks/useStickyState.js";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderDash() {
  return render(
    <MemoryRouter initialEntries={["/leadership"]}>
      <Routes>
        <Route path="/leadership" element={<LeadershipDashboard />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openApps({ filters = true } = {}) {
  renderDash();
  fireEvent.click(screen.getByRole("button", { name: /^Applications/i }));
  await waitFor(() => expect(screen.getByText("Under")).toBeTruthy());
  if (filters) fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
}

const calls = () => leadershipApi.listApplications.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  clearStickyState();
  leadershipApi.getStats.mockResolvedValue(STATS);
  leadershipApi.getIndustryCategories.mockResolvedValue({
    categories: [{ id: "rob", label: "Robotics", count: 500 }], total: 589, unclassified: 16,
  });
  leadershipApi.listApplications.mockImplementation((p = {}) => {
    // Mirrors the backend: stage keys filter on pipeline_stage, raw statuses
    // on status; recommendation none/single split on review_count.
    let rows = ALL;
    if (["gate1_rejected", "final_rejected", "final_pending", "final_selected", "reviewed"].includes(p.status)) {
      rows = ALL.filter((r) => r.pipeline_stage === p.status);
    } else if (p.status) rows = ALL.filter((r) => r.status === p.status);
    if (p.recommendation === "none") rows = rows.filter((r) => r.review_count === 0);
    else if (p.recommendation === "single") rows = rows.filter((r) => r.review_count === 1);
    return Promise.resolve({ applications: rows, total: rows.length, limit: p.limit, offset: p.offset });
  });
});


describe("Dashboard funnel (LEAD-14)", () => {
  it("uses distinct starters for the Started step so the funnel narrows", async () => {
    renderDash();
    const step = (await screen.findByText("Started")).closest(".lp-funnel-step");
    expect(within(step).getByText("1117")).toBeTruthy();
    expect(screen.queryByText("1421")).toBeNull();
    expect(screen.queryByText("Drafted")).toBeNull();
  });

  it("labels Decided by what it counts", async () => {
    renderDash();
    const step = (await screen.findByText("Decided")).closest(".lp-funnel-step");
    expect(within(step).getByText("18")).toBeTruthy();
    expect(within(step).queryByText(/offered \+ onboarded/)).toBeNull();
    expect(within(step).getByText(/final selected/i)).toBeTruthy();
  });
});

describe("Applications — industry chips follow the track filter", () => {
  it("refetches industry counts scoped to the active track", async () => {
    leadershipApi.getIndustryCategories.mockImplementation((p) => Promise.resolve(
      p?.track === "sip"
        ? { categories: [{ id: "rob", label: "Robotics", count: 7 }], total: 7, unclassified: { count: 1 } }
        : { categories: [{ id: "rob", label: "Robotics", count: 500 }], total: 589, unclassified: 16 },
    ));
    await openApps();
    const chip = () => screen.getByRole("button", { name: /^Robotics/ });
    expect(within(chip()).getByText("500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    await waitFor(() => expect(within(chip()).getByText("7")).toBeTruthy());
    expect(leadershipApi.getIndustryCategories).toHaveBeenCalledWith({ track: "sip" });
    fireEvent.click(screen.getByRole("button", { name: "All tracks" }));
    await waitFor(() => expect(within(chip()).getByText("500")).toBeTruthy());
  });
});

describe("Applications — more sortable columns", () => {
  it.each([
    ["Stage", "stage"],
    ["Reviewer score", "reviewer_score"],
    ["Reviewers", "reviewers"],
  ])("%s header sorts server-side", async (label, param) => {
    await openApps({ filters: false });
    const th = screen.getAllByRole("columnheader").find((h) => h.textContent.trim() === label);
    fireEvent.click(th);
    await waitFor(() => expect(calls().some((p) => p.sort === param && p.order === "asc")).toBe(true));
  });
});

describe("AppDrawer — detached reviewers", () => {
  it("lists a reviewer unassigned after review instead of an empty assigned date", async () => {
    leadershipApi.getApplication.mockResolvedValueOnce({
      id: "U1", track: "sip", native_track: "sip", display_id: "VIP-1",
      application: {}, reviews: [{ id: "r1", reviewer_user_id: "rv1", reviewer_name: "Asha", submitted_at: "2026-02-01" }],
      reviewer_assignments: [{ id: null, reviewer_user_id: "rv1", reviewer_name: "Asha", assigned_at: null,
        completed_at: "2026-02-01", detached: true, reviewer_status: "evaluated" }],
      status_history: [],
    });
    await openApps({ filters: false });
    fireEvent.click(screen.getByText("Under"));
    const head = await screen.findByRole("button", { name: /Reviewer assignments/ });
    await waitFor(() => expect(within(head).getByText("1")).toBeTruthy());
    fireEvent.click(head);
    expect(await screen.findByText(/Unassigned after review/)).toBeTruthy();
  });
});
