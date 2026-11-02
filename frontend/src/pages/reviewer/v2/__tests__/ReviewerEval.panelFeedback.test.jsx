// Contract C2: after a reviewer submits, the eval screen shows the other
// reviewers' feedback and the admins' comments (GET .../panel-feedback).
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getContent: vi.fn(),
  getQueue: vi.fn(() => Promise.resolve([])),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  getPanelFeedback: vi.fn(),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));

import ReviewerEval from "../ReviewerEval.jsx";

const SUBMITTED = {
  id: "mine", submitted_at: "2026-10-01T00:00:00Z", recommendation: "yes",
  score_problem: 7, score_solution: 7, score_tech: 7, score_founders: 7, quick_notes: "mine",
};
const content = (over = {}) => ({
  id: "app1", applicationId: "TIR-1", track: "tir", moved_to_track: null,
  name: "Acme", aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});
const PANEL = {
  available: true,
  reviews: [{
    id: "rv-other", reviewer_name: "Asha Rao", recommendation: "maybe",
    quick_notes: "OTHER-REVIEWER-NOTES", strengths: null, concerns: null, comments: null,
    flags: ["ip risk"], disagree_with_ai: {}, submitted_at: "2026-10-02T10:00:00Z",
    score_problem: 8, score_solution: 7, score_tech: 7, score_founders: 6, overall: 7.18,
  }],
  admin_decisions: [{
    id: "d1", gate_stage: "gate1", decision: "approved", rationale: "Strong team, take forward",
    decided_by: "u1", decided_by_name: "Admin One", decided_at: "2026-10-03T10:00:00Z",
  }],
};

beforeEach(() => {
  api.getContent.mockReset();
  api.getPanelFeedback.mockReset().mockResolvedValue(PANEL);
  api.submitReview.mockReset().mockResolvedValue({ review: { id: "r1" } });
});

describe("Panel feedback", () => {
  it("before submitting: nothing is fetched, only a muted note", async () => {
    api.getContent.mockResolvedValue(content());
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/Visible after you submit your review/)).toBeInTheDocument();
    expect(api.getPanelFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText("OTHER-REVIEWER-NOTES")).not.toBeInTheDocument();
  });

  it("on a submitted review: shows other reviewers' feedback and admin comments", async () => {
    api.getContent.mockResolvedValue(content({ evaluation: SUBMITTED }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText("OTHER-REVIEWER-NOTES")).toBeInTheDocument();
    expect(api.getPanelFeedback).toHaveBeenCalledWith("tir", "app1");
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("7.2")).toBeInTheDocument();
    expect(screen.getByText("Strong team, take forward")).toBeInTheDocument();
    expect(screen.getByText(/by Admin One/)).toBeInTheDocument();
  });

  it("appears right after the reviewer submits in this session", async () => {
    api.getContent.mockResolvedValue(content());
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "n" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    expect(await screen.findByText("OTHER-REVIEWER-NOTES")).toBeInTheDocument();
  });

  it("is shown on a locked (read-only) submitted review too", async () => {
    api.getContent.mockResolvedValue(content({
      evaluation: SUBMITTED, read_only: true, read_only_reason: "decided", app_status: "rejected",
    }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText("OTHER-REVIEWER-NOTES")).toBeInTheDocument();
  });

  it("says so when there is no other feedback yet", async () => {
    api.getPanelFeedback.mockResolvedValue({ available: true, reviews: [], admin_decisions: [] });
    api.getContent.mockResolvedValue(content({ evaluation: SUBMITTED }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/No feedback from other reviewers or admins yet/)).toBeInTheDocument();
  });

  it("stays quiet on a 404 or error", async () => {
    api.getPanelFeedback.mockRejectedValue(Object.assign(new Error("nf"), { status: 404, code: "not_found" }));
    api.getContent.mockResolvedValue(content({ evaluation: SUBMITTED }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    await waitFor(() => expect(api.getPanelFeedback).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Panel feedback/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn/)).not.toBeInTheDocument();
  });
});
