import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The dashboard reads the signed-in user via useAuth on mount; provide a stub.
vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "lead@x.io", roles: ["leadership"] }, logout: () => {} }),
}));

// Mock the API so the dashboard renders a known page of rows.
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getStats: vi.fn(() => Promise.resolve({ totals: {}, funnel: {}, status_counts: [], ai_score_overalls: [] })),
    getIndustryCategories: vi.fn(() => Promise.resolve({ categories: [] })),
    listApplications: vi.fn(() => Promise.resolve({
      applications: [
        { id: "A", track: "tir", display_id: "TIR-26001", status: "under_review",
          project_name: "Acme", founder: { name: "Asha", affiliation: "X" },
          industry: { label: "Robotics" }, stage: { label: "Lab" },
          ai_score_overall: 7, reviewer_score: 8,
          reviewers: { submitted: 2, assigned: 3 }, reco: { yes: 2, maybe: 0, no: 1 },
          submitted_at: "2026-07-01T00:00:00Z" },
      ],
      total: 1, limit: 50, offset: 0,
    })),
  },
}));

import LeadershipDashboard from "../LeadershipDashboard.jsx";

describe("Leadership Reviewers + Reco columns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Reviewers (submitted/assigned) and a Reco tally", async () => {
    render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
    // Default view is "dashboard"; the applications table renders only under the
    // Applications tab (view === "applications"). Click it to reveal the table.
    fireEvent.click(screen.getByRole("button", { name: /Applications/i }));
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeTruthy());
    expect(screen.getByText("2Y")).toBeTruthy();
    expect(screen.getByText("1N")).toBeTruthy();
  });
});
