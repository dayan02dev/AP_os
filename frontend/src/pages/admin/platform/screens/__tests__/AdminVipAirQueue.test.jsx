// AdminVipAirQueue — the AIR verification queue (spec §7): rows of
// (startup, lever, claimed level, submitted). Seams mocked: lib/adminVipApi
// (network). useAsync (ui.jsx) is real.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../lib/adminVipApi.js", () => ({
  adminVipApi: {
    getAirQueue: vi.fn(),
    getAirAssessment: vi.fn(),
    verifyLever: vi.fn(),
    confirmAllLevers: vi.fn(),
  },
}));

import { adminVipApi } from "../../../../../lib/adminVipApi.js";
import { AdminVipAirQueue } from "../AdminVipAirQueue.jsx";

const ROW_A = {
  assessment_id: "asm-1", application_id: "app-1", startup: "Helios Robotics",
  round_label: "FY26-27-Q1", lever: "scientific_principles",
  lever_name: "Scientific Principles & Models", family: "technology",
  claimed_level: 3, submitted_at: "2026-08-10T09:00:00Z",
};
const ROW_B = {
  assessment_id: "asm-1", application_id: "app-1", startup: "Helios Robotics",
  round_label: "FY26-27-Q1", lever: "architecture",
  lever_name: "Architecture & System Definition", family: "technology",
  claimed_level: 4, submitted_at: "2026-08-10T09:00:00Z",
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminVipAirQueue — loading / error / empty", () => {
  it("shows a loading state before data resolves", () => {
    const d = deferred();
    adminVipApi.getAirQueue.mockReturnValue(d.promise);
    render(<AdminVipAirQueue canWrite={true} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows a retryable error state on failure, not a blank screen", async () => {
    adminVipApi.getAirQueue.mockRejectedValue({ code: "http_500", message: "boom" });
    render(<AdminVipAirQueue canWrite={true} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy());
  });

  it("gives the empty queue its own honest copy — not a fabricated 'nothing submitted' claim", async () => {
    adminVipApi.getAirQueue.mockResolvedValue({ rows: [] });
    render(<AdminVipAirQueue canWrite={true} />);
    await waitFor(() => expect(screen.getByText(/nothing.*waiting.*verification/i)).toBeTruthy());
  });
});

describe("AdminVipAirQueue — rows", () => {
  it("renders one row per (startup, lever, claimed level, submitted)", async () => {
    adminVipApi.getAirQueue.mockResolvedValue({ rows: [ROW_A, ROW_B] });
    render(<AdminVipAirQueue canWrite={true} />);
    await waitFor(() => expect(screen.getAllByText("Helios Robotics").length).toBeGreaterThan(0));
    expect(screen.getByText("Scientific Principles & Models")).toBeTruthy();
    expect(screen.getByText("Architecture & System Definition")).toBeTruthy();
    expect(screen.getByText("AIR 3")).toBeTruthy();
    expect(screen.getByText("AIR 4")).toBeTruthy();
  });

  it("opens the assessment detail when a row is activated", async () => {
    adminVipApi.getAirQueue.mockResolvedValue({ rows: [ROW_A] });
    adminVipApi.getAirAssessment.mockResolvedValue({
      catalog: { levers: [], questions: {}, criteria: {}, documents: {} },
      round: { id: "asm-1", round_label: "FY26-27-Q1", status: "submitted", submitted_at: null, verified_at: null, verified_by: null },
      levers: [], rollups: { claimed: {}, verified: {} },
      application_id: "app-1", startup: "Helios Robotics",
    });
    render(<AdminVipAirQueue canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByText("Scientific Principles & Models"));
    await waitFor(() => expect(adminVipApi.getAirAssessment).toHaveBeenCalledWith("asm-1"));
  });
});
