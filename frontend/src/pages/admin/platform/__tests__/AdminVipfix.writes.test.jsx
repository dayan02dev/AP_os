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
    deleteBatch: vi.fn(),
    createBatch: vi.fn(),
    renameBatch: vi.fn(),
    assignBatch: vi.fn(),
    removeAppFromBatch: vi.fn(),
    unassignBatch: vi.fn(),
    bulkDecide: vi.fn(),
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
import { AdminPipeline, batchErrorText } from "../screens/AdminPipeline";

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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.change(screen.getByLabelText("Assign a batch to Priya"), { target: { value: "Batch B" } });
    await waitFor(() => expect(adminPlatformApi.assignBatchReviewers)
      .toHaveBeenCalledWith("bid-B", { reviewer_user_ids: ["rev-1"] }));
    expect(await screen.findByText("Assigned 5 application(s) · 1 email(s) sent")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Batch A from Priya"));
    await waitFor(() => expect(adminPlatformApi.unassignBatchReviewer).toHaveBeenCalledWith("bid-A1", "rev-1"));
    expect(confirmSpy).toHaveBeenCalledWith("Remove Priya from batch(es) Batch A? Their assignments on those applications are removed (submitted reviews are kept).");
  });

  it("roster chip x aborts on cancel", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByLabelText("Remove Batch A from Priya"));
    await new Promise((r) => setTimeout(r, 20));
    expect(adminPlatformApi.unassignBatchReviewer).not.toHaveBeenCalled();
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
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

  it("save aborts when the removal confirm is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    fireEvent.click(screen.getByLabelText("Drop batch Batch A"));
    fireEvent.click(screen.getByText("Save changes"));
    await new Promise((r) => setTimeout(r, 20));
    expect(adminPlatformApi.patchReviewer).not.toHaveBeenCalled();
    expect(adminPlatformApi.unassignBatchReviewer).not.toHaveBeenCalled();
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

describe("round 2: batch contract in AdminPipeline", () => {
  const STARTUPS = [
    { id: "a1", name: "Acme", founders: ["A"], domain: "R", chip: "NEW", batch: "Batch A",
      batches: [{ id: "b-1", name: "Batch A" }], ai: { overall: 7 }, status: "submitted",
      track: "tir", nativeTrack: "tir", hidden: false, archived: false, sub: "TIR-1" },
    { id: "a2", name: "Beta", founders: ["B"], domain: "R", chip: "NEW", batch: "",
      batches: [], ai: { overall: 7 }, status: "submitted",
      track: "tir", nativeTrack: "tir", hidden: false, archived: false, sub: "TIR-2" },
  ];
  beforeEach(() => {
    window.sessionStorage.clear();
    useAdminData.mockImplementation((kind) => kind === "batches"
      ? { data: { batches: [{ id: "b-1", name: "Batch A" }, { id: "b-2", name: "Batch B" }] }, loading: false, error: null, reload: vi.fn() }
      : { data: { startups: STARTUPS, total: 2 }, loading: false, error: null, reload: vi.fn() });
  });

  it("delete confirm text and assignments_removed note", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    adminPlatformApi.deleteBatch.mockResolvedValue({ ok: true, batch_id: "b-1", assignments_removed: 7 });
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(document.querySelector(".lp-filters-toggle") || screen.getByRole("button", { name: /Filters/i }));
    fireEvent.click(await screen.findByTitle("Delete batch Batch A"));
    await waitFor(() => expect(adminPlatformApi.deleteBatch).toHaveBeenCalledWith("b-1"));
    expect(confirmSpy).toHaveBeenCalledWith('Delete batch "Batch A"? Its applications return to Random allotment and its reviewers are removed from them (submitted reviews are kept).');
    expect(await screen.findByText(/7 reviewer assignment\(s\) removed/)).toBeTruthy();
  });

  it("bulk assign reports already-in-batch, closed and draft skips", async () => {
    adminPlatformApi.assignBatch.mockResolvedValue({
      assigned: 1, assignments_created: 3, reviewers_notified: 2,
      skipped_draft: ["x"], skipped_closed: ["y", "z"],
    });
    render(<AdminPipeline decisionMode="default" />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]); fireEvent.click(boxes[2]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Batch B" } });
    const note = await screen.findByText(/closed \(rejected/);
    expect(note.textContent).not.toMatch(/already in batch/);
    expect(note.textContent).toMatch(/2 closed \(rejected\/decided\) apps linked without reviewers/);
    expect(note.textContent).toMatch(/1 drafts skipped/);
  });

  it("counts already-in-batch as selected - assigned - drafts - unknown, and shows unknown", async () => {
    adminPlatformApi.assignBatch.mockResolvedValue({
      assigned: 0, assignments_created: 0, reviewers_notified: 0,
      skipped_draft: ["x"], skipped_unknown: ["u"],
    });
    render(<AdminPipeline decisionMode="default" />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]); fireEvent.click(boxes[2]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Batch B" } });
    const note = await screen.findByText(/not found/);
    expect(note.textContent).toMatch(/1 not found — refresh/);
    expect(note.textContent).not.toMatch(/already in batch/);
  });

  it("refuses reserved batch names locally", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Unbatched");
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.change(screen.getAllByDisplayValue("+ Add…")[1], { target: { value: "new" } });
    expect(await screen.findByText(/reserved name/)).toBeTruthy();
    expect(adminPlatformApi.createBatch).not.toHaveBeenCalled();
  });

  it("surfaces batch_name_exists on create", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Fresh");
    const err = Object.assign(new Error("dup"), { status: 409, code: "batch_name_exists" });
    adminPlatformApi.createBatch.mockRejectedValue(err);
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.change(screen.getAllByDisplayValue("+ Add…")[1], { target: { value: "new" } });
    expect(await screen.findByText(/already exists/)).toBeTruthy();
  });

  it("chip removal note says reviews are kept", async () => {
    adminPlatformApi.removeAppFromBatch.mockResolvedValue({});
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getByTitle("Remove from Batch A"));
    expect(await screen.findByText("Removed from batch (reviews kept).")).toBeTruthy();
  });

  it("batchErrorText maps codes", () => {
    expect(batchErrorText({ code: "unknown_application" }, "X")).toMatch(/no longer exist/);
    expect(batchErrorText({ code: "not_a_reviewer" }, "X")).toMatch(/not a reviewer/);
    expect(batchErrorText({ status: 422, message: "name must not be blank" }, "X")).toMatch(/blank/);
    expect(batchErrorText({ code: "draft_applications" }, "X")).toMatch(/drafts can't be batched/);
    expect(batchErrorText({ code: "batch_name_reserved" }, "X")).toMatch(/reserved/);
    expect(batchErrorText({ code: "lookup_failed" }, "X")).toMatch(/couldn't verify applications/);
    expect(batchErrorText(new Error("boom"), "X")).toBe("X: boom");
  });
});

describe("round 2: reviewers + drawer", () => {
  it("roster assign shows not_a_reviewer message", async () => {
    mockRoster();
    adminPlatformApi.assignBatchReviewers.mockRejectedValue(Object.assign(new Error("x"), { code: "not_a_reviewer" }));
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.change(screen.getByLabelText("Assign a batch to Priya"), { target: { value: "Batch B" } });
    expect(await screen.findByText("That user is not a reviewer.")).toBeTruthy();
  });

  it("drawer labels a null batch 'Not via a batch'", () => {
    useAdminData.mockImplementation((kind) => kind === "reviewerApplications"
      ? { data: { applications: [{ id: "a", track: "tir", project: "Acme", industry: "AI", chip: "NEW", batch: null }] }, loading: false, error: null, reload: vi.fn() }
      : { data: { startups: [] }, loading: false, error: null, reload: vi.fn() });
    render(<ManageApplicationsDrawer reviewer={{ id: "rev-1", name: "P", batches: [] }} onClose={() => {}} />);
    expect(screen.getByText("Not via a batch")).toBeTruthy();
    expect(screen.queryByText("Random allotment")).toBeNull();
  });

  it("drawer reports skipped_closed on assign", async () => {
    adminPlatformApi.bulkAssignReviewerApps.mockResolvedValue({ results: [{ status: "created" }, { status: "skipped_closed" }, { status: "skipped_closed" }] });
    useAdminData.mockImplementation((kind) => kind === "reviewerApplications"
      ? { data: { applications: [] }, loading: false, error: null, reload: vi.fn() }
      : { data: { startups: [
        { id: "g", name: "Gamma", domain: "AI", track: "tir", batch: "Unassigned" },
        { id: "h", name: "Hola", domain: "AI", track: "tir", batch: "Unassigned" },
        { id: "i", name: "Iota", domain: "AI", track: "tir", batch: "Unassigned" }] }, loading: false, error: null, reload: vi.fn() });
    render(<ManageApplicationsDrawer reviewer={{ id: "rev-1", name: "P", batches: [] }} onClose={() => {}} />);
    ["Gamma", "Hola", "Iota"].forEach(n => fireEvent.click(screen.getByLabelText(`Assign candidate ${n}`)));
    fireEvent.click(screen.getByRole("button", { name: /Assign selected/i }));
    expect(await screen.findByText(/2 skipped \(closed\)/)).toBeTruthy();
  });
});
