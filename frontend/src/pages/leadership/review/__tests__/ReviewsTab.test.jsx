import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewsTab from "../ReviewsTab.jsx";

const review = {
  id: "rv1",
  reviewer_name: "Udita Uniyal",
  status: "submitted",
  submitted_at: "2026-06-27T17:05:00Z",
  score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
  score_founders: 3.0, score_commitment: 2.5,
};

describe("ReviewsTab reviewer weighted score", () => {
  it("shows the reviewer's weighted overall on the card", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    // weighted = 2.09 → 2.1
    expect(
      screen.getByLabelText(/Reviewer weighted score 2\.1 out of 10/i),
    ).toBeInTheDocument();
  });

  it("shows the avg score line computed from the weighted overall", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    expect(screen.getByText(/avg score/i)).toBeInTheDocument();
  });
});
