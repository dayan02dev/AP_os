// AdminReviewers smoke test (Task 12)
//
// Mounts the new screens/AdminReviewers with useAdminData + adminPlatformApi
// + adminApi mocked. Asserts:
//   1. A reviewer row renders from mock data.
//   2. Clicking "Manage" opens the edit drawer.
//   3. Saving the drawer calls patchReviewer with (id, { weight, domains }).
//   4. Jury mode shows PreviewBadge and mock jury data.

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock hooks and API before importing the component.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    patchReviewer: vi.fn().mockResolvedValue({}),
    rebalance: vi.fn().mockResolvedValue({ assigned: 10, reviewers: 3 }),
    assignBatchReviewers: vi.fn().mockResolvedValue({ created: 1, reviewers: 1, applications: 5 }),
    unassignBatchReviewer: vi.fn().mockResolvedValue({ removed: 5 }),
  },
}));

vi.mock("../../../../lib/adminApi", () => ({
  adminApi: {
    createUser: vi.fn().mockResolvedValue({ temp_password: "Tmp@1234" }),
  },
}));

vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminReviewers } from "../screens/AdminReviewers";

const SAMPLE_REVIEWERS = [
  {
    id: "rev-001",
    name: "Priya Sharma",
    email: "priya@example.in",
    weight: 1.5,
    domains: ["AI", "Robotics"],
    domain: "AI, Robotics",
    batch: "Batch A",
    batches: ["Batch A"],
    assigned: 12,
    completed: 9,
    progress: "9 / 12",
    consistency: 0.92,
    last: "2h ago",
    startups: [],
  },
  {
    id: "rev-002",
    name: "Karthik Nair",
    email: "karthik@example.in",
    weight: 1.0,
    domains: ["CleanTech"],
    domain: "CleanTech",
    batch: "Batch B",
    batches: ["Batch B"],
    assigned: 8,
    completed: 4,
    progress: "4 / 8",
    consistency: 0.85,
    last: "1d ago",
    startups: [],
  },
];

describe("AdminReviewers (reviewer-mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders reviewer rows from hook data", () => {
    useAdminData.mockReturnValue({
      data: { reviewers: SAMPLE_REVIEWERS },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    expect(screen.getByText("Priya Sharma")).toBeTruthy();
    expect(screen.getByText("Karthik Nair")).toBeTruthy();
  });

  it("shows loading state while fetching", () => {
    useAdminData.mockReturnValue({ data: null, loading: true, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    expect(screen.getByText(/Loading reviewers/i)).toBeTruthy();
  });

  it("shows error state with retry on failure", () => {
    useAdminData.mockReturnValue({ data: null, loading: false, error: new Error("net"), reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    // error message from the Error object is rendered
    expect(screen.getByText(/net/i)).toBeTruthy();
    expect(screen.getByText(/Retry/i)).toBeTruthy();
  });

  it("shows empty state when no reviewers", () => {
    useAdminData.mockReturnValue({ data: { reviewers: [] }, loading: false, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    expect(screen.getByText(/No reviewers yet/i)).toBeTruthy();
  });

  it("opens manage drawer when Manage is clicked", () => {
    useAdminData.mockReturnValue({
      data: { reviewers: SAMPLE_REVIEWERS },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    const manageBtns = screen.getAllByText("Manage");
    fireEvent.click(manageBtns[0]);
    // Drawer title should appear
    expect(screen.getByText("Manage Applications")).toBeTruthy();
  });

  it("calls patchReviewer with id and body when Save changes is clicked", async () => {
    const reload = vi.fn();
    useAdminData.mockReturnValue({
      data: { reviewers: SAMPLE_REVIEWERS },
      loading: false,
      error: null,
      reload,
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    const manageBtns = screen.getAllByText("Manage");
    fireEvent.click(manageBtns[0]);

    // Save changes button in the drawer
    const saveBtn = screen.getByText("Save changes");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(adminPlatformApi.patchReviewer).toHaveBeenCalledWith(
        "rev-001",
        expect.objectContaining({ weight: expect.any(Number), domains: expect.any(Array) })
      );
    });
  });

  it("renders batch chips and calls unassignBatchReviewer when × is clicked", async () => {
    const reload = vi.fn();
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches") {
        return { data: { batches: [{ id: "bid-A", name: "Batch A" }, { id: "bid-B", name: "Batch B" }] }, loading: false, error: null, reload: vi.fn() };
      }
      return {
        data: { reviewers: [{ ...SAMPLE_REVIEWERS[0], batches: [{ name: "Batch A", count: 7 }] }] },
        loading: false, error: null, reload,
      };
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    // "7 of Batch A" summary text
    expect(screen.getByText(/7 of Batch A/)).toBeTruthy();
    // Click the × on the Batch A chip
    const removeBtn = screen.getByLabelText(/Remove Batch A from Priya Sharma/i);
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatchReviewer).toHaveBeenCalledWith("bid-A", "rev-001");
    });
  });

  it("assigns an unassigned batch via the + control", async () => {
    const reload = vi.fn();
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches") {
        return { data: { batches: [{ id: "bid-A", name: "Batch A" }, { id: "bid-B", name: "Batch B" }] }, loading: false, error: null, reload: vi.fn() };
      }
      return {
        data: { reviewers: [{ ...SAMPLE_REVIEWERS[0], batches: [{ name: "Batch A", count: 7 }] }] },
        loading: false, error: null, reload,
      };
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    const addSelect = screen.getByLabelText(/Assign a batch to Priya Sharma/i);
    fireEvent.change(addSelect, { target: { value: "Batch B" } });
    await waitFor(() => {
      expect(adminPlatformApi.assignBatchReviewers).toHaveBeenCalledWith("bid-B", { reviewer_user_ids: ["rev-001"] });
    });
  });

  it("calls rebalance when button is clicked", async () => {
    const reload = vi.fn();
    useAdminData.mockReturnValue({
      data: { reviewers: SAMPLE_REVIEWERS },
      loading: false,
      error: null,
      reload,
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    const rebalanceBtn = screen.getByText("Rebalance batches");
    fireEvent.click(rebalanceBtn);
    await waitFor(() => {
      expect(adminPlatformApi.rebalance).toHaveBeenCalledWith({});
    });
  });
});

describe("AdminReviewers (jury-mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jury mode still calls useAdminData (it mounts the hook regardless)
    useAdminData.mockReturnValue({ data: null, loading: false, error: null, reload: vi.fn() });
  });

  it("renders PreviewBadge in jury mode", () => {
    render(<AdminReviewers decisionMode="jury" />);
    expect(screen.getByTestId("preview-badge")).toBeTruthy();
  });

  it("renders mock jury member names in jury mode", () => {
    render(<AdminReviewers decisionMode="jury" />);
    expect(screen.getByText("Anand Mahindra")).toBeTruthy();
    expect(screen.getByText("Nandan Nilekani")).toBeTruthy();
  });

  it("does NOT call patchReviewer in jury mode", async () => {
    render(<AdminReviewers decisionMode="jury" />);
    const manageBtns = screen.getAllByText("Manage");
    fireEvent.click(manageBtns[0]);
    // Jury drawer has only a Close button (no Save changes)
    expect(screen.queryByText("Save changes")).toBeNull();
    expect(adminPlatformApi.patchReviewer).not.toHaveBeenCalled();
  });
});
