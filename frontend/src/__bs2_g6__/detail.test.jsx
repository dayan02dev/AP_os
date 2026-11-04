// SWARM admin_pipeline — AdminDetail repros (real adaptDetail, mocked HTTP).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(), getApplication: vi.fn(), getReviewers: vi.fn(() => Promise.resolve({ reviewers: [] })),
    moveTrack: vi.fn(), getVipMemoV2: vi.fn(() => Promise.reject(Object.assign(new Error("nf"), { status: 404 }))),
  },
}));
vi.mock("../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) } }));
vi.mock("../components/FullApplication", () => ({
  default: ({ track }) => <div data-testid="fullapp">FULLAPP track={track}</div>,
}));
vi.mock("../pages/admin/platform/screens/ApplicationSummaryCard", () => ({
  default: ({ onViewFullApplication }) => <button onClick={onViewFullApplication}>View full application</button>,
}));
vi.mock("../pages/admin/platform/screens/ComparativeReviewModel", () => ({ ComparativeReviewModel: () => null }));

import { AdminDetail } from "../pages/admin/platform/screens/AdminDetail.jsx";
import { adminPlatformApi } from "../lib/adminPlatformApi";

const detail = (over = {}) => ({
  id: "a1", track: "tir", native_track: "tir", display_id: "TIR-1", project_name: "Alpha",
  founder: { name: "F" }, industry: { label: "AI" }, stage: "Idea",
  application: { status: "evaluated", submitted_at: "2026-05-01T00:00:00Z" },
  ai_screening: null, reviews: [], reviewer_score: null, reviewer_weights: {},
  reviewer_assignments: [], status_history: [], decision: null, meta: null, batch: null, batches: [],
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe("AdminDetail load error", () => {
  it("Retry after a transient failure shows the application (error is cleared)", async () => {
    adminPlatformApi.getApplication
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValue(detail());
    render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
    await screen.findByText(/Failed to load application/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(adminPlatformApi.getApplication).toHaveBeenCalledTimes(2));
    // BUG: setError(null) is never called → still the error banner.
    expect(screen.queryByText(/Failed to load application/)).toBeNull();
  });

  it("after one failed load, Next to another app still shows the stale error", async () => {
    adminPlatformApi.getApplication
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValue(detail({ id: "a2", project_name: "Beta" }));
    const { rerender } = render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
    await screen.findByText(/Failed to load application/);
    rerender(<AdminDetail startupId="a2" track="tir" onBack={() => {}} />);
    await waitFor(() => expect(adminPlatformApi.getApplication).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Failed to load application/)).toBeNull();
  });
});

describe("AdminDetail FullApplication schema track", () => {
  it("a TIR application moved to VIP renders FullApplication with its NATIVE (tir) schema", async () => {
    adminPlatformApi.getApplication.mockResolvedValue(detail({
      track: "sip", native_track: "tir", moved_to_track: "sip",
      application: { status: "evaluated", moved_to_track: "sip", submitted_at: "2026-05-01T00:00:00Z" },
    }));
    // list row passes the EFFECTIVE track ("sip")
    render(<AdminDetail startupId="a1" track="sip" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "View full application" }));
    const fa = await screen.findByTestId("fullapp");
    // BUG: renders the TIR answers with the VIP/SIP schema
    expect(fa.textContent).toContain("track=tir");
  });
});

describe("AdminDetail prefilled hidden decision", () => {
  it("an on_hold app opens with decision='hold' preselected though no Hold button exists; Apply sends on_hold→on_hold", async () => {
    adminPlatformApi.getApplication.mockResolvedValue(detail({
      application: { status: "on_hold", submitted_at: "2026-05-01T00:00:00Z" },
      decision: { decision: "on_hold", rationale: "wait for docs", gate_stage: "gate1" },
    }));
    adminPlatformApi.decide.mockResolvedValue({});
    render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} onDecision={() => {}} />);
    const apply = await screen.findByRole("button", { name: "Apply decision" });
    // No Hold button exists, so nothing is preselected and Apply stays disabled.
    expect(apply.disabled).toBe(true);
    expect(adminPlatformApi.decide).not.toHaveBeenCalled();
  });

  it("a WAITLISTED app gets the Approve button although waitlisted→jury_review is illegal", async () => {
    adminPlatformApi.getApplication.mockResolvedValue(detail({
      application: { status: "waitlisted", submitted_at: "2026-05-01T00:00:00Z" },
    }));
    render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
    expect(await screen.findByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("AdminDetail stale response race", () => {
  it("fast Next: a slow response for the previous app overwrites the current one", async () => {
    let resolveFirst;
    adminPlatformApi.getApplication
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => Promise.resolve(detail({ id: "a2", project_name: "Beta" })));
    const { rerender } = render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
    rerender(<AdminDetail startupId="a2" track="tir" onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Beta").length).toBeGreaterThan(0));
    await act(async () => { resolveFirst(detail({ id: "a1", project_name: "Alpha" })); });
    // BUG: startupId is a2 but the page now shows Alpha (a1).
    expect(screen.queryAllByText("Alpha").length).toBe(0);
  });
});
