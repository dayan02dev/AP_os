// Seam test: the leadership dashboard fed payloads shaped exactly like the
// backend serializers (backend/app/routers/leadership.py list_applications /
// get_industry_categories, stats.build_pipeline_breakdown), with a list mock
// that filters the way the backend does (status = stage key, recommendation
// incl. none/single, industry=unclassified).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "lead@x.io", roles: ["leadership"] }, logout: () => {} }),
}));

// One row per backend serializer key (leadership.py list_applications).
const backendRow = (over) => ({
  id: "X", display_seq: 1, display_id: "TIR-1", track: "tir", native_track: "tir",
  moved_to_track: null, status: "under_review", pipeline_stage: "under_review",
  gate1_decision: null, gate2_decision: null, project_name: "P",
  founder: { name: "F", affiliation: "O" }, industry: { id: "rob", label: "Robotics" },
  stage: { label: "Lab" }, ai_score_overall: 7, reviewer_score: null,
  reviewers: null, review_count: 0, reco: null,
  submitted_at: "2026-07-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z",
  basic_full_name: "F", basic_email: "f@x.io", basic_org: "O", ...over,
});

const ROWS = [
  // Gate-1 reject: decision overlay makes status "rejected" while the raw
  // status was still "evaluated" → backend stage gate1_rejected.
  backendRow({ id: "G1", project_name: "GateOneReject", status: "rejected",
    pipeline_stage: "gate1_rejected", gate1_decision: "rejected" }),
  backendRow({ id: "F1", project_name: "FinalReject", status: "rejected",
    pipeline_stage: "final_rejected", gate1_decision: "shortlisted", gate2_decision: "rejected" }),
  // Selected comes from the backend stage alone — no IC docs on the client.
  backendRow({ id: "S1", project_name: "Selected", status: "jury_review",
    pipeline_stage: "final_selected", gate1_decision: "shortlisted" }),
  backendRow({ id: "N0", project_name: "NoReviews", review_count: 0, reco: null }),
  backendRow({ id: "O1", project_name: "OneReview", review_count: 1,
    reviewers: { submitted: 1, assigned: 2 }, reco: { yes: 1, maybe: 0, no: 0 } }),
  backendRow({ id: "U0", project_name: "NoIndustry", industry: null }),
];

function backendBucket(r) {
  const t = r.reco || {};
  const yes = t.yes || 0; const no = t.no || 0; const total = yes + (t.maybe || 0) + no;
  if (total >= 2) return yes >= 2 && no < 2 ? "yes" : no >= 2 && yes < 2 ? "no" : "maybe";
  return r.review_count === 1 ? "single" : "none";
}

const STAGE_KEYS = ["reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"];

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

import LeadershipDashboard from "../LeadershipDashboard.jsx";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { clearStickyState } from "../../../hooks/useStickyState.js";

const calls = () => leadershipApi.listApplications.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  clearStickyState();
  leadershipApi.getStats.mockResolvedValue({
    totals: { apps_submitted: 6 }, funnel: {}, ai_score_overalls: [], ai_scored_count: 0,
    ai_component_means: {}, status_counts: [],
    pipeline_breakdown: {
      total: 6, gate1_selected: 2, rejected_total: 2, by_track: {},
      stages: { submitted: 0, under_review: 3, reviewed: 0, gate1_rejected: 1, final_pending: 0,
        final_rejected: 1, final_selected: 1, offered: 0, onboarded: 0, on_hold: 0,
        waitlisted: 0, withdrawn: 0 },
    },
  });
  // get_industry_categories: `unclassified` is an object, plus apps_total.
  leadershipApi.getIndustryCategories.mockResolvedValue({
    categories: [{ id: "rob", label: "Robotics", count: 5 }], total: 5, cap: 12,
    remaining_slots: 11, apps_total: 6,
    unclassified: { id: "unclassified", label: "Unclassified", count: 1 },
  });
  leadershipApi.listApplications.mockImplementation((p = {}) => {
    let rows = ROWS;
    if (STAGE_KEYS.includes(p.status)) rows = rows.filter((r) => r.pipeline_stage === p.status);
    else if (p.status) rows = rows.filter((r) => r.status === p.status);
    if (p.recommendation) rows = rows.filter((r) => backendBucket(r) === p.recommendation);
    if (p.industry === "unclassified") rows = rows.filter((r) => !r.industry);
    return Promise.resolve({ applications: rows, total: rows.length, limit: p.limit, offset: p.offset });
  });
});

async function openApps() {
  render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /^Applications/i }));
  await waitFor(() => expect(screen.getByText("GateOneReject")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
}

describe("leadership ↔ backend seam", () => {
  it("labels rows from pipeline_stage (1st-gate vs final reject, final selected)", async () => {
    await openApps();
    expect(within(screen.getByText("GateOneReject").closest("tr")).getByText("1st-gate rejected")).toBeTruthy();
    expect(within(screen.getByText("FinalReject").closest("tr")).getByText("Final rejected")).toBeTruthy();
    expect(within(screen.getByText("Selected").closest("tr")).getByText("Final selected")).toBeTruthy();
  });

  it("stage chips send the backend stage key as status", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: /^Final rejected/ }));
    await waitFor(() => expect(screen.queryByText("GateOneReject")).toBeNull());
    expect(screen.getByText("FinalReject")).toBeTruthy();
    expect(calls().some((p) => p.status === "final_rejected")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Final selected/ }));
    await waitFor(() => expect(screen.queryByText("FinalReject")).toBeNull());
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(calls().some((p) => p.status === "final_selected")).toBe(true);
  });

  it("reco chips send none / single to the API", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "1 review" }));
    await waitFor(() => expect(screen.queryByText("NoReviews")).toBeNull());
    expect(screen.getByText("OneReview")).toBeTruthy();
    expect(calls().some((p) => p.recommendation === "single")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "No reviews" }));
    await waitFor(() => expect(screen.queryByText("OneReview")).toBeNull());
    expect(screen.getByText("NoReviews")).toBeTruthy();
    expect(calls().some((p) => p.recommendation === "none")).toBe(true);
  });

  it("reads the object-shaped unclassified count and makes it filterable", async () => {
    render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
    const bar = (await screen.findAllByText("Unclassified"))
      .map((el) => el.closest("button")).find(Boolean);
    expect(bar).toBeTruthy();
    expect(bar.disabled).toBe(false);
    fireEvent.click(bar);
    await waitFor(() => expect(calls().some((p) => p.industry === "unclassified")).toBe(true));
  });
});
