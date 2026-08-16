// AdminVipMisPeriod — one MIS period, read-only (spec §7: "opening one
// renders it read-only"), plus Reopen. Covers the 409
// mis_later_period_submitted conflict surfaced as a link to the blocking
// period (not a generic error), and the distinct empty states: a period
// with no data filled in yet vs. a period that simply has no entries in a
// given section. Seams mocked: lib/adminVipApi (network). useAsync (ui.jsx)
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
import { AdminVipMisPeriod } from "../AdminVipMisPeriod.jsx";

const CATALOG = {
  kind: "monthly",
  sections: [
    { id: "exec_summary", number: 1, title: "Executive Summary", hint: null, type: "narrative" },
    { id: "milestones", number: 3, title: "Milestones", hint: null, type: "entries" },
    { id: "key_metrics", number: 2, title: "Key Metrics", hint: null, type: "metrics" },
  ],
  entry_fields: {
    milestones: [
      { key: "milestone", label: "Milestone", type: "text" },
      { key: "status", label: "Status", type: "choice", options: ["Done", "On Track"] },
    ],
  },
  narrative_fields: {
    exec_summary: [
      { id: "exec.headline_win", prompt: "Headline win" },
      { id: "exec.biggest_concern", prompt: "Biggest concern" },
    ],
  },
  metrics: [
    { key: "revenue_month", label: "Revenue this month (₹ Lakh)", group: "commercial", unit: "₹L", computed: false },
  ],
  metric_groups: [{ key: "commercial", label: "Commercial" }],
};

function bundle(overrides = {}) {
  return {
    catalog: CATALOG,
    period: {
      id: "p1", kind: "monthly", period_key: "2026-06", label: "Jun 2026",
      period_start: "2026-06-01", period_end: "2026-06-30", due_date: "2026-07-05",
      status: "submitted", submitted_at: "2026-07-01T00:00:00Z", reopened_at: null,
    },
    metrics: [{ metric_key: "revenue_month", label: "Revenue this month (₹ Lakh)", group_key: "commercial",
      unit: "₹L", target: 10, actual: 12, prev_actual: 8, rag: "green", commentary: "Ahead of plan" }],
    financials: [], headcount: [],
    entries: { milestones: [{ id: "m1", section: "milestones", sort_order: 0,
      data: { milestone: "Ship v1", status: "Done" } }] },
    narrative: { "exec.headline_win": "Signed 2 pilots" }, // exec.biggest_concern intentionally blank
    derived: { metrics: { vs_last: { revenue_month: 4 } }, financials: { needs_gap: {} }, headcount: { net_change: {}, total: {} } },
    application_id: "app-1", startup: "Helios Robotics",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminVipMisPeriod — loading / error", () => {
  it("shows a loading state", () => {
    adminVipApi.getMisPeriod.mockReturnValue(new Promise(() => {}));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("maps not_found to real copy", async () => {
    adminVipApi.getMisPeriod.mockRejectedValue({ code: "not_found", details: {} });
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/could not be found/i)).toBeTruthy());
  });
});

describe("AdminVipMisPeriod — read-only render", () => {
  it("renders narrative answers, filled and blank distinctly", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Signed 2 pilots")).toBeTruthy());
    expect(screen.getByText(/not filled in/i)).toBeTruthy();
  });

  it("renders the entries table with real rows", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Ship v1")).toBeTruthy());
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("gives a section with zero entries its own 'no entries yet' copy, distinct from a blank narrative prompt", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle({ entries: { milestones: [] } }));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no entries/i)).toBeTruthy());
  });

  it("renders the metrics grid with target / actual / vs last", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Revenue this month (₹ Lakh)")).toBeTruthy());
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Ahead of plan")).toBeTruthy();
  });

  it("has no editable form controls anywhere — it is read-only", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    const { container } = render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Ship v1")).toBeTruthy());
    expect(container.querySelectorAll("input, textarea").length).toBe(0);
  });
});

describe("AdminVipMisPeriod — reopen", () => {
  it("offers Reopen only for a submitted period", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle({ period: { ...bundle().period, status: "draft" } }));
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("hides Reopen when canWrite is false", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={false} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("reopens a submitted period and reports the result", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    adminVipApi.reopenMisPeriod.mockResolvedValue(bundle({ period: { ...bundle().period, status: "draft" } }));
    const onChanged = vi.fn();
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={onChanged} onNavigatePeriod={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reopen period$/i }));
    await waitFor(() => expect(adminVipApi.reopenMisPeriod).toHaveBeenCalledWith("app-1", "monthly", "2026-06"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("surfaces mis_later_period_submitted as a link to the blocking period, not a generic error", async () => {
    adminVipApi.getMisPeriod.mockResolvedValue(bundle());
    adminVipApi.reopenMisPeriod.mockRejectedValue({
      code: "mis_later_period_submitted",
      details: { period_key: "2026-07", label: "Jul 2026" },
    });
    const onNavigatePeriod = vi.fn();
    render(<AdminVipMisPeriod applicationId="app-1" kind="monthly" periodKey="2026-06" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} onNavigatePeriod={onNavigatePeriod} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reopen period$/i }));

    const link = await screen.findByRole("button", { name: /Jul 2026/i });
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(onNavigatePeriod).toHaveBeenCalledWith("2026-07");
  });
});
