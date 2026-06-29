import { describe, it, expect } from "vitest";
import { weightedReviewScore } from "../reviewScore";

describe("weightedReviewScore", () => {
  it("computes the weighted overall using canonical weights", () => {
    // 2.0*22 + 2.0*30 + 1.5*22 + 3.0*14 + 2.5*12 = 209; /100 = 2.09
    const r = {
      score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
      score_founders: 3.0, score_commitment: 2.5,
    };
    expect(weightedReviewScore(r)).toBeCloseTo(2.09, 2);
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
