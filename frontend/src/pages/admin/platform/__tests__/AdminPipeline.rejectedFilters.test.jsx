// Rejected tab filter panel: no zero-count batch chips, and the status chip
// uses the same label as the STATUS column ("Rejected").
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const row = (id, batches) => ({ id, applicationId: `TIR-${id}`, track: "tir", name: `P${id}`,
  founders: [], domain: "AI", chip: "REJECTED", flags: [], batches: batches.map((name) => ({ name })),
  batch: batches[0] || "Unassigned", sub: "2026-06-01", ai: {}, reco: null });

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "pipeline") {
      return { data: { startups: [row("1", []), row("2", []), row("3", ["Batch B"])], total: 3 },
        loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "batches") {
      return { data: { batches: [{ id: "a", name: "Batch A" }, { id: "b", name: "Batch B" },
        { id: "c", name: "comm" }] }, loading: false, reload: vi.fn() };
    }
    return { data: null, loading: false, error: null, reload: vi.fn() };
  },
}));

import { AdminPipeline } from "../screens/AdminPipeline";

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

describe("Rejected tab filter panel", () => {
  it("hides zero-count batch chips and labels the status chip 'Rejected'", () => {
    render(<AdminPipeline goDetail={() => {}} readOnly baseFilter={{ status: "rejected" }}
      heading="Rejected applications" scopeKey="rejected-test" />);
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = document.querySelector(".lp-filter-panel");
    const p = within(panel);
    expect(p.getByRole("button", { name: /Unassigned\s*2/ })).toBeTruthy();
    expect(p.getByRole("button", { name: /Batch B\s*1/ })).toBeTruthy();
    expect(p.queryByRole("button", { name: /Batch A/ })).toBeNull();
    expect(p.queryByRole("button", { name: /^comm/ })).toBeNull();
    expect(p.queryByText("Not selected")).toBeNull();
    expect(p.getByRole("button", { name: /Rejected\s*3/ })).toBeTruthy();
  });
});
