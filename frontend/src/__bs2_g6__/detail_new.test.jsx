// SWARM2 admin_gate — NEW AdminDetail repros @ 837ccf0 (real adaptDetail, mocked HTTP).
// Each test asserts the CORRECT behaviour, so it FAILS on the bug.
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
import { ApiError } from "../lib/api.js";

const detail = (over = {}) => ({
  id: "a1", track: "tir", native_track: "tir", display_id: "TIR-1", project_name: "Alpha",
  founder: { name: "F" }, industry: { label: "AI" }, stage: "Idea",
  application: { status: "evaluated", submitted_at: "2026-05-01T00:00:00Z" },
  ai_screening: null, reviews: [], reviewer_score: null, reviewer_weights: {},
  reviewer_assignments: [], status_history: [], decision: null, meta: null, batch: null, batches: [],
  admin_decisions: [],
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe("AdminDetail state leaks onto the next application", () => {
  it("after Reject + auto-advance, the next app does not show 'Decision recorded: rejected.'", async () => {
    adminPlatformApi.getApplication.mockImplementation((t, id) => Promise.resolve(
      id === "a1" ? detail() : detail({ id: "a2", project_name: "Beta" })));
    adminPlatformApi.decide.mockResolvedValue({});
    let rerenderFn;
    const onDecision = vi.fn(() => {
      rerenderFn(<AdminDetail startupId="a2" track="tir" onBack={() => {}} onDecision={onDecision} />);
    });
    const r = render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} onDecision={onDecision} />);
    rerenderFn = r.rerender;
    await screen.findAllByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByPlaceholderText(/Rationale/), { target: { value: "weak team" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply decision" })); });
    expect(adminPlatformApi.decide).toHaveBeenCalledWith("tir", "a1", expect.objectContaining({ decision: "rejected" }));
    await screen.findAllByText("Beta");
    // BUG: `banner` is never reset by doLoad — Beta (undecided) is shown with
    // "Decision recorded: rejected." right under its header.
    expect(screen.queryByText(/Decision recorded/)).toBeNull();
  });

  it("an illegal-transition error on one app is not shown on the next app after Next", async () => {
    adminPlatformApi.getApplication.mockImplementation((t, id) => Promise.resolve(
      id === "a1" ? detail() : detail({ id: "a2", project_name: "Beta" })));
    adminPlatformApi.decide.mockRejectedValue(new ApiError({ status: 422, code: "illegal_transition",
      message: "Request failed", details: { code: "illegal_transition", allowed: ["withdrawn"] } }));
    const r = render(<AdminDetail startupId="a1" track="tir" onBack={() => {}} />);
    await screen.findAllByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply decision" })); });
    await screen.findByRole("alert");
    r.rerender(<AdminDetail startupId="a2" track="tir" onBack={() => {}} />);
    await screen.findAllByText("Beta");
    // BUG: decisionError is never cleared on load → Beta shows Alpha's error.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
