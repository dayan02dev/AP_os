import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// AdminPipeline reads rows from useAdminData("pipeline") -> data.startups
// (already adapter-mapped, so they carry reviewers/reco). Mock the hook.
const ROWS = [
  { id: "A", applicationId: "TIR-1", track: "tir", name: "AppA", chip: "IN REVIEW",
    founders: ["Asha"], domain: "Robotics", stage: "Lab", ai: { overall: 7 },
    rev: { overall: 8 }, reviewers: { submitted: 2, assigned: 3 }, reco: { yes: 2, maybe: 0, no: 1 },
    batches: [], sub: "2026-07-01", flags: [] },
  { id: "B", applicationId: "TIR-2", track: "tir", name: "AppB", chip: "IN REVIEW",
    founders: ["Bo"], domain: "Robotics", stage: "Lab", ai: { overall: 5 },
    rev: { overall: 4 }, reviewers: { submitted: 1, assigned: 1 }, reco: { yes: 0, maybe: 0, no: 1 },
    batches: [], sub: "2026-07-02", flags: [] },
];

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (key) =>
    key === "batches"
      ? { data: { batches: [] }, loading: false, error: null, reload: () => {} }
      : { data: { startups: ROWS }, loading: false, error: null, reload: () => {} },
}));

import { AdminPipeline } from "../screens/AdminPipeline.jsx";

describe("AdminPipeline reco column + filter", () => {
  it("shows the Reviewers + Reco columns", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByText("2Y")).toBeTruthy();
  });

  it("filters to a chosen recommendation (>=1 semantics)", () => {
    // AppA reco {yes:2,no:1}; AppB reco {no:1}. Filtering by "Yes" keeps only AppA.
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes\b/ }));
    expect(screen.getByText("AppA")).toBeTruthy();
    expect(screen.queryByText("AppB")).not.toBeInTheDocument(); // AppB has no YES
  });

  it("surfaces the applied reco filter as a removable active pill", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes\b/ }));
    // Active-filter bar (gated by hasFilters/activeChips) now shows a Reco pill.
    expect(screen.getByText(/Reco · yes/)).toBeTruthy();
  });
});
