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
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";   // named export

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
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches")
      return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("AdminPipeline batch delete", () => {
  it("calls deleteBatch when the batch delete control is confirmed", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // The batch delete control lives inside the collapsible filter panel, which
    // is collapsed by default — open it first.
    const toggle =
      document.querySelector(".lp-filters-toggle") ||
      screen.getByRole("button", { name: /Filters/i });
    fireEvent.click(toggle);
    const del = await screen.findByTitle("Delete batch Batch A");
    fireEvent.click(del);
    await waitFor(() => {
      expect(adminPlatformApi.deleteBatch).toHaveBeenCalledWith("b-1");
    });
  });

  it("has no Hide / Unhide bulk button", () => {
    render(<AdminPipeline decisionMode="default" />);
    expect(screen.queryByText("Hide / Unhide")).toBeNull();
  });
});
