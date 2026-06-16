// AdminAudit smoke test — mounts screens/AdminAudit with a mocked useAdminData
// hook and verifies entry rows render from live audit data.

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock useAdminData before importing the component under test.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

// Mock adminPlatformApi (CSV download path).
vi.mock("../../../../lib/adminPlatformApi.js", () => ({
  adminPlatformApi: {
    getAuditLog: vi.fn(),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { AdminAudit } from "../screens/AdminAudit";

const SAMPLE_ENTRIES = [
  {
    ts: "2026-04-21 10:46:11",
    actor: "admin@artpark.in",
    action: "GATE_1_DECIDE",
    target: "Karkhana Robotics",
    detail: "approved → Layer 5",
  },
  {
    ts: "2026-04-21 10:14:22",
    actor: "system.ai",
    action: "AI_SCORE",
    target: "Pravaha Water",
    detail: "7.0 · 83% conf",
  },
];

describe("AdminAudit screen (screens/)", () => {
  it("renders an entry row with action pill and actor", () => {
    useAdminData.mockReturnValue({
      data: { entries: SAMPLE_ENTRIES },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminAudit />);

    // Action pill text appears
    expect(screen.getByText("GATE_1_DECIDE")).toBeTruthy();
    // Actor text appears
    expect(screen.getByText("admin@artpark.in")).toBeTruthy();
  });

  it("renders both entry rows when given two entries", () => {
    useAdminData.mockReturnValue({
      data: { entries: SAMPLE_ENTRIES },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminAudit />);

    expect(screen.getByText("AI_SCORE")).toBeTruthy();
    expect(screen.getByText("system.ai")).toBeTruthy();
  });

  it("renders the Timestamp header in the audit row header", () => {
    useAdminData.mockReturnValue({
      data: { entries: SAMPLE_ENTRIES },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminAudit />);
    expect(screen.getByText(/Timestamp/i)).toBeTruthy();
    // "Actor" appears in both the filter bar label and the column header
    expect(screen.getAllByText(/Actor/i).length).toBeGreaterThan(0);
  });

  it("shows loading state while fetching", () => {
    useAdminData.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminAudit />);
    expect(screen.getByText(/Loading audit log/i)).toBeTruthy();
  });

  it("shows empty state when no entries match filters", () => {
    useAdminData.mockReturnValue({
      data: { entries: [] },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<AdminAudit />);
    expect(screen.getByText(/No audit entries match these filters/i)).toBeTruthy();
  });

  it("shows error state on API failure", () => {
    useAdminData.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("net"),
      reload: vi.fn(),
    });
    render(<AdminAudit />);
    // ErrorState renders "Couldn’t load this data." (right-single-quote)
    expect(screen.getByText(/load this data/i)).toBeTruthy();
  });
});
