// SWARM admin_pipeline — Admin Review (Gate 1) repros.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn(), getApplication: vi.fn(),
    moveTrack: vi.fn(),
  },
}));
vi.mock("../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) } }));
vi.mock("../pages/admin/platform/screens/ApplicationSummaryCard", () => ({ default: () => <div>SUMMARY</div> }));

import AdminGate1 from "../pages/admin/platform/screens/AdminGate1.jsx";
import { adminPlatformApi } from "../lib/adminPlatformApi";

// Backend-shaped pipeline row (fetch_pipeline) for an evaluated app.
const beRow = (id, extra = {}) => ({
  id, applicationId: `TIR-${id}`, track: "tir", native_track: "tir", name: `App-${id}`,
  founder: "F", industry: "Robotics", stage: "Idea", ai_score_overall: 7.0, status: "evaluated",
  decision: null, batches: [], reviewer_score: 8.0, reviewers: { submitted: 2, assigned: 2 },
  reco: { yes: 2, maybe: 0, no: 0 }, review_count: 2, flags: [], submitted_at: "2026-05-01T00:00:00Z",
  ...extra,
});

// Backend-shaped detail payload with two reviews: first reviewer gives 4s, second 10s.
// Weighted consensus (backend reviewer_score) = 7.0.
const beDetail = (id) => ({
  id, track: "tir", native_track: "tir", display_id: `TIR-${id}`, project_name: `App-${id}`,
  founder: { name: "F" }, industry: { label: "Robotics" }, stage: "Idea",
  application: { status: "evaluated", submitted_at: "2026-05-01T00:00:00Z" },
  ai_screening: { score_overall: 7.0 },
  reviews: [
    { reviewer_user_id: "r1", reviewer_name: "Low", submitted_at: "2026-06-01", recommendation: "no",
      score_problem: 4, score_solution: 4, score_tech: 4, score_founders: 4, score_commitment: 4 },
    { reviewer_user_id: "r2", reviewer_name: "High", submitted_at: "2026-06-02", recommendation: "yes",
      score_problem: 10, score_solution: 10, score_tech: 10, score_founders: 10, score_commitment: 10 },
  ],
  reviewer_score: 7.0, reviewer_weights: { r1: 1, r2: 1 },
  reviewer_assignments: [], status_history: [], decision: null, meta: null, batch: null, batches: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

describe("Gate1 Variant A score card", () => {
  it("shows the weighted reviewer consensus (7.00), not the first reviewer's score", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("a1")], total: 1 });
    adminPlatformApi.getApplication.mockResolvedValue(beDetail("a1"));
    render(<AdminGate1 goDetail={() => {}} />);
    await screen.findByText("App-a1");
    // wait for the per-app detail to merge in
    await waitFor(() => expect(adminPlatformApi.getApplication).toHaveBeenCalled());
    await screen.findByText("High");
    const label = screen.getByText(/Reviewer Overall/);
    const card = label.closest(".os-card");
    // BUG: card shows 4.00 (reviews[0] overall) instead of 7.00 (reviewer_score)
    expect(card.textContent).toContain("7.00");
  });
});

describe("Gate1 Variant B push feedback", () => {
  it("keeps the per-item failure banner visible after Push Decisions", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("b1"), beRow("b2")], total: 2 });
    adminPlatformApi.bulkDecide.mockResolvedValue({ results: [
      { application_id: "b1", status: "decided" },
      { application_id: "b2", status: "illegal_transition" },
    ] });
    render(<AdminGate1 goDetail={() => {}} />);
    await screen.findByText(/A · Status/);
    await waitFor(() => expect(adminPlatformApi.getPipeline).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText(/B · Batch decision/));
    await screen.findByText("App-b1");
    const rejectBtns = screen.getAllByRole("button", { name: "Reject" });
    fireEvent.click(rejectBtns[0]);
    fireEvent.click(rejectBtns[1]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Push Decisions \(2\)/ })); });
    await waitFor(() => expect(adminPlatformApi.bulkDecide).toHaveBeenCalled());
    // let the reload settle
    await screen.findByText(/Batch decision room/);
    // BUG: reload flips loading → LoadingState unmounts the variant, wiping the note.
    expect(screen.queryByText(/1 failed/)).not.toBeNull();
  });
});

describe("Gate1 auto-rationale sent to backend", () => {
  it("Batch reject sends a generated rationale, not an admin-entered one", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("c1")], total: 1 });
    adminPlatformApi.bulkDecide.mockResolvedValue({ results: [{ application_id: "c1", status: "decided" }] });
    render(<AdminGate1 goDetail={() => {}} />);
    await waitFor(() => expect(adminPlatformApi.getPipeline).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText(/B · Batch decision/));
    await screen.findByText("App-c1");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Push Decisions \(1\)/ })); });
    const body = adminPlatformApi.bulkDecide.mock.calls[0][0];
    expect(body.items[0].rationale).toBe("Batch decision — REJECTED");
  });
});

describe("Gate1 Variant A illegal re-decide message", () => {
  it("re-deciding a just-rejected app shows a generic 'Request failed'", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("d1"), beRow("d2")], total: 2 });
    adminPlatformApi.getApplication.mockImplementation((t, id) => Promise.resolve(beDetail(id)));
    const { ApiError } = await import("../lib/api.js");
    adminPlatformApi.decide
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError({ status: 422, code: "illegal_transition", message: "Request failed",
        details: { code: "illegal_transition", from: "rejected", to: "jury_review", allowed: ["withdrawn"] } }));
    render(<AdminGate1 goDetail={() => {}} />);
    await screen.findByText("App-d1");
    fireEvent.change(screen.getByPlaceholderText(/Decision rationale/), { target: { value: "weak" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reject" })); });
    await screen.findByText("App-d2", {}, { timeout: 2000 });
    // go back to the decided tile and approve
    fireEvent.click(screen.getByRole("button", { name: /← Prev/ }));
    await screen.findByText("App-d1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve" })); });
    const msg = await screen.findByText(/Decision failed/);
    expect(msg.textContent).toMatch(/isn't allowed from the current status/);
  });
});
