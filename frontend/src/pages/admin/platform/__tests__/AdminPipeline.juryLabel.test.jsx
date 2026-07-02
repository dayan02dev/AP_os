// Regression for the "approve → shows INTERVIEW" bug. An APPROVED application
// sits at status jury_review (chip "JURY REVIEW"); the pipeline table badge must
// read "JURY REVIEW", never "INTERVIEW" (the prototype's old getFriendlyStatus
// re-labelled it). Reproduces the exact row from the reported screenshot.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createBatch: vi.fn(), renameBatch: vi.fn(), deleteBatch: vi.fn(),
    assignBatch: vi.fn(), unassignBatch: vi.fn(),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div>Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { AdminPipeline } from "../screens/AdminPipeline";

// An approved TIR application, mirroring the reported "Electric marine propulsion" row.
const PIPELINE = {
  startups: [
    { id: "app-jury", name: "Electric marine propulsion", founders: ["Ratheesh M. Yogananda"],
      domain: "Defense & Aerospace", stage: "Research", chip: "JURY REVIEW", status: "jury_review",
      ai: { overall: 9.0 }, batch: "Unassigned", track: "tir", hidden: false, archived: false,
      sub: "TIR-26144" },
  ],
  total: 1,
};
const BATCHES = { batches: [] };

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockImplementation((kind) =>
    kind === "batches"
      ? { data: BATCHES, loading: false, error: null, reload: vi.fn() }
      : { data: PIPELINE, loading: false, error: null, reload: vi.fn() });
});

describe("AdminPipeline jury-round status label", () => {
  it("renders an approved application's badge as JURY REVIEW, never INTERVIEW", () => {
    render(<AdminPipeline decisionMode="default" />);
    expect(screen.getByText("Electric marine propulsion")).toBeTruthy();
    // The status badge for a jury_review row.
    expect(screen.getAllByText("JURY REVIEW").length).toBeGreaterThan(0);
    // The bug: it must NOT say "Interview" anywhere.
    expect(screen.queryByText(/interview/i)).toBeNull();
  });
});
