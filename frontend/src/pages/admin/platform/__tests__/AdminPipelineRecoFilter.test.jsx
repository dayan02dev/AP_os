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
  it("shows the Reviewers column and ONE aggregate reco chip per row", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByText("YES")).toBeTruthy();   // A: 2Y1N -> majority yes
    expect(screen.getByText("NO")).toBeTruthy();    // B: 1N unanimous
    expect(screen.queryByText("2Y")).not.toBeInTheDocument();
  });

  it("filters by AGGREGATE verdict from the panel", () => {
    // A verdict=yes, B verdict=no. Panel "Yes" keeps only A.
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes\b/ }));
    expect(screen.getByText("AppA")).toBeTruthy();
    expect(screen.queryByText("AppB")).not.toBeInTheDocument();
  });

  it("clicking a reco cell applies that verdict filter (and clicking again clears it)", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /Filter by reco: no/i }));
    expect(screen.getByText("AppB")).toBeTruthy();
    expect(screen.queryByText("AppA")).not.toBeInTheDocument();
    // toggle off: the surviving row's cell is the same button
    fireEvent.click(screen.getByRole("button", { name: /Filter by reco: no/i }));
    expect(screen.getByText("AppA")).toBeTruthy();
  });

  it("the — panel bucket filters apps with no reviews", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^—/ }));
    // Neither mock row lacks reviews -> empty table
    expect(screen.queryByText("AppA")).not.toBeInTheDocument();
    expect(screen.queryByText("AppB")).not.toBeInTheDocument();
  });

  it("surfaces the applied reco filter as a removable active pill", () => {
    render(<AdminPipeline goDetail={() => {}} decisionMode="reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes\b/ }));
    expect(screen.getByText(/Reco · yes/)).toBeTruthy();
  });
});
