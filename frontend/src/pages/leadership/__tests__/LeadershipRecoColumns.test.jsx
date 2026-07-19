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

  it("renders Reviewers (submitted/assigned) and ONE aggregate Reco chip", async () => {
    render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Applications/i }));
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeTruthy());
    expect(screen.getByText("YES")).toBeTruthy();       // 2Y1N -> majority yes
    expect(screen.queryByText("2Y")).not.toBeInTheDocument();
  });

  it("clicking the reco cell requests that verdict from the API", async () => {
    const { leadershipApi } = await import("../../../lib/leadershipApi.js");
    render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Applications/i }));
    await waitFor(() => expect(screen.getByText("YES")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Filter by reco: yes/i }));
    await waitFor(() => {
      const calls = leadershipApi.listApplications.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ recommendation: "yes", offset: 0 });
    });
  });

  it("offers a — bucket in the Recommendation filter chips", async () => {
    render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Applications/i }));
    await waitFor(() => expect(screen.getByText("YES")).toBeTruthy());
    // The Recommendation chip row lives inside the collapsible Filters panel.
    fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.getAllByRole("button", { name: "—" }).length).toBeGreaterThan(0);
  });
});
