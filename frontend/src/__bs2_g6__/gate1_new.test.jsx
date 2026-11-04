// SWARM2 admin_gate — NEW Admin Review (Gate 1) repros @ 837ccf0.
// Each test asserts the CORRECT behaviour, so it FAILS on the bug.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn(), getApplication: vi.fn(),
    moveTrack: vi.fn(),
  },
}));
vi.mock("../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) } }));
vi.mock("../pages/admin/platform/screens/ApplicationSummaryCard", () => ({ default: () => <div>SUMMARY</div> }));

import AdminGate1 from "../pages/admin/platform/screens/AdminGate1.jsx";
import { ComparativeReviewModel } from "../pages/admin/platform/screens/ComparativeReviewModel.jsx";
import { adminPlatformApi } from "../lib/adminPlatformApi";
import { adaptDetail } from "../lib/adminDataAdapter";

const beRow = (id, extra = {}) => ({
  id, applicationId: `TIR-${id}`, track: "tir", native_track: "tir", name: `App-${id}`,
  founder: "F", industry: "Robotics", stage: "Idea", ai_score_overall: 7.0, status: "evaluated",
  decision: null, batches: [], reviewer_score: 8.0, reviewers: { submitted: 2, assigned: 2 },
  reco: { yes: 2, maybe: 0, no: 0 }, review_count: 2, flags: [], submitted_at: "2026-05-01T00:00:00Z",
  gate1_decision: null, gate1_decided_at: null, decided_at: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

describe("Gate1 Variant A when the per-app detail fails to load", () => {
  it("does not claim 'No reviewer evaluations submitted yet' for an app the list says has 2 reviews", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("a1")], total: 1 });
    adminPlatformApi.getApplication.mockRejectedValue(new Error("Network timeout"));
    render(<AdminGate1 goDetail={() => {}} />);
    await screen.findByText("App-a1");
    await waitFor(() => expect(adminPlatformApi.getApplication).toHaveBeenCalled());
    // let the rejected detail settle into the cache (as `false`)
    await waitFor(() => expect(screen.queryByText(/Loading reviewer evaluations/)).toBeNull());
    // BUG: a failed load is cached as `false` and rendered exactly like an app with
    // zero reviews — the admin decides without seeing the 2 reviews and no error/retry.
    expect(screen.queryByText(/No reviewer evaluations submitted yet/)).toBeNull();
  });
});

describe("ComparativeReviewModel per-review score rounding", () => {
  it("a review whose overall is exactly 6.25 shows the backend's 1-dp value 6.2 (same as the consensus)", () => {
    // 22*6 + 30*6.5 + 22*6 + 14*6.5 = 550 ; 550/88 = 6.25 exactly.
    const d = adaptDetail({
      id: "A1", track: "tir", application: {}, reviewer_score: 6.2,
      reviews: [{ reviewer_user_id: "u1", reviewer_name: "R", submitted_at: "2026-10-01T00:00:00Z",
        recommendation: "yes", score_problem: 6, score_solution: 6.5, score_tech: 6, score_founders: 6.5 }],
    });
    expect(d.rev.overall).toBe(6.2); // consensus card / Reviewer Overall
    render(<ComparativeReviewModel startup={d} />);
    // BUG: rv.overall.toFixed(1) rounds the exact tie 6.25 up to "6.3" (Python round → 6.2).
    expect(screen.getByTestId("rv-overall").textContent).toBe("6.2");
  });
});

describe("Gate1 tab variant after returning from the detail page", () => {
  it("Back from a History row's detail lands on History again, not on Variant A", async () => {
    const row = beRow("h2", { status: "rejected", decision: "rejected", gate1_decision: "rejected",
      gate1_decided_at: "2026-07-01T10:00:00Z", decided_at: "2026-07-01T10:00:00Z" });
    adminPlatformApi.getPipeline.mockImplementation((params) =>
      Promise.resolve(params?.status === "evaluated"
        ? { applications: [beRow("e1")], total: 1 }
        : { applications: [row], total: 1 }));
    adminPlatformApi.getApplication.mockImplementation(() => new Promise(() => {}));
    const goDetail = vi.fn();
    const first = render(<AdminGate1 goDetail={goDetail} />);
    fireEvent.click(await screen.findByText(/C · Decision history/));
    fireEvent.click(await screen.findByText("App-h2"));
    expect(goDetail).toHaveBeenCalledWith("h2", "tir", "gate1", expect.any(Array));
    // AdminPortal swaps page → 'detail' (AdminGate1 unmounts); Back → page 'gate1' remounts it.
    first.unmount();
    render(<AdminGate1 goDetail={goDetail} />);
    await waitFor(() => expect(adminPlatformApi.getPipeline).toHaveBeenCalledTimes(4));
    // BUG: `variant` is plain useState("stack") → the admin is dumped on Variant A.
    expect(await screen.findByText(/Admin decision history/, {}, { timeout: 1000 })).toBeTruthy();
  });
});
