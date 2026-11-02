import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ReviewsTab from "../ReviewsTab.jsx";

const review = {
  id: "rv1",
  reviewer_name: "Udita Uniyal",
  status: "submitted",
  submitted_at: "2026-06-27T17:05:00Z",
  score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
  score_founders: 3.0, score_commitment: 2.5,
};

// What reviewer v2 persists: quick_notes, recommendation, flags,
// disagree_with_ai. strengths/concerns/comments only on legacy rows.
const V2_REVIEW = {
  id: "rv-1", reviewer_user_id: "u-rev1", reviewer_name: "Asha Rao", status: "draft",
  submitted_at: "2026-10-20T10:00:00Z",
  score_problem: 8, score_solution: 7, score_tech: 6, score_founders: 7, score_commitment: 9,
  recommendation: "yes",
  quick_notes: "QUICKNOTE-TEXT strong team, weak GTM",
  flags: ["FLAG-IP-UNCLEAR"],
  disagree_with_ai: { tech: "DISAGREE-REASON AI over-scored tech" },
  strengths: null, concerns: null, comments: null,
};
const LEGACY_REVIEW = {
  ...V2_REVIEW, id: "rv-2", reviewer_user_id: "u-rev2", reviewer_name: "Legacy Lee",
  quick_notes: null, flags: [], disagree_with_ai: null, recommendation: null,
  strengths: "STRENGTHS-TEXT", concerns: "CONCERNS-TEXT", comments: "COMMENTS-TEXT",
};
const DRAFT_REVIEW = {
  ...V2_REVIEW, id: "rv-3", reviewer_user_id: "u-rev3", reviewer_name: "Drafty Dan",
  submitted_at: null, quick_notes: "DRAFT-NOTE in progress",
};

describe("ReviewsTab reviewer weighted score", () => {
  it("shows the reviewer's weighted overall on the card (4 criteria, commitment ignored)", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    // (22*2 + 30*2 + 22*1.5 + 14*3) / 88 = 2.034 → 2.0
    expect(
      screen.getByLabelText(/Reviewer weighted score 2\.0 out of 10/i),
    ).toBeInTheDocument();
  });

  it("shows the avg score line computed from the weighted overall", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    expect(screen.getByText(/avg score/i)).toBeInTheDocument();
  });

  it("has no 'Commitment to be fully available' bar (rubric v3.2)", () => {
    render(<ReviewsTab reviews={[V2_REVIEW]} assignments={[]} />);
    expect(screen.queryByText(/Commitment to be fully available/)).toBeNull();
    expect(screen.getByText("Professional Profile of Founder")).toBeInTheDocument();
  });
});

describe("ReviewsTab reviewer feedback", () => {
  it("renders a v2 reviewer's recommendation, notes, flags and AI disagreements", () => {
    render(<ReviewsTab reviews={[V2_REVIEW]} assignments={[{ reviewer_user_id: "u-rev1" }]} />);
    const card = screen.getByText(/Asha Rao/).closest("article");
    expect(within(card).getByText(/QUICKNOTE-TEXT/)).toBeInTheDocument();
    expect(within(card).getByText("FLAG-IP-UNCLEAR")).toBeInTheDocument();
    expect(within(card).getByText(/DISAGREE-REASON/)).toBeInTheDocument();
    expect(within(card).getByText("Yes")).toBeInTheDocument();
  });

  it("renders legacy strengths / concerns / comments", () => {
    render(<ReviewsTab reviews={[LEGACY_REVIEW]} assignments={[]} />);
    expect(screen.getByText("STRENGTHS-TEXT")).toBeInTheDocument();
    expect(screen.getByText("CONCERNS-TEXT")).toBeInTheDocument();
    expect(screen.getByText("COMMENTS-TEXT")).toBeInTheDocument();
  });

  it("never shows draft reviews or their notes", () => {
    render(<ReviewsTab reviews={[DRAFT_REVIEW]} assignments={[]} />);
    expect(screen.getByText(/No reviews submitted yet/)).toBeInTheDocument();
    expect(screen.queryByText(/DRAFT-NOTE/)).toBeNull();
  });
});

describe("ReviewsTab admin decisions", () => {
  const decisions = [
    { id: "d2", gate_stage: "gate2", decision: "rejected", rationale: "ADMIN-RATIONALE weak moat",
      decided_by: "a1", decided_by_name: "Admin Ann", decided_at: "2026-10-25T10:00:00Z" },
    { id: "d1", gate_stage: "gate1", decision: "jury_review", rationale: "gate1: jury_review",
      decided_by: "a1", decided_by_name: "Admin Ann", decided_at: "2026-10-22T10:00:00Z" },
  ];

  it("lists the admin decisions with their rationale", () => {
    render(<ReviewsTab reviews={[V2_REVIEW]} assignments={[]} adminDecisions={decisions} />);
    const section = screen.getByTestId("admin-decisions");
    expect(within(section).getByText("ADMIN-RATIONALE weak moat")).toBeInTheDocument();
    expect(within(section).getAllByText(/by Admin Ann/)).toHaveLength(2);
    // Auto-written rationale is not shown as feedback.
    expect(within(section).queryByText("gate1: jury_review")).toBeNull();
  });

  it("shows admin decisions even when no review is submitted yet", () => {
    render(<ReviewsTab reviews={[]} assignments={[]} adminDecisions={decisions} />);
    expect(screen.getByText("ADMIN-RATIONALE weak moat")).toBeInTheDocument();
  });

  it("renders no admin section when there are none", () => {
    render(<ReviewsTab reviews={[V2_REVIEW]} assignments={[]} />);
    expect(screen.queryByTestId("admin-decisions")).toBeNull();
  });
});
