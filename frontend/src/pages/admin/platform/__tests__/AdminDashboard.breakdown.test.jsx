// ADM-01 — when /stats carries pipeline_breakdown (contract C1) the dashboard
// tiles + funnel render the mutually exclusive stages, which reconcile to total.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
import { useAdminData } from "../../../../hooks/useAdminData";
import { AdminDashboard } from "../screens/AdminDashboard";

const BREAKDOWN = {
  total: 605,
  stages: { submitted: 2, under_review: 76, reviewed: 345, gate1_rejected: 134,
    final_pending: 10, final_rejected: 20, final_selected: 16, offered: 0, onboarded: 2,
    on_hold: 0, waitlisted: 0, withdrawn: 0 },
  gate1_selected: 48,
  rejected_total: 154,
};
const STATS = {
  totals: { apps_submitted: 605, onboarded: 2 },
  // Old, wrong numbers — must NOT be what the tiles show when the breakdown exists.
  funnel: { submitted: 605, in_review: 603, advanced: 0, decided: 2 },
  statusCounts: [],
  decisions: { rejected: 153 },
  pipelineBreakdown: BREAKDOWN,
};

function mount() {
  useAdminData.mockImplementation((resource) =>
    resource === "stats"
      ? { data: STATS, loading: false, error: null }
      : { data: { startups: [] }, loading: false, error: null });
  return render(<AdminDashboard go={() => {}} selectedCount={99} />);
}

const tile = (label) => screen.getByTestId(`kpi-${label}`);

describe("AdminDashboard — pipeline_breakdown", () => {
  it("renders stage tiles from the breakdown, not the legacy funnel", () => {
    mount();
    expect(within(tile("total")).getByText("605")).toBeTruthy();
    expect(within(tile("under_review")).getByText("76")).toBeTruthy();
    expect(within(tile("reviewed")).getByText("345")).toBeTruthy();
    expect(within(tile("gate1_rejected")).getByText("134")).toBeTruthy();
    expect(within(tile("gate1_selected")).getByText("48")).toBeTruthy();
    expect(screen.queryByText("603")).toBeNull();
  });

  it("splits 1st-gate selected into final rejected / selected / pending", () => {
    mount();
    const t = tile("gate1_selected");
    expect(within(t).getByText(/16 selected/)).toBeTruthy();
    expect(within(t).getByText(/20 rejected/)).toBeTruthy();
    expect(within(t).getByText(/10 pending/)).toBeTruthy();
  });

  it("sub-label uses final_selected and rejected_total", () => {
    mount();
    expect(within(tile("total")).getByText(/16 accepted · 154 rejected/)).toBeTruthy();
  });

  it("shows a reconciliation line that sums to the total", () => {
    mount();
    const line = screen.getByTestId("breakdown-reconcile").textContent;
    expect(line).toMatch(/= 605/);
    const parts = line.split("=")[0].split(" + ").map((seg) => parseInt(seg, 10));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(605);
  });

  it("funnel rows come from the breakdown stages", () => {
    mount();
    const funnel = screen.getByTestId("pipeline-funnel");
    expect(within(funnel).getByText("1ST-GATE SELECTED")).toBeTruthy();
    expect(within(funnel).getByText("FINAL SELECTED")).toBeTruthy();
    expect(within(funnel).queryByText("603")).toBeNull();
  });
});

describe("ADM-13 industry click pre-filters the Applications tab", () => {
  it("writes the Applications tab's sticky industry key and navigates", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { stickyKey } = await import("../../../../hooks/useStickyState.js");
    useAdminData.mockImplementation((resource) =>
      resource === "stats"
        ? { data: STATS, loading: false, error: null }
        : { data: { startups: [{ domain: "Healthcare" }, { domain: "—" }] }, loading: false, error: null });
    const go = vi.fn();
    render(<AdminDashboard go={go} />);
    fireEvent.click(screen.getAllByText("Healthcare")[0]);
    expect(go).toHaveBeenCalledWith("pipeline");
    expect(JSON.parse(sessionStorage.getItem(stickyKey("admin.pipeline.applications", "industry")))).toBe("Healthcare");
    expect(window.OS_FILTERS?.industry).toBeUndefined();
  });

  it("labels the industry scope as every stage", () => {
    useAdminData.mockImplementation((resource) =>
      resource === "stats"
        ? { data: STATS, loading: false, error: null }
        : { data: { startups: [{ domain: "Healthcare" }] }, loading: false, error: null });
    render(<AdminDashboard go={() => {}} />);
    expect(screen.getByText(/All 1 applications, every stage/i)).toBeTruthy();
  });
});
