// Filters must survive opening an application and coming back. The admin shell
// swaps `page` to 'detail', which fully unmounts AdminPipeline, so before
// useStickyState every filter snapped back to its default.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
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
import { AdminPipeline } from "../screens/AdminPipeline";

const PIPELINE = {
  startups: [
    { id: "app-1", name: "TirCo", founders: ["A"], domain: "Robotics", chip: "NEW",
      batch: "Batch A", ai: { overall: 7 }, status: "submitted", track: "tir",
      hidden: false, archived: false, sub: "TIR-1" },
    { id: "app-2", name: "VipCo", founders: ["B"], domain: "Health", chip: "NEW",
      batch: "Batch A", ai: { overall: 6 }, status: "submitted", track: "sip",
      hidden: false, archived: false, sub: "VIP-1" },
  ],
  total: 2,
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

describe("AdminPipeline sticky filters", () => {
  it("keeps the track filter after the screen unmounts and remounts", () => {
    const first = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    expect(screen.getByText("TirCo")).toBeInTheDocument();
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
  });

  it("keeps the search text after a remount", () => {
    const first = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "TirCo" } });
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    expect(screen.getByPlaceholderText(/search/i)).toHaveValue("TirCo");
  });

  it("does not leak the Applications filter into the Rejected tab", () => {
    const first = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    // Different tab, same component — must start unfiltered.
    render(<AdminPipeline decisionMode="default" scopeKey="rejected" readOnly heading="Rejected applications" />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();
  });

  // Production mounts this screen with data:null/loading:true and fills in
  // async, whereas the tests above hand it loaded data on the first render.
  // That is the one shape difference between test and prod, so pin it down.
  it("restores the filter when the list data arrives only after mount", () => {
    const first = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    // Return trip: mounts empty and still loading…
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches")
        return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
      return { data: null, loading: true, error: null, reload: vi.fn() };
    });
    const second = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);

    // …then the rows land.
    useAdminData.mockImplementation((kind) => {
      if (kind === "batches")
        return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
      return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
    });
    second.rerender(<AdminPipeline decisionMode="default" scopeKey="applications" />);

    expect(screen.getByText("TirCo")).toBeInTheDocument();
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
  });

  it("clearing filters also clears what was persisted", () => {
    const first = render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("VipCo")).toBeInTheDocument();
    first.unmount();

    render(<AdminPipeline decisionMode="default" scopeKey="applications" />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();
  });
});
