import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createBatch: vi.fn().mockResolvedValue({ id: "b-new" }),
    renameBatch: vi.fn().mockResolvedValue({}),
    deleteBatch: vi.fn().mockResolvedValue({ ok: true }),
    assignBatch: vi.fn().mockResolvedValue({ assigned: 1 }),
    unassignBatch: vi.fn().mockResolvedValue({ removed: 1, assignments_removed: 4 }),
    removeAppFromBatch: vi.fn().mockResolvedValue({}),
    bulkDecide: vi.fn().mockResolvedValue({ results: [] }),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";

const row = (over) => ({
  id: "app-1", name: "Acme", founders: ["A"], domain: "Robotics",
  chip: "NEW", batch: "Batch A", batches: [{ id: "b-1", name: "Batch A" }],
  ai: { overall: 7 }, status: "submitted",
  track: "tir", nativeTrack: "tir", hidden: false, archived: false, sub: "TIR-1",
  ...over,
});
let STARTUPS;
const BATCHES = { batches: [{ id: "b-1", name: "Batch A" }, { id: "b-2", name: "Batch B" }] };

beforeEach(() => {
  vi.clearAllMocks();
  STARTUPS = [row()];
  adminPlatformApi.unassignBatch.mockResolvedValue({ removed: 1, assignments_removed: 4 });
  adminPlatformApi.assignBatch.mockResolvedValue({ assigned: 1 });
  adminPlatformApi.bulkDecide.mockResolvedValue({ results: [] });
  adminPlatformApi.createBatch.mockResolvedValue({ id: "b-new" });
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches")
      return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
    return { data: { startups: STARTUPS, total: STARTUPS.length }, loading: false, error: null, reload: vi.fn() };
  });
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("AdminPipeline unassign (batch → Unassigned)", () => {
  it("per-row: removing a batch chip sends the NATIVE track of a moved app", async () => {
    STARTUPS = [row({ track: "sip", nativeTrack: "tir" })];
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getByTitle("Remove from Batch A"));
    await waitFor(() => {
      expect(adminPlatformApi.removeAppFromBatch).toHaveBeenCalledWith("b-1", [
        { track: "tir", application_id: "app-1" },
      ]);
    });
  });

  it("bulk: Unassigned asks for confirmation and sends the native track", async () => {
    STARTUPS = [row({ track: "sip", nativeTrack: "tir" })];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Unassigned" } });
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatch).toHaveBeenCalledWith([
        { track: "tir", application_id: "app-1" },
      ]);
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove 1 application(s) from every batch AND from all assigned reviewers? Submitted reviews are kept.",
    );
    expect(await screen.findByText(/4 reviewer assignment\(s\) removed/)).toBeTruthy();
  });

  it("bulk: cancelling the confirm aborts the unassign", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Unassigned" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(adminPlatformApi.unassignBatch).not.toHaveBeenCalled();
  });
});

describe("AdminPipeline writes use native track / visible rows / unique names", () => {
  it("bulk assign sends nativeTrack for a moved app", async () => {
    STARTUPS = [row({ track: "sip", nativeTrack: "tir", batches: [], batch: "" })];
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Batch B" } });
    await waitFor(() => expect(adminPlatformApi.assignBatch).toHaveBeenCalledWith("b-2", {
      items: [{ track: "tir", application_id: "app-1" }],
    }));
  });

  it("per-row assign sends nativeTrack for a moved app", async () => {
    STARTUPS = [row({ track: "sip", nativeTrack: "tir", batches: [], batch: "" })];
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.change(screen.getByDisplayValue("+ Add…"), { target: { value: "Batch B" } });
    await waitFor(() => expect(adminPlatformApi.assignBatch).toHaveBeenCalledWith("b-2", {
      items: [{ track: "tir", application_id: "app-1" }],
    }));
  });

  it("bulk reject sends nativeTrack for a moved app", async () => {
    STARTUPS = [row({ track: "sip", nativeTrack: "tir" })];
    vi.spyOn(window, "prompt").mockReturnValue("not a fit");
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(adminPlatformApi.bulkDecide).toHaveBeenCalled());
    expect(adminPlatformApi.bulkDecide.mock.calls[0][0].items[0].track).toBe("tir");
  });

  it("selection is cleared when the track filter changes, so hidden rows are never sent", async () => {
    STARTUPS = [
      row({ id: "v1", name: "VipCo", track: "sip", nativeTrack: "sip", batches: [], batch: "" }),
      row({ id: "t1", name: "TirCo", track: "tir", nativeTrack: "tir", batches: [], batch: "" }),
    ];
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // the VIP row
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    // Selection dropped → no bulk bar.
    expect(screen.queryByDisplayValue("Assign batch...")).toBeNull();
    expect(adminPlatformApi.assignBatch).not.toHaveBeenCalled();
  });

  it("refuses to create a batch whose name already exists (case-insensitive)", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("  batch a ");
    render(<AdminPipeline decisionMode="default" />);
    fireEvent.change(screen.getByDisplayValue("+ Add…"), { target: { value: "new" } });
    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    expect(adminPlatformApi.createBatch).not.toHaveBeenCalled();
  });
});
