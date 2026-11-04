// SWARM2 admin_gate — NEW Admin Review (Gate 1) repros @ 837ccf0.
// Each test asserts the CORRECT behaviour, so it FAILS on the bug.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn(), getApplication: vi.fn(),
    moveTrack: vi.fn(),
  },
}));
vi.mock("../../../../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) } }));
vi.mock("../screens/ApplicationSummaryCard", () => ({ default: () => <div>SUMMARY</div> }));

import AdminGate1 from "../screens/AdminGate1.jsx";
import { ComparativeReviewModel } from "../screens/ComparativeReviewModel.jsx";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { adaptDetail } from "../../../../lib/adminDataAdapter";

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

describe("Gate1 History 'Decided' column", () => {
  it("shows the 1st-gate decision date, not the later final-round decision date", async () => {
    // Approved at gate 1 on 2026-07-01, rejected in the final round on 2026-09-15.
    const row = beRow("h1", {
      status: "rejected", decision: "rejected", decided_at: "2026-09-15T10:00:00Z",
      gate1_decision: "jury_review", gate1_decided_at: "2026-07-01T10:00:00Z",
      gate2_decision: "rejected",
    });
    adminPlatformApi.getPipeline.mockImplementation((params) =>
      Promise.resolve(params?.status === "evaluated"
        ? { applications: [], total: 0 }
        : { applications: [row], total: 1 }));
    render(<AdminGate1 goDetail={() => {}} />);
    fireEvent.click(await screen.findByText(/C · Decision history/));
    const name = await screen.findByText("App-h1");
    const tr = name.closest("tr");
    // BUG: adaptPipelineRow maps decidedAt from `decided_at` (latest decision of ANY gate);
    // gate1_decided_at is ignored, so the gate-1 history shows 2026-09-15.
    expect(within(tr).queryByText("2026-07-01")).not.toBeNull();
  });
});

