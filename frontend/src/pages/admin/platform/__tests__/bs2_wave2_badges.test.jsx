// BS2 wave2 — S2-ADM-59/77: Pipeline + Gate1 writes refresh the portal tab badges.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn(), loadDetail: vi.fn().mockResolvedValue(null) }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    unassignBatch: vi.fn().mockResolvedValue({ removed: 1 }),
    decide: vi.fn().mockResolvedValue({}),
    bulkDecide: vi.fn().mockResolvedValue({ results: [] }),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({ PreviewBadge: () => null }));

import { useAdminData, loadDetail } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";
import AdminGate1 from "../screens/AdminGate1";

const row = {
  id: "app-1", name: "Acme", founders: ["A"], domain: "Robotics", chip: "EVALUATED",
  batch: "Batch A", batches: [{ id: "b-1", name: "Batch A" }], ai: { overall: 7 },
  status: "evaluated", track: "tir", nativeTrack: "tir", sub: "TIR-1",
  reviewers: { submitted: 2, assigned: 2 }, reco: { yes: 2, maybe: 0, no: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  loadDetail.mockResolvedValue(null);
  adminPlatformApi.decide.mockResolvedValue({});
  adminPlatformApi.unassignBatch.mockResolvedValue({ removed: 1 });
  useAdminData.mockImplementation((kind) =>
    kind === "batches"
      ? { data: { batches: [{ id: "b-1", name: "Batch A" }] }, loading: false, error: null, reload: vi.fn() }
      : { data: { startups: [row], total: 1 }, loading: false, error: null, reload: vi.fn() });
});

describe("tab badges refresh after admin writes", () => {
  it("AdminPipeline bulk unassign calls onChanged", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChanged = vi.fn();
    render(<AdminPipeline decisionMode="default" onChanged={onChanged} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.change(screen.getByDisplayValue("Assign batch..."), { target: { value: "Unassigned" } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("AdminGate1 stack Approve calls onChanged", async () => {
    const onChanged = vi.fn();
    render(<AdminGate1 goDetail={() => {}} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(adminPlatformApi.decide).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
