import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
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
    unassignBatch: vi.fn().mockResolvedValue({ removed: 1 }),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";

const PIPELINE = {
  startups: [
    { id: "app-1", name: "Acme", founders: ["A"], domain: "Robotics",
      chip: "NEW", batch: "Batch A", ai: { overall: 7 }, status: "submitted",
      track: "tir", hidden: false, archived: false, sub: "TIR-1" },
  ],
  total: 1,
};
const BATCHES = { batches: [{ id: "b-1", name: "Batch A" }] };

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches")
      return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
});

describe("AdminPipeline unassign (batch → Unassigned)", () => {
  it("per-row: selecting Unassigned calls unassignBatch for that app", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // The per-row Batch dropdown is the only <select> showing "Batch A".
    const select = screen.getByDisplayValue("Batch A");
    fireEvent.change(select, { target: { value: "Unassigned" } });
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatch).toHaveBeenCalledWith([
        { track: "tir", application_id: "app-1" },
      ]);
    });
  });

  it("bulk: selecting Unassigned in the bulk bar calls unassignBatch for selected rows", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // Select the row to reveal the bulk action bar. checkbox[0] is the header
    // select-all; checkbox[1] is this single row.
    const rowCheckbox = screen.getAllByRole("checkbox")[1];
    fireEvent.click(rowCheckbox);
    // The bulk "Assign batch..." select appears; switch it to Unassigned.
    const bulkSelect = screen.getByDisplayValue("Assign batch...");
    fireEvent.change(bulkSelect, { target: { value: "Unassigned" } });
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatch).toHaveBeenCalledWith([
        { track: "tir", application_id: "app-1" },
      ]);
    });
  });
});
