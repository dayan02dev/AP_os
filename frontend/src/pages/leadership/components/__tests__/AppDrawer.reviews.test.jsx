// Leadership AppDrawer → Reviews collapsible: submitted reviews only, each
// with the reviewer's written feedback (LEAD-02).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../lib/leadershipApi.js", () => ({
  leadershipApi: { getApplication: vi.fn(), fileSignedUrl: vi.fn() },
}));
vi.mock("../../../../lib/icDocumentsApi.js", () => ({
  icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) },
}));

import AppDrawer from "../AppDrawer.jsx";
import { leadershipApi } from "../../../../lib/leadershipApi.js";

const V2_REVIEW = {
  id: "rv-1", reviewer_user_id: "u-rev1", reviewer_name: "Asha Rao",
  submitted_at: "2026-10-20T10:00:00Z",
  score_problem: 8, score_solution: 7, score_tech: 6, score_founders: 7, score_commitment: 9,
  recommendation: "yes", quick_notes: "QUICKNOTE-TEXT strong team",
  flags: ["FLAG-IP-UNCLEAR"], disagree_with_ai: { tech: "DISAGREE-REASON" },
  strengths: null, concerns: null, comments: null,
};
const LEGACY_REVIEW = {
  ...V2_REVIEW, id: "rv-2", reviewer_user_id: "u-rev2", reviewer_name: "Legacy Lee",
  quick_notes: null, flags: [], disagree_with_ai: null,
  strengths: "STRENGTHS-TEXT", concerns: "CONCERNS-TEXT",
};
const DRAFT_REVIEW = {
  ...V2_REVIEW, id: "rv-3", reviewer_user_id: "u-rev3", reviewer_name: "Drafty Dan",
  submitted_at: null, quick_notes: "DRAFT-NOTE",
};

beforeEach(() => vi.clearAllMocks());

describe("AppDrawer Reviews", () => {
  it("lists submitted reviews only, each with its written feedback", async () => {
    leadershipApi.getApplication.mockResolvedValue({
      id: "A1", track: "tir", native_track: "tir", display_id: "TIR-1",
      application: {}, ai_screening: null,
      reviews: [V2_REVIEW, LEGACY_REVIEW, DRAFT_REVIEW], reviewer_assignments: [], status_history: [],
    });
    render(<MemoryRouter><AppDrawer row={{ id: "A1", track: "tir", status: "evaluated" }} onClose={() => {}} /></MemoryRouter>);
    const head = await screen.findByRole("button", { name: /^\W*Reviews\s*\d/ });
    expect(within(head).getByText("2")).toBeTruthy();
    fireEvent.click(head);
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(screen.queryByText("Drafty Dan")).toBeNull();
    expect(screen.queryByText(/DRAFT-NOTE/)).toBeNull();
    expect(screen.getByText("QUICKNOTE-TEXT strong team")).toBeTruthy();
    expect(screen.getByText("FLAG-IP-UNCLEAR")).toBeTruthy();
    expect(screen.getByText(/DISAGREE-REASON/)).toBeTruthy();
    expect(screen.getByText("STRENGTHS-TEXT")).toBeTruthy();
    expect(screen.getByText("CONCERNS-TEXT")).toBeTruthy();
    // 4-criterion weighted score: (22*8 + 30*7 + 22*6 + 14*7) / 88 = 6.95 → 7.0
    expect(screen.getAllByText("7.0").length).toBeGreaterThan(0);
  });
});
