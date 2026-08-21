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
  rejectedBadge: null, reviewBadge: null, jurySelectedBadge: null };

describe("AdminTabBar — single mode", () => {
  it("renders the seven tabs in order", () => {
    render(<AdminTabBar {...base} />);
    const labels = screen
      .getAllByText(/^(Dashboard|Reviewers|Applications|Rejected|Accepted|Admin Review|Final Gate)$/)
      .map((n) => n.textContent);
    expect(labels).toEqual([
      "Dashboard", "Reviewers", "Applications", "Rejected",
      "Accepted", "Admin Review", "Final Gate",
    ]);
  });

  it("no longer offers the jury-mode surfaces", () => {
    render(<AdminTabBar {...base} />);
    expect(screen.queryByText("Academic Jury Roster")).toBeNull();
    expect(screen.queryByText("Jury Decision")).toBeNull();
  });
});

describe("AdminTabBar — the merged Accepted tab", () => {
  it("shows ONE tab for both tracks, not a tab each", () => {
    render(<AdminTabBar {...base} />);
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.queryByText("TIR Selected")).toBeNull();
    expect(screen.queryByText("VIP Selected")).toBeNull();
  });

  it("keeps the single tab in reviewer mode too", () => {
    render(<AdminTabBar {...base} />);
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.queryByText("TIR Selected")).toBeNull();
  });

  it("labels the sub-line for both tracks", () => {
    const { container } = render(<AdminTabBar {...base} />);
    const subs = [...container.querySelectorAll(".lp-tab-sub")].map(n => n.textContent);
    expect(subs).toContain("TIR + VIP");
    expect(subs).not.toContain("SELECTED · TIR");
    expect(subs).not.toContain("SELECTED · VIP");
  });

  it("badges the combined count", () => {
    render(<AdminTabBar {...base} jurySelectedBadge={16} />);
    expect(screen.getByText("16")).toBeTruthy();
  });

  it("shows no badge at all when the count is null", () => {
    const { container } = render(<AdminTabBar {...base} />);
    expect(container.querySelectorAll(".lp-tab-badge").length).toBe(0);
  });

  it("selects the merged tab by its id", () => {
    const setPage = vi.fn();
    render(<AdminTabBar {...base} setPage={setPage} />);
    screen.getByText("Accepted").click();
    expect(setPage).toHaveBeenCalledWith("jury_selected");
  });
});

// The TIR Selected tab is AdminPipeline with lockTrack="tir". The scoping must use
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
