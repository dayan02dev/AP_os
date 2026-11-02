// Manage Applications drawer — reviewed-then-unassigned apps (ADM-F8 / AF-3 /
// DR-6). The backend (admin_query.fetch_reviewer_applications) lists only live
// assignments, so a reviewed app whose assignment was removed is simply not in
// the drawer list and can be assigned back from the picker; there is no
// separate "Reviewed — no longer assigned" group. Removing a reviewed app
// reports that the assignment was removed and the review kept (the backend's
// `skipped_submitted` status means exactly that — the row IS deleted).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { adaptReviewerApplication } from "../../../../lib/adminDataAdapter.js";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    bulkAssignReviewerApps: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    bulkRemoveReviewerApps: vi.fn(),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";

const ok = (data) => ({ data, loading: false, error: null, reload: vi.fn() });

function mockData(applications, startups) {
  useAdminData.mockImplementation((kind) => (kind === "reviewerApplications"
    ? ok({ applications: applications.map(adaptReviewerApplication) })
    : ok({ startups })));
}

const PIPE = [
  { id: "V1", applicationId: "VIP-1", name: "Reviewed Co", domain: "Climate", track: "sip", nativeTrack: "sip", batch: "Unassigned", chip: "EVALUATED" },
  { id: "V2", applicationId: "VIP-2", name: "Other Co", domain: "Climate", track: "sip", nativeTrack: "sip", batch: "Unassigned", chip: "NEW" },
  { id: "V3", applicationId: "VIP-3", name: "Live Co", domain: "Climate", track: "sip", nativeTrack: "sip", batch: "Unassigned", chip: "IN REVIEW" },
];

beforeEach(() => vi.clearAllMocks());

describe("adaptReviewerApplication", () => {
  it("keeps detached / effective_track / display_id the drawer needs", () => {
    const row = adaptReviewerApplication({
      id: "V1", track: "tir", effective_track: "sip", display_id: "TIR-27001",
      project: "P", status: "under_review", batch: null, reviewStatus: "submitted",
      assignment_id: null, detached: true,
    });
    expect(row.detached).toBe(true);
    expect(row.effective_track).toBe("sip");
    expect(row.display_id).toBe("TIR-27001");
  });
  it("defaults detached to false", () => {
    expect(adaptReviewerApplication({ id: "x", track: "tir", status: "submitted" }).detached).toBe(false);
  });
});

describe("ManageApplicationsDrawer after a reviewed app was unassigned", () => {
  beforeEach(() => {
    // Backend contract: only live assignments come back.
    mockData([
      { id: "V3", track: "sip", project: "Live Co", status: "under_review", batch: null,
        reviewStatus: "pending", assignment_id: "as-3" },
    ], PIPE);
  });

  it("lists only live assignments and has no 'no longer assigned' group", () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={() => {}} />);
    expect(screen.getByText("Assigned Applications (1)")).toBeTruthy();
    expect(screen.queryByTestId("detached-group")).toBeNull();
    expect(screen.queryByText(/no longer assigned/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("select-all removes the live assignments", async () => {
    adminPlatformApi.bulkRemoveReviewerApps.mockResolvedValue({ results: [{ status: "removed" }] });
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select all applications"));
    fireEvent.click(screen.getByRole("button", { name: /Remove selected \(1\)/ }));
    await screen.findByText(/removed 1/);
    expect(adminPlatformApi.bulkRemoveReviewerApps).toHaveBeenCalledWith("r1", [{ application_id: "V3", track: "sip" }]);
  });

  it("the unassigned app can be assigned back (it is a candidate again)", () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={() => {}} />);
    expect(screen.getByLabelText("Assign candidate Reviewed Co")).toBeTruthy();
    expect(screen.getByLabelText("Assign candidate Other Co")).toBeTruthy();
    expect(screen.queryByLabelText("Assign candidate Live Co")).toBeNull();
  });
});

describe("Removing a reviewed app (AF-3)", () => {
  it("reports the assignment removed and the review kept, not 'skipped'", async () => {
    mockData([
      { id: "V3", track: "sip", project: "Live Co", status: "evaluated", batch: null,
        reviewStatus: "submitted", assignment_id: "as-3" },
    ], PIPE);
    adminPlatformApi.bulkRemoveReviewerApps.mockResolvedValue({ results: [{ status: "skipped_submitted" }] });
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/removed 1 \(1 already reviewed, review kept\)/)).toBeTruthy();
    expect(screen.queryByText(/skipped/)).toBeNull();
  });
  it("accepts the newer removed_kept_review status too", async () => {
    mockData([
      { id: "V3", track: "sip", project: "Live Co", status: "evaluated", batch: null,
        reviewStatus: "submitted", assignment_id: "as-3" },
    ], PIPE);
    adminPlatformApi.bulkRemoveReviewerApps.mockResolvedValue({ results: [{ status: "removed_kept_review" }] });
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/removed 1 \(1 already reviewed, review kept\)/)).toBeTruthy();
  });
});
