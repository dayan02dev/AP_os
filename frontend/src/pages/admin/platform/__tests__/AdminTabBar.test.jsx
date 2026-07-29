import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminTabBar } from "../AdminPortal";

const base = { page: "dashboard", setPage: vi.fn(), appsBadge: null,
  rejectedBadge: null, reviewBadge: null, juryBadge: null };

describe("AdminTabBar — jury vs reviewer tabs", () => {
  it("jury mode hides Applications + Rejected and shows IISc Jury Roster after Dashboard", () => {
    render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(screen.getByText("IISc Jury Roster")).toBeTruthy();
    expect(screen.queryByText("Applications")).toBeNull();
    expect(screen.queryByText("Rejected Applications")).toBeNull();
    const labels = screen.getAllByText(
      /Dashboard|IISc Jury Roster|Jury|Jury Selected|Final Gate/).map(n => n.textContent);
    expect(labels[0]).toBe("Dashboard");
    expect(labels[1]).toBe("IISc Jury Roster");
  });
  it("reviewer mode keeps Applications + Rejected and has no IISc roster", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    expect(screen.getByText("Applications")).toBeTruthy();
    expect(screen.getByText("Rejected Applications")).toBeTruthy();
    expect(screen.queryByText("IISc Jury Roster")).toBeNull();
  });
});
