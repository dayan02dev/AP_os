// AdminVipCohort — the "VIP cohort" admin tab root (spec §7 / D4): a
// sub-nav switching between the two screens, and the read/write capability
// gate (view_all_apps for reads, already required to reach the admin shell;
// manage_vip_cohort for writes — passed down as `canWrite` so each screen
// disables its own write controls rather than duplicating the check).
//
// Seams mocked: hooks/useAuth (session identity/roles) and the two child
// screens themselves (each has its own full test file; this file only
// covers wiring — which tab renders, and that the capability gate reaches
// both children).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../../hooks/useAuth.jsx", () => ({ useAuth: vi.fn() }));

vi.mock("../AdminVipAirQueue.jsx", () => ({
  AdminVipAirQueue: (props) => <div data-testid="air-queue" data-canwrite={String(!!props.canWrite)} />,
}));
vi.mock("../AdminVipMisCharts.jsx", () => ({
  AdminVipMisCharts: (props) => <div data-testid="mis-charts" data-canwrite={String(!!props.canWrite)} />,
}));

import { useAuth } from "../../../../../hooks/useAuth.jsx";
import { AdminVipCohort } from "../AdminVipCohort.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { roles: ["admin"] } });
});

describe("AdminVipCohort — sub-nav", () => {
  it("defaults to the AIR verification queue", () => {
    render(<AdminVipCohort />);
    expect(screen.getByTestId("air-queue")).toBeTruthy();
    expect(screen.queryByTestId("mis-charts")).toBeNull();
  });

  it("switches to MIS submissions and back", () => {
    render(<AdminVipCohort />);
    fireEvent.click(screen.getByRole("tab", { name: /mis submissions/i }));
    expect(screen.getByTestId("mis-charts")).toBeTruthy();
    expect(screen.queryByTestId("air-queue")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /air verification/i }));
    expect(screen.getByTestId("air-queue")).toBeTruthy();
  });
});

describe("AdminVipCohort — capability gate", () => {
  it("passes canWrite=true for a role with manage_vip_cohort (admin)", () => {
    useAuth.mockReturnValue({ user: { roles: ["admin"] } });
    render(<AdminVipCohort />);
    expect(screen.getByTestId("air-queue").dataset.canwrite).toBe("true");
  });

  it("passes canWrite=true for leadership too", () => {
    useAuth.mockReturnValue({ user: { roles: ["leadership"] } });
    render(<AdminVipCohort />);
    expect(screen.getByTestId("air-queue").dataset.canwrite).toBe("true");
  });

  it("passes canWrite=false for a role without manage_vip_cohort", () => {
    useAuth.mockReturnValue({ user: { roles: ["reviewer"] } });
    render(<AdminVipCohort />);
    expect(screen.getByTestId("air-queue").dataset.canwrite).toBe("false");
  });

  it("carries the same gate into the MIS screen", () => {
    useAuth.mockReturnValue({ user: { roles: ["reviewer"] } });
    render(<AdminVipCohort />);
    fireEvent.click(screen.getByRole("tab", { name: /mis submissions/i }));
    expect(screen.getByTestId("mis-charts").dataset.canwrite).toBe("false");
  });

  it("does not crash before the user resolves (canWrite=false while loading)", () => {
    useAuth.mockReturnValue({ user: null });
    render(<AdminVipCohort />);
    expect(screen.getByTestId("air-queue").dataset.canwrite).toBe("false");
  });
});
