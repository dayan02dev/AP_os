// Admin Reviews section (FD-5 / RC-5): every submitted reviewer's written
// feedback (via the shared ReviewerFeedback on the RAW review row), reviewer
// name, 4-criterion weighted score and submitted date; no reviewer
// "Commitment" criterion (rubric v3.2); a missing recommendation reads '—'.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ComparativeReviewModel } from "../screens/ComparativeReviewModel.jsx";
import { adaptDetail } from "../../../../lib/adminDataAdapter.js";

// What reviewer v2 persists: quick_notes, recommendation, flags,
// disagree_with_ai; strengths/concerns/comments are null for v2 rows.
const V2_REVIEW = {
  id: "rv-1", application_id: "A1", application_track: "tir", reviewer_user_id: "u-rev1",
  reviewer_name: "Asha Rao", submitted_at: "2026-10-20T10:00:00Z",
  score_problem: 8, score_solution: 7, score_tech: 6, score_founders: 7, score_commitment: 9,
  recommendation: "yes",
  quick_notes: "QUICKNOTE-TEXT strong team, weak GTM",
  flags: ["FLAG-IP-UNCLEAR"],
  disagree_with_ai: { tech: "DISAGREE-REASON AI over-scored tech" },
  strengths: null, concerns: null, comments: null,
};
const LEGACY_REVIEW = { ...V2_REVIEW, id: "rv-2", reviewer_user_id: "u-rev2", reviewer_name: "Legacy Lee",
  quick_notes: null, recommendation: null, flags: [], disagree_with_ai: null,
  strengths: "STRENGTHS-TEXT", concerns: "CONCERNS-TEXT", comments: "COMMENTS-TEXT" };
const DRAFT_REVIEW = { ...V2_REVIEW, id: "rv-3", reviewer_user_id: "u-rev3", reviewer_name: "Drafty Dan",
  submitted_at: null, recommendation: "no", quick_notes: "DRAFT-NOTE in progress" };

const detail = {
  id: "A1", track: "tir", native_track: "tir", application: {}, ai_screening: null,
  reviews: [V2_REVIEW, LEGACY_REVIEW, DRAFT_REVIEW], reviewer_assignments: [], status_history: [],
};

const cardFor = (name) => screen.getByText(name).closest(".rv-card");

describe("Admin ComparativeReviewModel (via adaptDetail)", () => {
  it("drops drafts; shows each submitted reviewer's notes, flags, disagreements and recommendation", () => {
    render(<ComparativeReviewModel startup={adaptDetail(detail)} />);
    expect(screen.queryByText("Drafty Dan")).toBeNull();
    expect(screen.queryByText(/DRAFT-NOTE/)).toBeNull();
    const asha = cardFor("Asha Rao");
    expect(within(asha).getByText(/QUICKNOTE-TEXT/)).toBeTruthy();
    expect(within(asha).getByText(/FLAG-IP-UNCLEAR/)).toBeTruthy();
    expect(within(asha).getByText(/DISAGREE-REASON/)).toBeTruthy();
    expect(within(asha).getAllByText(/^yes$/i).length).toBeGreaterThan(0);
  });

  it("shows legacy strengths / concerns / comments", () => {
    render(<ComparativeReviewModel startup={adaptDetail(detail)} />);
    const lee = cardFor("Legacy Lee");
    expect(within(lee).getByText(/STRENGTHS-TEXT/)).toBeTruthy();
    expect(within(lee).getByText(/CONCERNS-TEXT/)).toBeTruthy();
    expect(within(lee).getByText(/COMMENTS-TEXT/)).toBeTruthy();
  });

  it("a missing recommendation reads '—', never MAYBE", () => {
    render(<ComparativeReviewModel startup={adaptDetail(detail)} />);
    const lee = cardFor("Legacy Lee");
    expect(within(lee).queryByText(/maybe/i)).toBeNull();
    expect(within(lee).getByTestId("rv-reco").textContent).toBe("—");
  });

  it("shows the 4-criterion weighted overall and the submitted date", () => {
    render(<ComparativeReviewModel startup={adaptDetail(detail)} />);
    const asha = cardFor("Asha Rao");
    // (8*22 + 7*30 + 6*22 + 7*14) / 88 = 6.977… → 7.0 (commitment 9 ignored)
    expect(within(asha).getByTestId("rv-overall").textContent).toBe("7.0");
    expect(within(asha).getByTestId("rv-submitted").textContent).toMatch(/20 Oct 2026/);
  });

  it("has no reviewer Commitment criterion row", () => {
    render(<ComparativeReviewModel startup={adaptDetail(detail)} />);
    expect(screen.queryByText("Commitment")).toBeNull();
    expect(screen.getAllByText("Founder profile").length).toBe(2);
  });

  it("still renders reviews that carry no raw row (adapted-only shape)", () => {
    const s = { reviews: [{ reviewerName: "Plain", reco: "no", notes: "PLAIN-NOTE", flags: ["F1"], overall: 6 }] };
    render(<ComparativeReviewModel startup={s} />);
    const card = cardFor("Plain");
    expect(within(card).getByText("PLAIN-NOTE")).toBeTruthy();
    expect(within(card).getByText("F1")).toBeTruthy();
  });
});
