// Reviewer portal round-2 fixes (2026-10-05): eval autosave only after a real
// edit (StrictMode-safe), human decision label + display ID on the eval page,
// queue counts follow the visible (closed-hidden) set, Clear resets Show closed.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const contentMock = vi.fn();
const submitReview = vi.fn();
const patchReview = vi.fn();
vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    getContent: (...a) => contentMock(...a),
    getQueue: () => Promise.resolve([]),
    getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
    submitReview: (...a) => submitReview(...a),
    patchReview: (...a) => patchReview(...a),
  },
}));

import ReviewerEval from "../ReviewerEval.jsx";
import ReviewerQueue from "../ReviewerQueue.jsx";

const content = (over = {}) => ({
  id: "app1", applicationId: "TIR-27061", track: "tir", moved_to_track: null,
  name: "Acme", aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});

const draftRow = {
  id: "rv1", submitted_at: null, recommendation: "maybe",
  score_problem: 6, score_solution: 6, score_tech: 6, score_founders: 6,
  score_commitment: 6, quick_notes: "draft notes",
};

// Flush the content promise, then run past the 800 ms autosave debounce.
async function settle() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(2000); });
  await act(async () => { await Promise.resolve(); });
}

describe("ReviewerEval autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitReview.mockReset().mockResolvedValue({ review: { id: "new1" } });
    patchReview.mockReset().mockResolvedValue({});
    contentMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not save on mount for a not-started app (StrictMode)", async () => {
    contentMock.mockResolvedValue(content());
    render(<React.StrictMode><ReviewerEval track="tir" appId="app1" onBack={vi.fn()} /></React.StrictMode>);
    await screen.findByText(/Your scores/);
    await settle();
    expect(submitReview).not.toHaveBeenCalled();
    expect(patchReview).not.toHaveBeenCalled();
  });

  it("does not save on mount for an existing draft (StrictMode)", async () => {
    contentMock.mockResolvedValue(content({ evaluation: draftRow }));
    render(<React.StrictMode><ReviewerEval track="tir" appId="app1" onBack={vi.fn()} /></React.StrictMode>);
    await screen.findByText(/Your scores/);
    await settle();
    expect(submitReview).not.toHaveBeenCalled();
    expect(patchReview).not.toHaveBeenCalled();
  });

  it("a slider change triggers exactly one debounced save", async () => {
    contentMock.mockResolvedValue(content({ evaluation: draftRow }));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      { left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10, x: 0, y: 0 });
    const { container } = render(
      <React.StrictMode><ReviewerEval track="tir" appId="app1" onBack={vi.fn()} /></React.StrictMode>);
    await screen.findByText(/Your scores/);
    await settle();
    const track = container.querySelector(".os-slider-track");
    fireEvent.mouseDown(track, { clientX: 80 });
    fireEvent.mouseUp(window);
    await settle();
    expect(patchReview).toHaveBeenCalledTimes(1);
    expect(patchReview.mock.calls[0][0]).toBe("rv1");
    expect(patchReview.mock.calls[0][1].score_problem).toBe(8);
    expect(submitReview).not.toHaveBeenCalled();
  });
});

describe("ReviewerEval header + read-only label", () => {
  it("shows the application's display ID", async () => {
    contentMock.mockResolvedValueOnce(content());
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findAllByText(/TIR-27061/)).not.toHaveLength(0);
  });

  it("labels a decided app with the human admin-decision label, not the raw status", async () => {
    contentMock.mockResolvedValueOnce(content({
      read_only: true, read_only_reason: "decided", app_status: "jury_review",
      admin_decision: "gate1_selected",
    }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/Decision already made \(1st-gate selected\)/)).toBeInTheDocument();
    expect(screen.queryByText(/jury_review/)).not.toBeInTheDocument();
  });

  it("falls back to a human label from the status when no bucket is sent", async () => {
    contentMock.mockResolvedValueOnce(content({
      read_only: true, read_only_reason: "decided", app_status: "jury_review",
    }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/Decision already made \(Final round\)/)).toBeInTheDocument();
  });
});

// ─── Queue counts follow the visible set ──────────────────────────────

const mk = (data) => ({ data, loading: false, error: null, reload: vi.fn() });
const row = (over) => ({
  id: over.id, applicationId: "TIR-" + over.id, track: "tir", movedToTrack: null,
  name: "X" + over.id, founders: [], industry: "Defense", stage: "Lab", ai: { overall: 5 },
  reviewStatus: "submitted", myScore: 6, myReco: "no", due: null,
  detached: false, closed: false, ...over,
});

describe("ReviewerQueue counts with closed rows hidden", () => {
  beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
  const Q = [
    row({ id: "1" }),
    row({ id: "2", myReco: "yes" }),
    row({ id: "3", closed: true }),
    row({ id: "4", closed: true, industry: "Space" }),
    row({ id: "5", reviewStatus: "not-started", myScore: null, myReco: null }),
  ];

  it("chip counts and 'N of total' exclude hidden closed rows", () => {
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const submitted = screen.getByRole("button", { name: /Submitted/ });
    expect(within(submitted).getByText("2")).toBeInTheDocument();
    const no = screen.getByRole("button", { name: /^No\s*\d/ });
    expect(within(no).getByText("1")).toBeInTheDocument();
    const defense = screen.getByRole("button", { name: /Defense/ });
    expect(within(defense).getByText("3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Space/ })).not.toBeInTheDocument();
  });

  it("counts include closed rows once 'Show closed' is on", () => {
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    fireEvent.click(screen.getByRole("button", { name: /Show closed/ }));
    expect(screen.getByText("5 of 5")).toBeInTheDocument();
  });

  it("'Clear filters' also turns 'Show closed' off", () => {
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    fireEvent.click(screen.getByRole("button", { name: /Show closed/ }));
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByRole("button", { name: /Show closed/ })).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });
});
