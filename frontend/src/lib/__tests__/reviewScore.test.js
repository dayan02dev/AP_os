import { describe, it, expect } from "vitest";
import { weightedReviewScore } from "../reviewScore";

describe("weightedReviewScore", () => {
  it("computes the 4-criterion weighted overall (22/30/22/14 over 88)", () => {
    // 2.0*22 + 2.0*30 + 1.5*22 + 3.0*14 = 179; /88 = 2.034
    const r = {
      score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
      score_founders: 3.0,
    };
    expect(weightedReviewScore(r)).toBe(2.03); // 2 dp, like the backend (RM-1)
  });

  it("ignores a historical score_commitment (criterion removed from the rubric)", () => {
    const base = { score_problem: 8, score_solution: 6, score_tech: 7, score_founders: 9 };
    expect(weightedReviewScore({ ...base, score_commitment: 1 }))
      .toBeCloseTo(weightedReviewScore(base), 6);
  });

  it("returns null when no dimension scores are present", () => {
    expect(weightedReviewScore({})).toBeNull();
    expect(weightedReviewScore(null)).toBeNull();
    expect(weightedReviewScore(undefined)).toBeNull();
  });

  it("renormalises over only the present dimensions", () => {
    expect(weightedReviewScore({ score_problem: 7 })).toBeCloseTo(7, 5);
  });

  it("ignores non-numeric values", () => {
    const r = { score_problem: 8, score_solution: null, score_tech: "x" };
    expect(weightedReviewScore(r)).toBeCloseTo(8, 5);
  });
});
