import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    patchReviewer: vi.fn(),
    assignBatchReviewers: vi.fn(),
    unassignBatchReviewer: vi.fn(),
    bulkAssignReviewerApps: vi.fn(),
    bulkRemoveReviewerApps: vi.fn(),
  },
}));
vi.mock("../../../../lib/adminApi", () => ({ adminApi: {} }));
vi.mock("../../../../lib/leadershipApi", () => ({ leadershipApi: {} }));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div />,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminReviewers } from "../screens/AdminReviewers";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";
import { buildBulkItems } from "../screens/AdminGate1";

const REVIEWER = {
  id: "rev-1", name: "Priya", email: "p@x.in", weight: 1, domains: ["AI"], domain: "AI",
  batches: [{ name: "Batch A", count: 3 }], assigned: 3, completed: 0, progress: "0 / 3",
};
// Duplicate name "Batch A": the FIRST id must win everywhere.
const BATCHES = [
  { id: "bid-A1", name: "Batch A" }, { id: "bid-A2", name: "Batch A" },
  { id: "bid-B", name: "Batch B" }, { id: "bid-C", name: "Batch C" },
];

function mockRoster() {
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches") return { data: { batches: BATCHES }, loading: false, error: null, reload: vi.fn() };
    return { data: { reviewers: [REVIEWER] }, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminPlatformApi.patchReviewer.mockResolvedValue({});
  adminPlatformApi.assignBatchReviewers.mockResolvedValue({ created: 5, reviewers_notified: 1 });
  adminPlatformApi.unassignBatchReviewer.mockResolvedValue({ removed: 1 });
  mockRoster();
});

describe("AdminReviewers roster batch assign", () => {
  it("resolves duplicate names to the first id and reports created + emails", async () => {
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.change(screen.getByLabelText("Assign a batch to Priya"), { target: { value: "Batch B" } });
    await waitFor(() => expect(adminPlatformApi.assignBatchReviewers)
      .toHaveBeenCalledWith("bid-B", { reviewer_user_ids: ["rev-1"] }));
    expect(await screen.findByText("Assigned 5 application(s) · 1 email(s) sent")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Batch A from Priya"));
    await waitFor(() => expect(adminPlatformApi.unassignBatchReviewer).toHaveBeenCalledWith("bid-A1", "rev-1"));
  });

  it("disables the control while in flight so a double click fires once", async () => {
    let resolve;
    adminPlatformApi.assignBatchReviewers.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<AdminReviewers decisionMode="reviewer" />);
    const sel = screen.getByLabelText("Assign a batch to Priya");
    fireEvent.change(sel, { target: { value: "Batch B" } });
    await waitFor(() => expect(screen.getByLabelText("Assign a batch to Priya").disabled).toBe(true));
    fireEvent.change(screen.getByLabelText("Assign a batch to Priya"), { target: { value: "Batch C" } });
    expect(adminPlatformApi.assignBatchReviewers).toHaveBeenCalledTimes(1);
    resolve({ created: 1 });
    await waitFor(() => expect(screen.getByLabelText("Assign a batch to Priya").disabled).toBe(false));
  });

  it("tolerates a response without reviewers_notified", async () => {
    adminPlatformApi.assignBatchReviewers.mockResolvedValue({ created: 2 });
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.change(screen.getByLabelText("Assign a batch to Priya"), { target: { value: "Batch B" } });
    expect(await screen.findByText("Assigned 2 application(s) · 0 email(s) sent")).toBeTruthy();
  });
});

describe("AdminReviewers ManageDrawer persists batch chip edits", () => {
  it("assigns added and unassigns removed batches on save", async () => {
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    fireEvent.click(screen.getByLabelText("Drop batch Batch A"));
    fireEvent.change(screen.getByLabelText("Add batch"), { target: { value: "Batch C" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(adminPlatformApi.assignBatchReviewers)
      .toHaveBeenCalledWith("bid-C", { reviewer_user_ids: ["rev-1"] }));
    expect(adminPlatformApi.unassignBatchReviewer).toHaveBeenCalledWith("bid-A1", "rev-1");
    expect(adminPlatformApi.patchReviewer).toHaveBeenCalled();
  });

  it("makes no batch calls when chips are untouched", async () => {
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(adminPlatformApi.patchReviewer).toHaveBeenCalled());
    expect(adminPlatformApi.assignBatchReviewers).not.toHaveBeenCalled();
    expect(adminPlatformApi.unassignBatchReviewer).not.toHaveBeenCalled();
  });
});

describe("ManageApplicationsDrawer native track + badges", () => {
  beforeEach(() => {
    adminPlatformApi.bulkAssignReviewerApps.mockResolvedValue({ results: [{ status: "created" }] });
    useAdminData.mockImplementation((kind) => {
      if (kind === "reviewerApplications")
        return { data: { applications: [
          { id: "app-1", track: "tir", effective_track: "sip", display_id: "SIP-26710", project: "Acme",
            industry: "AI", chip: "NEW", batch: null },
        ] }, loading: false, error: null, reload: vi.fn() };
      return { data: { startups: [
        { id: "app-9", name: "Gamma", domain: "AI", track: "sip", nativeTrack: "tir", batch: "Unassigned" },
      ] }, loading: false, error: null, reload: vi.fn() };
    });
  });

  it("assign sends the native track of a moved candidate", async () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "rev-1", name: "P", batches: [] }} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Assign candidate Gamma"));
    fireEvent.click(screen.getByRole("button", { name: /Assign selected/i }));
    await waitFor(() => expect(adminPlatformApi.bulkAssignReviewerApps)
      .toHaveBeenCalledWith("rev-1", [{ application_id: "app-9", track: "tir" }]));
  });

  it("shows the effective-track badge and display id on assigned rows", () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "rev-1", name: "P", batches: [] }} onClose={() => {}} />);
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.getByText("VIP-26710")).toBeTruthy();
  });
});

describe("AdminGate1 buildBulkItems native track", () => {
  it("sends nativeTrack for a moved app", () => {
    const { items } = buildBulkItems({ a1: "shortlisted" }, [{ id: "a1", track: "sip", nativeTrack: "tir" }], () => "");
    expect(items[0].track).toBe("tir");
  });
});
