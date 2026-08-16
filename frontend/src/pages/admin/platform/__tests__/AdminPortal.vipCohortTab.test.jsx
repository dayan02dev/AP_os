// The "VIP cohort" tab registration in the admin portal shell (spec §7 /
// D4). AdminTabBar is a pure presentational component (props in, no data
// hooks of its own), so this needs no mocking beyond what the component
// itself touches — unlike AdminTabBar.test.jsx, which also renders
// AdminPipeline and therefore mocks useAdminData; this file only covers the
// new tab entry, so it stays lighter and does not need to touch that
// existing shared test file.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminTabBar } from "../AdminPortal";

const base = {
  page: "dashboard", setPage: vi.fn(), appsBadge: null,
  rejectedBadge: null, reviewBadge: null, jurySelectedBadge: null,
};

describe("AdminTabBar — VIP cohort tab", () => {
  it("renders in reviewer mode", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    expect(screen.getByText("VIP cohort")).toBeTruthy();
  });

  it("renders in jury mode too — verification is independent of decision mode", () => {
    render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(screen.getByText("VIP cohort")).toBeTruthy();
  });

  it("selects the tab by its id", () => {
    const setPage = vi.fn();
    render(<AdminTabBar {...base} setPage={setPage} decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("VIP cohort"));
    expect(setPage).toHaveBeenCalledWith("vip_cohort");
  });

  it("carries no badge (there is no meaningful count to show here)", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    const tab = screen.getByText("VIP cohort").closest(".lp-tab");
    expect(tab.querySelector(".lp-tab-badge")).toBeNull();
  });
});
