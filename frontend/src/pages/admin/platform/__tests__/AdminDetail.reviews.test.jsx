// AdminDetail Reviews section: reviewer feedback + "Decision history" (C1
// admin_decisions) in both the non-memo layout and the VIP memo Reviews tab,
// while gate 1 is open and after; reviewer rubric v3.2 (no Commitment row,
// 4-criterion weights normalised by 88).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import FIXTURE from "../../../../components/__tests__/fixtures/vipMemoV2.fake.json";

vi.mock("../../../../hooks/useAdminData", () => ({
  loadDetail: vi.fn(),
  useAdminData: () => ({ data: null, loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(),
    generateVipMemo: vi.fn(() => new Promise(() => {})),
    getVipMemoV2: vi.fn(),
    downloadVipMemoV2: vi.fn(),
  },
}));
vi.mock("../../../../lib/leadershipApi", () => ({ leadershipApi: {} }));
vi.mock("../../../../components/FullApplication", () => ({ default: () => <div data-testid="full-app" /> }));
vi.mock("../../../../components/VipMemoPreview.jsx", () => ({ default: () => <div /> }));

import { loadDetail } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { adaptDetail } from "../../../../lib/adminDataAdapter";
import { AdminDetail, weightedReviewerScore } from "../screens/AdminDetail";

const REVIEW = {
  id: "rv-1", reviewer_user_id: "u1", reviewer_name: "Asha Rao", submitted_at: "2026-10-20T10:00:00Z",
  score_problem: 8, score_solution: 6, score_tech: 7, score_founders: 9, score_commitment: null,
  recommendation: "no", quick_notes: "QUICKNOTE-TEXT", flags: [],
};
const DECISIONS = [
  { id: "d2", gate_stage: "gate1", decision: "rejected", rationale: "HUMAN-RATIONALE weak IP",
    decided_by: "a1", decided_by_name: "Admin A", decided_at: "2026-10-22T10:00:00Z" },
  { id: "d1", gate_stage: "gate1", decision: "on_hold", rationale: "Gate1: on_hold",
    decided_by: "a1", decided_by_name: "Admin A", decided_at: "2026-10-21T10:00:00Z" },
];
const detailPayload = (status, track = "tir") => adaptDetail({
  id: "A1", track, native_track: track, display_id: track === "sip" ? "VIP-1" : "TIR-1", project_name: "Rev App",
  application: { status, submitted_at: "2026-06-01T00:00:00Z" }, ai_screening: null,
  reviews: [REVIEW], reviewer_assignments: [], status_history: [],
  decision: { decision: "rejected", rationale: "HUMAN-RATIONALE weak IP" },
  admin_decisions: DECISIONS,
});
const mount = (status, track = "tir", id = "A1") => {
  loadDetail.mockResolvedValue(detailPayload(status, track));
  return render(<AdminDetail startupId={id} track={track} onBack={() => {}} />);
};

beforeEach(() => {
  vi.clearAllMocks();
  adminPlatformApi.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
});

describe("AdminDetail non-memo Reviews section", () => {
  it("gate 1 open: shows reviewer feedback and the decision history", async () => {
    mount("evaluated");
    await screen.findByRole("heading", { level: 2, name: /Rev App/ });
    expect(screen.getByRole("button", { name: "Apply decision" })).toBeTruthy();
    const card = document.querySelector(".rv-card");
    expect(within(card).getByText("Asha Rao")).toBeTruthy();
    expect(within(card).getByText("QUICKNOTE-TEXT")).toBeTruthy();
    const hist = screen.getByTestId("admin-decisions");
    expect(within(hist).getByText("Decision history")).toBeTruthy();
    expect(within(hist).getByText("HUMAN-RATIONALE weak IP")).toBeTruthy();
    // Auto rationale rows show without the machine text.
    expect(within(hist).queryByText("Gate1: on_hold")).toBeNull();
    expect(within(hist).getAllByText(/by Admin A/).length).toBe(2);
  });

  it("after gate 1: decision history still shown", async () => {
    mount("rejected");
    await screen.findByRole("heading", { level: 2, name: /Rev App/ });
    expect(screen.queryByRole("button", { name: "Apply decision" })).toBeNull();
    expect(within(screen.getByTestId("admin-decisions")).getByText("HUMAN-RATIONALE weak IP")).toBeTruthy();
  });

  it("Reviewer Scores card has no Commitment row and uses the 4-criterion score", async () => {
    mount("evaluated");
    await screen.findByRole("heading", { level: 2, name: /Rev App/ });
    expect(screen.queryByText("Commitment to be fully available")).toBeNull();
    expect(screen.getByText("Professional Profile of Founder")).toBeTruthy();
    // (8*22 + 6*30 + 7*22 + 9*14) / 88 = 7.227 → 7.2
    expect(screen.getAllByText("7.2").length).toBeGreaterThan(0);
  });
});

describe("AdminDetail VIP memo Reviews tab", () => {
  it("shows reviewer feedback and the decision history", async () => {
    adminPlatformApi.getVipMemoV2.mockResolvedValue(FIXTURE);
    mount("evaluated", "sip", "c8e45451-b9eb-4bed-8293-7a6782237168");
    await screen.findByText("VIP memo · Acme Robotics");
    expect(screen.queryByTestId("admin-decisions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.getByText("QUICKNOTE-TEXT")).toBeTruthy();
    expect(within(screen.getByTestId("admin-decisions")).getByText("HUMAN-RATIONALE weak IP")).toBeTruthy();
  });
});

describe("weightedReviewerScore (rubric v3.2)", () => {
  it("scores a 4-criterion review (no commitment) normalised by 88", () => {
    const rv = { reviewerId: "r1", problem: 8, solution: 6, tech: 7, founders: 9, submittedAt: "x" };
    expect(weightedReviewerScore([rv], {}, null)).toBe(Math.round(((8 * 22 + 6 * 30 + 7 * 22 + 9 * 14) / 88) * 10) / 10);
  });
  it("ignores a historical commitment score", () => {
    const base = { reviewerId: "r1", problem: 8, solution: 6, tech: 7, founders: 9, submittedAt: "x" };
    expect(weightedReviewerScore([{ ...base, commit: 1 }], {}, null))
      .toBe(weightedReviewerScore([base], {}, null));
  });
});
