// Swarm2 / leadership_review — ReviewsTab numbers vs the backend list numbers.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewsTab from "../ReviewsTab.jsx";

const rv = (id, v, extra = {}) => ({
  id, reviewer_user_id: id, reviewer_name: id, submitted_at: "2026-10-01T00:00:00Z",
  score_problem: v, score_solution: v, score_tech: v, score_founders: v, recommendation: "yes",
  ...extra,
});

describe("ReviewsTab avg score uses the backend rounding (admin_query.reviewer_score)", () => {
  it("two reviews 6.0 + 6.5 -> mean 6.25 -> Python round(6.25,1) = 6.2 (list column shows 6.2)", () => {
    render(<ReviewsTab reviews={[rv("a", 6), rv("b", 6.5)]} assignments={[]} adminDecisions={[]} />);
    const summary = document.querySelector(".reviews-summary").textContent;
    // Backend list 'Reviewer score' = round((6.0 + 6.5) / 2, 1) = 6.2.
    expect(summary).toContain("avg score 6.2");
  });

  it("single review whose weighted overall is exactly 6.25 shows 6.2 like the list", () => {
    // (22*0 + 30*7.5 + 22*10 + 14*7.5)/88 = 6.25 exactly.
    const r = { ...rv("a", 0), score_solution: 7.5, score_tech: 10, score_founders: 7.5 };
    render(<ReviewsTab reviews={[r]} assignments={[]} adminDecisions={[]} />);
    const card = document.querySelector(".review-card-score").textContent;
    expect(card.startsWith("6.2")).toBe(true);
  });
});

describe("ReviewsTab 'reviewers assigned' matches the list's assigned count", () => {
  it("does not count a declined assignment as assigned", () => {
    const assignments = [
      { id: "as1", reviewer_user_id: "a", reviewer_status: "evaluated", assigned_at: "2026-09-01T00:00:00Z" },
      { id: "as2", reviewer_user_id: "b", reviewer_status: "pending", assigned_at: "2026-09-01T00:00:00Z" },
      { id: "as3", reviewer_user_id: "c", reviewer_status: "declined", declined_at: "2026-09-02T00:00:00Z", assigned_at: "2026-09-01T00:00:00Z" },
    ];
    render(<ReviewsTab reviews={[rv("a", 7)]} assignments={assignments} adminDecisions={[]} />);
    const summary = document.querySelector(".reviews-summary").textContent;
    // admin_query._fetch_review_stats: assigned = active (not declined) ∪ submitted = {a, b} = 2.
    expect(summary).toMatch(/^2 reviewers assigned/);
  });
});

import VideoAnswer from "../answers/VideoAnswer.jsx";
describe("VideoAnswer scheme (LEAD-26)", () => {
  it("does not render a javascript: URL as a link", () => {
    render(<VideoAnswer value="javascript:alert(1)" />);
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
describe("ReviewsTab partial reviews (LEAD-21)", () => {
  it("avg skips reviews missing a dimension, like the backend", () => {
    render(<ReviewsTab reviews={[rv("a", 8), rv("b", 2, { score_tech: null })]} assignments={[]} adminDecisions={[]} />);
    expect(document.querySelector(".reviews-summary").textContent).toContain("avg score 8.0");
  });
});
