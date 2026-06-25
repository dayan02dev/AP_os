import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    bulkAssignReviewerApps: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    bulkRemoveReviewerApps: vi.fn().mockResolvedValue({
      results: [{ status: "removed" }, { status: "removed" }],
    }),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";

const ASSIGNED = {
  applications: [
    { id: "app-1", track: "tir", project: "Acme", industry: "Robotics",
      status: "under_review", chip: "IN REVIEW", batch: "Batch A",
      reviewStatus: "pending", assignmentId: "as-1" },
    { id: "app-2", track: "tir", project: "Beta", industry: "Health",
      status: "submitted", chip: "NEW", batch: null,
      reviewStatus: "pending", assignmentId: "as-2" },
  ],
};
const PIPELINE = {
  startups: [
    { id: "app-9", name: "Gamma", domain: "AI", track: "tir", batch: "Unassigned" },
  ],
};
const reviewer = { id: "rev-1", name: "Abhijit Lele", domain: "AI", batches: [] };

beforeEach(() => {
  useAdminData.mockImplementation((kind) => {
    if (kind === "reviewerApplications")
      return { data: ASSIGNED, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
});

describe("ManageApplicationsDrawer bulk actions", () => {
  it("select-all then Remove selected calls bulkRemoveReviewerApps with all items", async () => {
    render(<ManageApplicationsDrawer reviewer={reviewer} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select all applications"));
    fireEvent.click(screen.getByRole("button", { name: /Remove selected/i }));
    await waitFor(() => {
      expect(adminPlatformApi.bulkRemoveReviewerApps).toHaveBeenCalledWith(
        "rev-1",
        expect.arrayContaining([
          { application_id: "app-1", track: "tir" },
          { application_id: "app-2", track: "tir" },
        ]),
      );
    });
  });

  it("multi-assign calls bulkAssignReviewerApps with checked candidates", async () => {
    render(<ManageApplicationsDrawer reviewer={reviewer} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Assign candidate Gamma"));
    fireEvent.click(screen.getByRole("button", { name: /Assign selected/i }));
    await waitFor(() => {
      expect(adminPlatformApi.bulkAssignReviewerApps).toHaveBeenCalledWith(
        "rev-1",
        [{ application_id: "app-9", track: "tir" }],
      );
    });
  });
});
