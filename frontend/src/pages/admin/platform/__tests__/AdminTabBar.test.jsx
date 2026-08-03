import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminTabBar } from "../AdminPortal";
import { AdminPipeline } from "../screens/AdminPipeline";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "pipeline") {
      return {
        data: {
          startups: [
            // effective tir, natively tir
            { id: "a1", track: "tir", nativeTrack: "tir", name: "Native TIR",
              chip: "JURY REVIEW", domain: "AI", ai: {}, batches: [] },
            // effective sip after a TIR→VIP move
            { id: "a2", track: "sip", nativeTrack: "tir", movedToTrack: "sip",
              name: "Moved To VIP", chip: "JURY REVIEW", domain: "AI", ai: {}, batches: [] },
            // effective tir after a VIP→TIR move
            { id: "a3", track: "tir", nativeTrack: "sip", movedToTrack: "tir",
              name: "Moved To TIR", chip: "JURY REVIEW", domain: "AI", ai: {}, batches: [] },
          ],
          total: 3,
        },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    return { data: { batches: [] }, loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

const base = { page: "dashboard", setPage: vi.fn(), appsBadge: null,
  rejectedBadge: null, reviewBadge: null, juryTirBadge: null, juryVipBadge: null };

describe("AdminTabBar — jury vs reviewer tabs", () => {
  it("jury mode hides Applications + Rejected and shows Academic Jury Roster after Dashboard", () => {
    render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(screen.getByText("Academic Jury Roster")).toBeTruthy();
    expect(screen.queryByText("Applications")).toBeNull();
    expect(screen.queryByText("Rejected Applications")).toBeNull();
    const labels = screen.getAllByText(
      /Dashboard|Academic Jury Roster|Jury|TIR Selected|VIP Selected|Final Gate/)
      .map(n => n.textContent);
    expect(labels[0]).toBe("Dashboard");
    expect(labels[1]).toBe("Academic Jury Roster");
  });
  it("reviewer mode keeps Applications + Rejected and has no academic roster", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    expect(screen.getByText("Applications")).toBeTruthy();
    expect(screen.getByText("Rejected Applications")).toBeTruthy();
    expect(screen.queryByText("Academic Jury Roster")).toBeNull();
  });
});

describe("AdminTabBar — jury selected split per track", () => {
  it("shows TIR Selected and VIP Selected side by side, not a combined tab", () => {
    render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(screen.getByText("TIR Selected")).toBeTruthy();
    expect(screen.getByText("VIP Selected")).toBeTruthy();
    expect(screen.queryByText("Jury Selected")).toBeNull();
  });

  it("keeps the split in reviewer mode too", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    expect(screen.getByText("TIR Selected")).toBeTruthy();
    expect(screen.getByText("VIP Selected")).toBeTruthy();
  });

  it("renders each track's badge independently", () => {
    render(<AdminTabBar {...base} decisionMode="jury" juryTirBadge={11} juryVipBadge={5} />);
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("shows no badge at all when a count is null", () => {
    const { container } = render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(container.querySelectorAll(".lp-tab-badge").length).toBe(0);
  });

  it("selects the clicked jury tab by id", () => {
    const setPage = vi.fn();
    render(<AdminTabBar {...base} setPage={setPage} decisionMode="jury" />);
    screen.getByText("VIP Selected").click();
    expect(setPage).toHaveBeenCalledWith("jury_vip");
  });
});

// The Jury TIR tab is AdminPipeline with lockTrack="tir". The scoping must use
// the EFFECTIVE track so moved apps land in exactly one of the two tabs.
describe("AdminPipeline lockTrack — effective-track scoping", () => {
  it("keeps effective-TIR rows, including one moved VIP→TIR", () => {
    render(<AdminPipeline lockTrack="tir" readOnly heading="TIR selected applications" />);
    expect(screen.getByText("Native TIR")).toBeTruthy();
    expect(screen.getByText("Moved To TIR")).toBeTruthy();
  });

  it("drops a TIR app that was moved to VIP", () => {
    render(<AdminPipeline lockTrack="tir" readOnly />);
    expect(screen.queryByText("Moved To VIP")).toBeNull();
  });

  it("hides the track switcher when the track is locked", () => {
    const { container } = render(<AdminPipeline lockTrack="tir" readOnly />);
    expect(container.querySelector(".lp-track-group")).toBeNull();
    expect(screen.queryByText("All tracks")).toBeNull();
  });

  it("still offers the switcher when no track is locked", () => {
    const { container } = render(<AdminPipeline readOnly />);
    expect(container.querySelector(".lp-track-group")).toBeTruthy();
  });
});
