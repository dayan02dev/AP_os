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
import { AdminDetail, weightedReviewerScore, weightedCategoryMean } from "../screens/AdminDetail";

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

describe("detail category means use the same reviewer weights as the overall", () => {
  const rv = (reviewerId, v, extra = {}) => ({ reviewerId, problem: v, solution: v, tech: v,
    founders: v, commit: v, overall: v, submittedAt: "2026-07-01", ...extra });
  it("weights each category by reviewer weight and skips drafts", () => {
    const reviews = [rv("r1", 9), rv("r2", 5), rv("r3", 5), rv("r4", 1, { submittedAt: null })];
    // (3*9 + 1*5 + 1*5) / 5 = 7.4 — drafts (submittedAt null) never count.
    expect(weightedCategoryMean(reviews, "problem", { r1: 3, r2: 1, r3: 1 })).toBeCloseTo(7.4, 5);
  });
  it("is null when nothing scored that category", () => {
    expect(weightedCategoryMean([{ reviewerId: "r1" }], "tech", {})).toBeNull();
  });
  it("detail categories never fall below a weighted overall built from them", async () => {
    mount({ chip: "EVALUATED", reviewerScore: 7.4, reviewerWeights: { x1: 3, x2: 1, x3: 1 },
      reviews: [rv("x1", 9), rv("x2", 5), rv("x3", 5)] });
    await screen.findByRole("heading", { level: 2, name: /Stage App/ });
    // every category reads the weighted 7.4, same as the overall
    expect(screen.getAllByText("7.4").length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText("6.3")).toBeNull(); // the old unweighted mean
  });
});
