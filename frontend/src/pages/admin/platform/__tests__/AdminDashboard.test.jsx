// AdminDashboard smoke test — mounts the new screens/AdminDashboard with a
// mocked useAdminData hook and verifies KPI values render from real stats data.

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock useAdminData before importing the component under test.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { AdminDashboard } from "../screens/AdminDashboard";

const SAMPLE_STATS = {
  totals: {
    apps_submitted: 42,
    advanced_past_review: 10,
    onboarded: 3,
    avg_ai_score: 8.1,
  },
  funnel: {
    submitted: 42,
    in_review: 30,
    advanced: 10,
    decided: 5,
  },
  statusCounts: [
    { id: "submitted",    label: "Submitted",    n: 12 },
    { id: "under-review", label: "Under review", n: 30 },
  ],
  aiScores: [7, 8, 9],
  decisions: {
    shortlisted: 4,
    on_hold: 1,
    rejected: 2,
    waitlisted: 0,
  },
};

describe("AdminDashboard screen (screens/)", () => {
  it("renders the APPLICATIONS SUBMITTED KPI from totals.apps_submitted", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    // The tile label should appear
    expect(screen.getByText(/APPLICATIONS SUBMITTED/i)).toBeTruthy();
    // The value 42 should appear (as text node inside the number div)
    const nums = screen.getAllByText("42");
    expect(nums.length).toBeGreaterThan(0);
  });

  it("renders UNDER REVIEW from funnel.in_review", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    // "30" appears in the UNDER REVIEW tile
    const thirties = screen.getAllByText("30");
    expect(thirties.length).toBeGreaterThan(0);
  });

  it("renders SHORTLISTED from funnel.advanced", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    // SHORTLISTED appears in both the KPI tile and the funnel row label
    const shortlistedLabels = screen.getAllByText(/SHORTLISTED/i);
    expect(shortlistedLabels.length).toBeGreaterThan(0);
    const tens = screen.getAllByText("10");
    expect(tens.length).toBeGreaterThan(0);
  });

  it("UNDER REVIEW tile shows no '% of submissions' subtitle (removed)", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.queryByText(/of submissions/i)).toBeNull();
  });

  it("JURY EVALUATION tile shows no Preview badge in reviewer mode (removed)", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.getAllByText(/JURY EVALUATION/i).length).toBeGreaterThan(0);
    // No "Preview — backend pending" badge anywhere in reviewer mode.
    expect(screen.queryByText(/Preview/i)).toBeNull();
  });

  it("renders FINAL DECISIONS from funnel.decided", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.getByText(/FINAL DECISIONS/i)).toBeTruthy();
    const fives = screen.getAllByText("5");
    expect(fives.length).toBeGreaterThan(0);
  });

  it("shows a loading state while fetching", () => {
    useAdminData.mockReturnValue({ data: null, loading: true, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("shows an error banner on failure", () => {
    useAdminData.mockReturnValue({ data: null, loading: false, error: new Error("net") });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.getByText(/Failed to load dashboard/i)).toBeTruthy();
  });

  it("does not render the status-breakdown card (removed)", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.queryByText(/Status breakdown/i)).toBeNull();
    expect(screen.queryByText(/Where every application sits right now/i)).toBeNull();
  });

  it("renders the jury-mode KPI grid when decisionMode=jury", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="jury" />);
    // IN JURY EVALUATION appears in both the KPI tile and the funnel row
    const juryLabels = screen.getAllByText(/IN JURY EVALUATION/i);
    expect(juryLabels.length).toBeGreaterThan(0);
    // The jury KPI block is wrapped in a PreviewBadge (may appear multiple times)
    const previews = screen.getAllByText(/Preview/i);
    expect(previews.length).toBeGreaterThan(0);
  });
});
