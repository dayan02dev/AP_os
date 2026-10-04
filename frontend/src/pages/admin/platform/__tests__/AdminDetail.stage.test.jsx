// ADM-09 one reviewer score everywhere (weighted, like the list) and
// ADM-20 header chip + decide panel follow the app's stage.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// IC documents served to the detail (ADM-20: Accepted needs every memo signed).
let IC_DOCS = [];
vi.mock("../../../../hooks/useAdminData", () => ({
  loadDetail: vi.fn(),
  useAdminData: (resource) => (resource === "icDocuments"
    ? { data: { documents: IC_DOCS }, loading: false, error: null, reload: vi.fn() }
    : { data: { reviewers: [
      { id: "r1", name: "R1", weight: 2 }, { id: "r2", name: "R2", weight: 1 },
    ] }, loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({ adminPlatformApi: { decide: vi.fn() } }));
vi.mock("../../../../lib/leadershipApi", () => ({ leadershipApi: {} }));

import { loadDetail } from "../../../../hooks/useAdminData";
import { AdminDetail, weightedReviewerScore } from "../screens/AdminDetail";

const APP = { id: "a1", track: "tir", applicationId: "TIR-1", name: "Stage App", founders: [], domain: "X",
  stage: "Lab", sub: "2026-06-01", ai: {}, reviews: [], flags: [], statusHistory: [], assignedReviewers: [] };
const mount = (extra) => {
  loadDetail.mockResolvedValue({ ...APP, ...extra });
  return render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
};

describe("ADM-09 weightedReviewerScore", () => {
  // review overall = (22p + 30s + 22t + 14f + 12c) / 100, then mean weighted by reviewer weight.
  const full = (v, reviewerId) => ({ reviewerId, problem: v, solution: v, tech: v, founders: v, commit: v, overall: 1 });
  it("weights each review's category-weighted overall by reviewer weight", () => {
    expect(weightedReviewerScore([full(8, "r1"), full(5, "r2")], { r1: 2, r2: 1 })).toBe(7);
  });
  it("prefers the backend reviewer_score when present", () => {
    expect(weightedReviewerScore([full(8, "r1")], {}, 6.4)).toBe(6.4);
  });
  it("is null when no review has all five scores", () => {
    expect(weightedReviewerScore([{ reviewerId: "r1", problem: 8 }], {})).toBeNull();
  });
  it("detail labels the score as weighted by reviewer", async () => {
    mount({ chip: "EVALUATED", reviews: [
      { reviewerId: "r1", problem: 8, solution: 8, tech: 8, founders: 8, commit: 8, overall: 8 },
      { reviewerId: "r2", problem: 5, solution: 5, tech: 5, founders: 5, commit: 5, overall: 5 },
    ] });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(screen.getByText(/weighted by reviewer/i)).toBeTruthy();
    expect(screen.getAllByText("7.0").length).toBeGreaterThan(0);
  });
});

describe("ADM-20 stage-aware header + decide panel", () => {
  it("evaluated app: gate-1 decide panel, no '· admin review' hard-code", async () => {
    mount({ chip: "EVALUATED" });
    const h = await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(h.textContent).not.toMatch(/admin review/);
    expect(h.textContent).toMatch(/Evaluated/i);
    expect(screen.getByRole("button", { name: "Apply decision" })).toBeTruthy();
  });
  it("rejected app: status chip shown, no gate-1 panel, read-only summary", async () => {
    mount({ chip: "REJECTED", adminDecision: "REJECTED", adminRationale: "Not a fit" });
    const h = await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(h.textContent).toMatch(/Rejected/i);
    expect(screen.queryByRole("button", { name: "Apply decision" })).toBeNull();
    expect(screen.getByTestId("decision-summary").textContent).toMatch(/Not a fit/);
  });
  it("accepted / onboarded apps get no gate-1 panel", async () => {
    mount({ chip: "JURY REVIEW", adminDecision: "APPROVED" });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(screen.queryByRole("button", { name: "Apply decision" })).toBeNull();
  });
});

describe("ADM-20 final-round chip follows IC sign-off (lib/selection)", () => {
  const doc = (signed) => ({ application_id: "a1", track: "tir", signed, superseded_at: null });
  it("jury_review with an unsigned memo reads Final pending, not Accepted", async () => {
    IC_DOCS = [doc(true), doc(false)];
    mount({ chip: "JURY REVIEW", adminDecision: "APPROVED" });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    const chip = screen.getByTestId("detail-status-chip");
    expect(chip.textContent).toMatch(/Final pending/i);
    expect(chip.textContent).not.toMatch(/Accepted/i);
    expect(screen.getByTestId("decision-summary").textContent).not.toMatch(/^Accepted/);
  });
  it("jury_review with no memo is Final pending too", async () => {
    IC_DOCS = [];
    mount({ chip: "JURY REVIEW", adminDecision: "APPROVED" });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(screen.getByTestId("detail-status-chip").textContent).toMatch(/Final pending/i);
  });
  it("jury_review with every current memo signed reads Accepted", async () => {
    IC_DOCS = [doc(true), doc(true)];
    mount({ chip: "JURY REVIEW", adminDecision: "APPROVED" });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    expect(screen.getByTestId("detail-status-chip").textContent).toMatch(/Accepted/i);
  });
});
