import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AIScreeningPanel from "../AIScreeningPanel.jsx";

const aiScreening = {
  score_overall: 3.9,
  score_problem: 4.0, score_completeness: 3.5, score_tech: 4.2,
  score_founders: 3.6, score_commitment: 4.1,
  summary: JSON.stringify({ verdict: "v", recommendation: "r", top_strength: "s" }),
  flags: {},
};

describe("AIScreeningPanel score tab", () => {
  it("renders the compact composite score and a strength band", () => {
    render(<AIScreeningPanel aiScreening={aiScreening} assignments={[]} />);
    expect(
      screen.getByLabelText(/Composite AI score 3\.9 out of 10/i),
    ).toBeInTheDocument();
    // band label derived from the score tier (3.9 → "Low")
    expect(screen.getByText(/Low/i)).toBeInTheDocument();
  });
});

describe("AIScreeningPanel reviewers tab", () => {
  it("does not render an Unassign button", () => {
    const assignments = [
      { id: "a1", reviewer_user_id: "u1", reviewer_name: "Udita Uniyal", reviewer_status: "evaluated" },
    ];
    render(<AIScreeningPanel aiScreening={null} assignments={assignments} />);
    const tabBtn = screen.getByRole("button", { name: /^Reviewers$/i });
    fireEvent.click(tabBtn);
    expect(screen.queryByRole("button", { name: /Unassign/i })).not.toBeInTheDocument();
  });
});
