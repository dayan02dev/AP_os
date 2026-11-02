// Rubric v3.2 (contract C3) in the reviewer scoring form: no commitment
// slider, no score_commitment in what we send, AI panel keeps Commitment.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getContent: vi.fn(),
  getQueue: vi.fn(() => Promise.resolve([])),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  getPanelFeedback: vi.fn(() => Promise.resolve({ available: false, reason: "submit_first", reviews: [], admin_decisions: [] })),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));

import ReviewerEval from "../ReviewerEval.jsx";

const content = (over = {}) => ({
  id: "app1", applicationId: "TIR-1", track: "tir", moved_to_track: null,
  name: "Acme", aiSummary: null, aiSections: [], fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  ai: { overall: 7, problem: 7, solution: 7, tech: 7, founders: 7, commit: 6 },
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});

describe("ReviewerEval rubric v3.2", () => {
  it("renders four sliders and no commitment slider", async () => {
    api.getContent.mockResolvedValue(content());
    const { container } = render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    expect(container.querySelectorAll(".os-slider-row")).toHaveLength(4);
    expect(container.querySelector(".os-slider-row.commit")).toBeNull();
    expect(screen.queryByText(/Commitment to be fully available/)).not.toBeInTheDocument();
  });

  it("keeps the AI Commitment bar in the AI baseline panel", async () => {
    api.getContent.mockResolvedValue(content());
    const { container } = render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Show AI Scores/ }));
    expect(container.querySelector(".os-scorebar.commit")).not.toBeNull();
    expect(screen.getByText("Commitment")).toBeInTheDocument();
  });

  it("submitting a brand-new review never sends score_commitment", async () => {
    api.getContent.mockResolvedValue(content());
    api.submitReview.mockResolvedValue({ review: { id: "r1" } });
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "notes" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    await waitFor(() => expect(api.submitReview).toHaveBeenCalled());
    const sent = api.submitReview.mock.calls.at(-1)[0];
    expect(sent).not.toHaveProperty("score_commitment");
    expect(sent.score_problem).toBe(5);
  });
});
