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
  row({ id: "U1", project_name: "Under", status: "under_review", review_count: 1, reco: { yes: 1, maybe: 0, no: 0 } }),
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
  funnel: {},
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

describe("Dashboard — gate-aware numbers", () => {
  it("shows a loading state, not 'No industry data yet.', until industries load", async () => {
    let resolve;
    leadershipApi.getIndustryCategories.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderDash();
    await screen.findByTestId("lp-breakdown");          // stats have landed
    expect(screen.queryByText("No industry data yet.")).toBeNull();
    expect(screen.getByText("Loading industries…")).toBeTruthy();
    resolve({ categories: [], total: 0, unclassified: 0 });
    expect(await screen.findByText("No industry data yet.")).toBeTruthy();
  });

  it("renders the pipeline breakdown with admin bucket labels", async () => {
    renderDash();
    const card = await screen.findByTestId("lp-breakdown");
    expect(within(card).getByText("1st-gate rejected")).toBeTruthy();
    expect(within(card).getByText("134")).toBeTruthy();
    expect(within(card).getByText("1st-gate selected")).toBeTruthy();
    expect(within(card).getByText("48")).toBeTruthy();
    expect(within(card).getByText("Final selected")).toBeTruthy();
    expect(within(card).getByText("Final rejected")).toBeTruthy();
    expect(within(card).getByText("Final pending")).toBeTruthy();
    expect(within(card).queryByText(/Accepted/)).toBeNull();
  });

  it("shows real AI component means and drops the invented noise copy", async () => {
    renderDash();
    await screen.findByText("7.9");
    expect(screen.getByText("6.4")).toBeTruthy();
    expect(screen.queryByText(/calibration noise/i)).toBeNull();
  });

  it("labels the average AI score by the scored count", async () => {
    renderDash();
    expect(await screen.findByText("across 602 scored apps")).toBeTruthy();
  });

  it("adds an Unclassified industry bar with one-decimal percentages", async () => {
    renderDash();
    await screen.findAllByText("Unclassified");
    // 500 / 605 = 82.6%, 16 / 605 = 2.6%, always one decimal.
    expect(screen.getByText(/82\.6%/)).toBeTruthy();
    expect(screen.getByText(/\s2\.6%/)).toBeTruthy();
  });
});

describe("Applications — status chips + labels", () => {
  it("status chips carry counts, split rejected, and hide empty / legacy buckets", async () => {
    await openApps();
    const chip = screen.getByRole("button", { name: /^1st-gate rejected/ });
    expect(within(chip).getByText("134")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Final rejected/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Offered/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Accepted/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Jury review/ })).toBeNull();
  });

  it("Final rejected sends the stage key and lists only gate-2 rejects", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: /^Final rejected/ }));
    await waitFor(() => expect(screen.queryByText("GateOneReject")).toBeNull());
    expect(screen.getByText("FinalReject")).toBeTruthy();
    expect(calls().some((p) => p.status === "final_rejected")).toBe(true);
    // Only stage keys the API knows (jury_review = selection load).
    expect(calls().every((p) => !p.status || ["final_rejected", "jury_review"].includes(p.status))).toBe(true);
  });

  it("labels jury_review rows Final pending, never Accepted", async () => {
    await openApps({ filters: false });
    const r = screen.getByText("Pending").closest("tr");
    expect(within(r).getByText("Final pending")).toBeTruthy();
    expect(screen.queryByText("Accepted")).toBeNull();
  });
});

describe("Applications — sort, search, reco", () => {
  it("sends sort/order to the API and resets to page 1", async () => {
    await openApps({ filters: false });
    fireEvent.click(screen.getByText("AI score"));
    await waitFor(() => expect(calls().some((p) => p.sort === "ai_score" && p.order === "asc" && p.offset === 0)).toBe(true));
    fireEvent.click(screen.getByText(/AI score/));
    await waitFor(() => expect(calls().some((p) => p.sort === "ai_score" && p.order === "desc")).toBe(true));
    fireEvent.click(screen.getByText("Submitted"));
    await waitFor(() => expect(calls().some((p) => p.sort === "submitted_at")).toBe(true));
  });

  it("trims the search before sending it", async () => {
    await openApps({ filters: false });
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "  hephos  " } });
    await waitFor(() => expect(calls().some((p) => p.search === "hephos")).toBe(true), { timeout: 2000 });
  });

  it("splits the reco dash into No reviews and 1 review", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "1 review" }));
    await waitFor(() => expect(screen.queryByText("Pending")).toBeNull());
    expect(screen.getByText("Under")).toBeTruthy();
    expect(calls().some((p) => p.recommendation === "single")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "No reviews" }));
    await waitFor(() => expect(screen.queryByText("Under")).toBeNull());
    expect(screen.getByText("Moved")).toBeTruthy();
  });
});

describe("Applications — navigation", () => {
  it("keeps the Applications tab and filters across a remount (Back from review)", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: /^1st-gate rejected/ }));
    await waitFor(() => expect(screen.queryByText("Under")).toBeNull());
    cleanup();
    renderDash();
    await waitFor(() => expect(screen.getByText("GateOneReject")).toBeTruthy());
    expect(screen.queryByText("Under")).toBeNull();
  });
});

describe("Applications — open review", () => {
  it("opens a moved app on its NATIVE track and stores the filtered list for Prev/Next", async () => {
    await openApps({ filters: false });
    fireEvent.click(screen.getByText("Moved"));
    fireEvent.click(await screen.findByRole("button", { name: /Review application/ }));
    expect(screen.getByTestId("where").textContent).toBe("/leadership/applications/tir/M1/review");
    const list = JSON.parse(sessionStorage.getItem("review_app_id_list"));
    expect(list.map((e) => e.id)).toEqual(ALL.map((r) => r.id));
    expect(list.find((e) => e.id === "M1").track).toBe("tir");
    expect(list.find((e) => e.id === "R2").label).toBe("Final rejected");
  });
});

describe("buildApplicationsCsv", () => {
  it("writes a moved app's native ID with the move marker", () => {
    const csv = buildApplicationsCsv([
      row({ display_id: "TIR-26255", track: "sip", native_track: "tir", moved_to_track: "sip" }),
    ]);
    const [, line] = csv.replace("\ufeff", "").split("\r\n");
    expect(line.startsWith("TIR-26255 (→ VIP),VIP,")).toBe(true);
  });

  it("includes the reviewer columns and the shared stage label", () => {
    const csv = buildApplicationsCsv([
      row({ status: "rejected", gate2_decision: "rejected", reviewer_score: 6.25,
        reviewers: { submitted: 2, assigned: 3 }, reco: { yes: 2, maybe: 0, no: 0 } }),
    ]);
    const [header, line] = csv.replace("﻿", "").split("\r\n");
    expect(header).toContain("Reviewer score");
    expect(header).toContain("Reviewers");
    expect(header).toContain("Reco");
    expect(line).toContain("Final rejected");
    expect(line).toContain("6.3");
    expect(line).toContain("2 / 3");
    expect(line).toContain("YES");
  });
});
