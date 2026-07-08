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
    assignBatchReviewers: vi.fn().mockResolvedValue({ created: 1, reviewers: 1, applications: 5 }),
    unassignBatchReviewer: vi.fn().mockResolvedValue({ removed: 5 }),
    bulkAssignReviewerApps: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    bulkRemoveReviewerApps: vi.fn().mockResolvedValue({ results: [{ status: "removed" }] }),
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

vi.mock("../../../../lib/leadershipApi", () => ({
  leadershipApi: {
    assignReviewers: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    unassignReviewer: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { adminApi } from "../../../../lib/adminApi";
import { leadershipApi } from "../../../../lib/leadershipApi";
import { AdminReviewers, genStrongPassword, pwValid } from "../screens/AdminReviewers";

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

// kind-aware useAdminData for the Manage Applications drawer
function mockUseAdminData() {
  useAdminData.mockImplementation((kind) => {
    if (kind === "reviewerApplications")
      return { data: { applications: [
        { id: "app-1", track: "tir", project: "Saathi Health AI", industry: "MedTech",
          status: "shortlisted", chip: "SHORTLISTED", batch: "Batch A", reviewStatus: "pending" },
      ] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "pipeline")
      return { data: { startups: [
        { id: "app-9", track: "tir", name: "Karkhana Robotics", domain: "Robotics", batch: "Unassigned" },
      ] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "batches")
      return { data: { batches: [] }, loading: false, error: null, reload: vi.fn() };
    return { data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() };
  });
}

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

  it("renders an 'Unbatched' bucket chip without a remove (×) control", () => {
    useAdminData.mockReturnValue({
      data: { reviewers: [{
        ...SAMPLE_REVIEWERS[0],
        batches: [{ name: "Batch A", count: 145 }, { name: "Unbatched", count: 10 }],
        progress: "0 / 155",
      }] },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    // A real batch keeps its remove control…
    expect(screen.getByLabelText(/Remove Batch A from/i)).toBeTruthy();
    // …but the computed "Unbatched" bucket has none (nothing to unassign from).
    expect(screen.queryByLabelText(/Remove Unbatched from/i)).toBeNull();
    // The bucket count is still shown in the label.
    expect(screen.getByText(/10 of Unbatched/i)).toBeTruthy();
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

  it("Manage opens the Manage Applications drawer and lists assigned apps", () => {
    mockUseAdminData();
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getAllByText("Manage")[0]);
    expect(screen.getByText("Manage Applications")).toBeTruthy();
    expect(screen.getByText("Saathi Health AI")).toBeTruthy();
    expect(screen.getByText(/Assigned Applications \(1\)/)).toBeTruthy();
  });

  it("Remove calls bulkRemoveReviewerApps", async () => {
    mockUseAdminData();
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getAllByText("Manage")[0]);
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() =>
      expect(adminPlatformApi.bulkRemoveReviewerApps).toHaveBeenCalledWith(
        "rev-001", [{ application_id: "app-1", track: "tir" }]));
  });

  it("Assign calls bulkAssignReviewerApps", async () => {
    mockUseAdminData();
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getAllByText("Manage")[0]);
    fireEvent.click(screen.getByLabelText("Assign candidate Karkhana Robotics"));
    fireEvent.click(screen.getByRole("button", { name: /Assign selected/i }));
    await waitFor(() =>
      expect(adminPlatformApi.bulkAssignReviewerApps).toHaveBeenCalledWith(
        "rev-001", [{ application_id: "app-9", track: "tir" }]));
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
    // Editing reviewer details is reached via "Edit reviewer" → "Edit details"
    // (reviewer-mode "Manage" now opens the Manage Applications drawer instead).
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));

    // Save changes button in the edit drawer
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

  it("does not render the External·paid sub-label or a Consistency column", () => {
    useAdminData.mockReturnValue({ data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    expect(screen.queryByText(/paid per review/i)).toBeNull();
    expect(screen.queryByText("Consistency")).toBeNull();
  });

  it("weight input is clamped to 0–10 in the edit drawer", () => {
    useAdminData.mockReturnValue({ data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    const weightInput = document.querySelector('input[type="number"]');
    expect(weightInput).toBeTruthy();
    expect(weightInput.getAttribute("min")).toBe("0");
    expect(weightInput.getAttribute("max")).toBe("10");
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

describe("genStrongPassword / pwValid helpers", () => {
  it("pwValid returns true for genStrongPassword output", () => {
    for (let i = 0; i < 20; i++) {
      const pw = genStrongPassword();
      expect(pwValid(pw)).toBe(true);
    }
  });

  it("pwValid returns false for weak passwords", () => {
    expect(pwValid("weak")).toBe(false);
    expect(pwValid("alllowercase1!")).toBe(false);   // no uppercase
    expect(pwValid("ALLUPPERCASE1!")).toBe(false);   // no lowercase
    expect(pwValid("NoDigitHere!!")).toBe(false);    // no digit
    expect(pwValid("NoSymbol1A")).toBe(false);       // no symbol
    expect(pwValid("Sh0rt!")).toBe(false);           // too short
  });
});

describe("InviteModal — sends temp_password to createUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches") return { data: { batches: [] }, loading: false, error: null, reload: vi.fn() };
      return { data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() };
    });
  });

  it("calls createUser with non-empty temp_password and roles=['reviewer']", async () => {
    render(<AdminReviewers decisionMode="reviewer" />);
    // Open the invite modal
    fireEvent.click(screen.getByText("Invite member"));

    // Fill name and email
    const inputs = screen.getAllByRole("textbox");
    const nameInput = inputs.find(i => i.placeholder && /Vikram/i.test(i.placeholder));
    const emailInput = inputs.find(i => i.placeholder && /example/i.test(i.placeholder));
    fireEvent.change(nameInput, { target: { value: "Test Reviewer" } });
    fireEvent.change(emailInput, { target: { value: "test@example.in" } });

    // Submit
    fireEvent.click(screen.getByText("Send Invite"));

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          temp_password: expect.any(String),
          roles: ["reviewer"],
          email: "test@example.in",
          full_name: "Test Reviewer",
        })
      );
      const call = adminApi.createUser.mock.calls[0][0];
      expect(call.temp_password.length).toBeGreaterThan(0);
    });
  });

  it("sends the selected batch's ID (not its name) as batch_id", async () => {
    // Regression: the modal used to send the batch NAME into batch_id (a uuid
    // column), so the backend upsert threw and both domain + batch were lost.
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches")
        return { data: { batches: [{ id: "bid-A", name: "Batch A" }] }, loading: false, error: null, reload: vi.fn() };
      return { data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() };
    });
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Invite member"));

    const inputs = screen.getAllByRole("textbox");
    const nameInput = inputs.find(i => i.placeholder && /Vikram/i.test(i.placeholder));
    const emailInput = inputs.find(i => i.placeholder && /example/i.test(i.placeholder));
    fireEvent.change(nameInput, { target: { value: "Batch Rev" } });
    fireEvent.change(emailInput, { target: { value: "batch@example.in" } });

    // The invite modal's batch <select> is the one offering "None (Unassigned)".
    const batchSelect = screen.getAllByRole("combobox").find(
      s => Array.from(s.options || []).some(o => o.textContent === "None (Unassigned)")
    );
    expect(batchSelect).toBeTruthy();
    // Its option value is the batch ID, not the name.
    expect(Array.from(batchSelect.options).some(o => o.value === "bid-A")).toBe(true);
    fireEvent.change(batchSelect, { target: { value: "bid-A" } });

    fireEvent.click(screen.getByText("Send Invite"));

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: "bid-A", expertise_domains: expect.any(Array) })
      );
    });
  });
});
