import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewerScoringPanel from "../scoring/ReviewerScoringPanel.jsx";

const baseProps = {
  state: "scoring",
  myReview: null,
  aiScreening: null,
  onSubmit: vi.fn(),
  onSaveDraft: vi.fn(),
  onEdit: vi.fn(),
};

describe("ReviewerScoringPanel — State A (scoring)", () => {
  it("Submit button disabled until 5 scores + recommendation set", async () => {
    const onSubmit = vi.fn();
    render(<ReviewerScoringPanel {...baseProps} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const submit = screen.getByRole("button", { name: /Submit review/i });
    expect(submit).toBeDisabled();

    // Fill 4 categories — still disabled
    for (const cat of ["Problem importance & clarity", "Solution depth & completeness",
                       "Technical strength", "Founder traits"]) {
      await user.click(screen.getByRole("radio", { name: new RegExp(`Score 7 out of 10 for ${cat}`) }));
    }
    expect(submit).toBeDisabled();

    // Add commitment + recommendation
    await user.click(screen.getByRole("radio", { name: /Score 6 out of 10 for Commitment level/ }));
    await user.click(screen.getByRole("radio", { name: /Recommendation Maybe/ }));
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      score_problem: 7, score_solution: 7, score_tech: 7,
      score_founders: 7, score_commitment: 6, recommendation: "maybe",
    }));
  });

  it("Save draft fires onSaveDraft with whatever has been entered", async () => {
    const onSaveDraft = vi.fn();
    render(<ReviewerScoringPanel {...baseProps} onSaveDraft={onSaveDraft} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /Score 4 out of 10 for Problem importance/ }));
    await user.click(screen.getByRole("button", { name: /Save draft/i }));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ score_problem: 4 }));
  });
});

describe("ReviewerScoringPanel — State B (editable)", () => {
  it("shows submitted eyebrow + comparison view + Edit button", () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    render(
      <ReviewerScoringPanel
        state="editable"
        myReview={{
          id: "r1", score_problem: 7, score_solution: 6, score_tech: 6,
          score_founders: 8, score_commitment: 7, recommendation: "maybe",
          submitted_at: "2026-05-18T15:00:00Z", locked_at: future,
        }}
        aiScreening={{
          score_problem: 8, score_solution: 7, score_tech: 7,
          score_founders: 7, score_commitment: 8, summary: "Strong.",
        }}
        onEdit={() => {}}
        onExpire={() => {}}
      />,
    );
    expect(screen.getByText(/Review submitted · ✓/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit my review/i })).toBeInTheDocument();
    expect(screen.getByText(/Your scores vs AI/i)).toBeInTheDocument();
  });
});

describe("ReviewerScoringPanel — State C (locked)", () => {
  it("shows LOCKED eyebrow and no edit button", () => {
    render(
      <ReviewerScoringPanel
        state="locked"
        myReview={{
          id: "r1", score_problem: 7, score_solution: 6, score_tech: 6,
          score_founders: 8, score_commitment: 7, recommendation: "no",
          submitted_at: "2026-05-15T10:00:00Z", locked_at: "2026-05-15T11:00:00Z",
        }}
        aiScreening={{ score_problem: 8, summary: "Strong." }}
      />,
    );
    expect(screen.getByText(/LOCKED/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit my review/i })).not.toBeInTheDocument();
  });
});
