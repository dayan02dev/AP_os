// A row with no submitted date (e.g. an onboarded test app) shows "—" and
// sorts last in BOTH directions.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const base = { track: "tir", stage: "Lab", ai: { overall: 7 }, flags: [], batches: [], domain: "X",
  founders: ["f"], chip: "EVALUATED", reco: null, reviewers: null };
const ROWS = [
  { ...base, id: "n", applicationId: "TIR-1", name: "NoDate", sub: "", chip: "ONBOARDED" },
  { ...base, id: "a", applicationId: "TIR-2", name: "Early", sub: "2026-05-01" },
  { ...base, id: "b", applicationId: "TIR-3", name: "Late", sub: "2026-09-22" },
];

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (key) =>
    key === "batches"
      ? { data: { batches: [] }, loading: false, error: null, reload: () => {} }
      : { data: { startups: ROWS }, loading: false, error: null, reload: () => {} },
}));

import { AdminPipeline } from "../screens/AdminPipeline.jsx";

const rows = () => screen.getAllByTestId(/^pipeline-row-/);
const rowNames = () => rows().map((tr) => within(tr).getAllByRole("cell")[1].textContent);

describe("SUBMITTED column with a missing date", () => {
  it("sorts the undated row last ascending and descending, and shows —", () => {
    render(<AdminPipeline goDetail={() => {}} scopeKey="subsort" />);
    fireEvent.click(screen.getByText("SUBMITTED"));
    expect(rowNames()).toEqual(["Early", "Late", "NoDate"]);
    fireEvent.click(screen.getByText(/SUBMITTED/));
    expect(rowNames()).toEqual(["Late", "Early", "NoDate"]);
    const undated = screen.getByTestId("pipeline-row-n");
    expect(within(undated).getAllByRole("cell").some((c) => c.textContent === "—")).toBe(true);
  });
});
