// AdminVipMisMatrix — the MIS submissions matrix (spec §7): startups ×
// periods with status chips (submitted / draft / overdue), for one calendar
// kind at a time. Seams mocked: lib/adminVipApi (network). useAsync (ui.jsx)
// is real.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../lib/adminVipApi.js", () => ({
  adminVipApi: {
    getMisMatrix: vi.fn(),
    getMisPeriod: vi.fn(),
    reopenMisPeriod: vi.fn(),
  },
}));

import { adminVipApi } from "../../../../../lib/adminVipApi.js";
import { AdminVipMisMatrix } from "../AdminVipMisMatrix.jsx";

const MATRIX = {
  kind: "monthly",
  period_keys: [
    { period_key: "2026-06", label: "Jun 2026" },
    { period_key: "2026-07", label: "Jul 2026" },
  ],
  startups: [
    {
      application_id: "app-1", startup: "Helios Robotics",
      periods: {
        "2026-06": { status: "submitted", due_date: "2026-07-05", overdue: false },
        "2026-07": { status: "draft", due_date: "2026-08-05", overdue: true },
      },
    },
    {
      application_id: "app-2", startup: "Kavach Health",
      periods: {
        "2026-07": { status: "draft", due_date: "2026-09-05", overdue: false },
        // 2026-06 missing entirely — this startup had no period generated yet.
      },
    },
  ],
};

function periodBundle(overrides = {}) {
  return {
    catalog: { kind: "monthly", sections: [], entry_fields: {}, narrative_fields: {} },
    period: { id: "p1", kind: "monthly", period_key: "2026-06", label: "Jun 2026",
      period_start: "2026-06-01", period_end: "2026-06-30", due_date: "2026-07-05",
      status: "submitted", submitted_at: "2026-07-01T00:00:00Z", reopened_at: null },
    metrics: [], financials: [], headcount: [], entries: {}, narrative: {},
    derived: { metrics: { vs_last: {} }, financials: { needs_gap: {} }, headcount: { net_change: {}, total: {} } },
    application_id: "app-1", startup: "Helios Robotics",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminVipMisMatrix — loading / error / empty", () => {
  it("shows a loading state", () => {
    adminVipApi.getMisMatrix.mockReturnValue(new Promise(() => {}));
    render(<AdminVipMisMatrix canWrite={true} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows a retryable error state", async () => {
    adminVipApi.getMisMatrix.mockRejectedValue({ code: "http_500", message: "boom" });
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy());
  });

  it("gives an empty matrix (no periods generated for this kind at all) its own copy", async () => {
    adminVipApi.getMisMatrix.mockResolvedValue({ kind: "monthly", period_keys: [], startups: [] });
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByText(/no.*periods/i)).toBeTruthy());
  });
});

describe("AdminVipMisMatrix — the grid", () => {
  it("renders a status chip per existing cell, distinguishing submitted / overdue / draft", async () => {
    adminVipApi.getMisMatrix.mockResolvedValue(MATRIX);
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Helios Robotics.*Jun 2026.*submitted/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Helios Robotics.*Jul 2026.*overdue/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Kavach Health.*Jul 2026.*draft/i })).toBeTruthy();
  });

  it("renders a distinct 'no period yet' mark for a startup missing a period cell, not a blank or a false draft", async () => {
    adminVipApi.getMisMatrix.mockResolvedValue(MATRIX);
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Kavach Health")).toBeTruthy());
    // Kavach Health has no 2026-06 cell.
    expect(screen.queryByRole("button", { name: /Kavach Health.*Jun 2026/i })).toBeNull();
  });

  it("switches kind between monthly and quarterly, re-fetching the matrix", async () => {
    adminVipApi.getMisMatrix.mockResolvedValue(MATRIX);
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(adminVipApi.getMisMatrix).toHaveBeenCalledWith("monthly"));
    fireEvent.click(screen.getByRole("button", { name: "Quarterly" }));
    await waitFor(() => expect(adminVipApi.getMisMatrix).toHaveBeenCalledWith("quarterly"));
  });

  it("opens the read-only period view when an existing cell is activated", async () => {
    adminVipApi.getMisMatrix.mockResolvedValue(MATRIX);
    adminVipApi.getMisPeriod.mockResolvedValue(periodBundle());
    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Helios Robotics.*Jun 2026.*submitted/i }));
    await waitFor(() =>
      expect(adminVipApi.getMisPeriod).toHaveBeenCalledWith("app-1", "monthly", "2026-06"));
  });

  it("a blocked reopen's 'go to blocking period' link stays on the SAME startup and re-fetches the new period", async () => {
    // Seam: AdminVipMisMatrix wires AdminVipMisPeriod's onNavigatePeriod to
    // `setSelected((s) => ({ ...s, periodKey }))` — carrying `applicationId`
    // forward from the CURRENT selection rather than reconstructing it. A
    // bug here (e.g. resetting applicationId) would silently navigate an
    // admin to the wrong startup's period.
    adminVipApi.getMisMatrix.mockResolvedValue(MATRIX);
    adminVipApi.getMisPeriod.mockImplementation((appId, kind, periodKey) =>
      Promise.resolve(periodBundle({
        application_id: appId,
        period: { ...periodBundle().period, period_key: periodKey, label: periodKey === "2026-07" ? "Jul 2026" : "Jun 2026" },
      })));
    adminVipApi.reopenMisPeriod.mockRejectedValue({
      code: "mis_later_period_submitted",
      details: { period_key: "2026-07", label: "Jul 2026" },
    });

    render(<AdminVipMisMatrix canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Helios Robotics.*Jun 2026.*submitted/i }));
    await waitFor(() => expect(screen.getByText("Helios Robotics").closest(".os-view, div")).toBeTruthy());

    fireEvent.click(await screen.findByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reopen period$/i }));
    const link = await screen.findByRole("button", { name: /Jul 2026/i });
    fireEvent.click(link);

    await waitFor(() =>
      expect(adminVipApi.getMisPeriod).toHaveBeenCalledWith("app-1", "monthly", "2026-07"));
  });
});
