// ADMPIPE-01: the Admin Review A-stack "Weighted reviewer consensus" card shows
// the backend consensus reviewer_score, not the first review merged over it.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn(), getApplication: vi.fn(),
    moveTrack: vi.fn(),
  },
}));
vi.mock("../../../../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) } }));
vi.mock("../screens/ApplicationSummaryCard", () => ({ default: () => <div>SUMMARY</div> }));

import AdminGate1 from "../screens/AdminGate1.jsx";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";

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
    expect(card.textContent).toContain("7.00");
  });
  it("keeps the list row's reviewer score when the detail carries none", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [beRow("a2")], total: 1 });
    adminPlatformApi.getApplication.mockResolvedValue({ ...beDetail("a2"), reviews: [], reviewer_score: null });
    render(<AdminGate1 goDetail={() => {}} />);
    await screen.findByText("App-a2");
    await waitFor(() => expect(adminPlatformApi.getApplication).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    const card = screen.getByText(/Reviewer Overall/).closest(".os-card");
    expect(card.textContent).toContain("8.00");
  });
});
