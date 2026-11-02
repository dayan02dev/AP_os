// Filtered-only review flow (2026-11 reviewer reports): Prev/Next and the
// post-submit auto-advance walk the queue exactly as the reviewer filtered and
// sorted it, never closed or unassigned rows, with a fresh queue.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getContent: vi.fn(),
  getQueue: vi.fn(),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  getPanelFeedback: vi.fn(),
  generateVipMemo: vi.fn(() => new Promise(() => {})),
  getVipMemoV2: vi.fn(() => Promise.reject(Object.assign(new Error("nf"), { status: 404 }))),
  downloadVipMemoV2: vi.fn(),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));
vi.mock("../../../../components/VipMemoPreview.jsx", () => ({ default: () => null }));

import ReviewerEval from "../ReviewerEval.jsx";
import { writeStickyState } from "../../../../hooks/useStickyState.js";

const row = (id, track, reviewStatus, industry, extra = {}) => ({
  id, track, applicationId: `${track.toUpperCase()}-${id}`, name: `App ${id}`,
  founders: ["F"], industry, stage: "MVP", due: null, ai: null, reviewStatus,
  myScore: null, myReco: reviewStatus === "submitted" ? "yes" : null,
  movedToTrack: null, detached: false, closed: false, ...extra,
});

// Backend order: tracks interleaved, a submitted, a closed and an unassigned row.
const QUEUE = [
  row("v1", "sip", "not-started", "Climate"),
  row("t1", "tir", "not-started", "Health"),
  row("v2", "sip", "submitted", "Climate"),
  row("v3", "sip", "submitted", "Agri", { closed: true }),
  row("t2", "tir", "submitted", "Climate", { detached: true }),
  row("v4", "sip", "not-started", "Climate"),
];
const markSubmitted = (rows, id) =>
  rows.map((r) => (r.id === id ? { ...r, reviewStatus: "submitted", myReco: "yes" } : r));

const content = (id, track, over = {}) => ({
  id, applicationId: `${track.toUpperCase()}-${id}`, track, moved_to_track: null,
  name: `App ${id}`, aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a-" + id }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});

const filterVipNotStartedClimate = () => {
  writeStickyState("reviewer.queue", "track", "sip");
  writeStickyState("reviewer.queue", "status", "not-started");
  writeStickyState("reviewer.queue", "domain", "Climate");
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getQueue.mockReset().mockResolvedValue(QUEUE);
  api.getContent.mockReset().mockImplementation((t, id) => Promise.resolve(content(id, t)));
  api.submitReview.mockReset().mockResolvedValue({ review: { id: "r-new" } });
  api.patchReview.mockReset().mockResolvedValue({});
  api.getPanelFeedback.mockReset().mockResolvedValue({ available: true, reviews: [], admin_decisions: [] });
});

async function navButtons() {
  const next = await screen.findByRole("button", { name: /Next application/ });
  const prev = screen.getByRole("button", { name: /Prev application/ });
  // Let the queue fetch settle.
  await act(async () => { await Promise.resolve(); });
  return { next, prev };
}

async function fillAndSubmit() {
  await screen.findByText(/Your scores/);
  fireEvent.click(screen.getByRole("button", { name: "YES" }));
  fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "good" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
}

describe("Prev/Next follow the queue's filters and sort", () => {
  it("VIP + Not Started + Climate: Next from v1 is v4, not the TIR app in between", async () => {
    filterVipNotStartedClimate();
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={onOpen} />);
    const { next, prev } = await navButtons();
    await waitFor(() => expect(next).not.toBeDisabled());
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(onOpen).toHaveBeenCalledWith("sip", "v4");
  });

  it("never walks into closed or unassigned rows", async () => {
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v2" onBack={vi.fn()} onOpen={onOpen} />);
    const { next } = await navButtons();
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    expect(onOpen).toHaveBeenCalledWith("sip", "v4");
  });

  it("Next is disabled when the only row after is no longer assigned", async () => {
    api.getContent.mockResolvedValue(content("A", "tir"));
    api.getQueue.mockResolvedValue([
      { id: "A", track: "tir", detached: false, closed: false, reviewStatus: "not-started" },
      { id: "GONE", track: "sip", detached: true, closed: false, reviewStatus: "submitted" },
    ]);
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} onOpen={vi.fn()} />);
    const { next } = await navButtons();
    await new Promise((r) => setTimeout(r, 20));
    expect(next).toBeDisabled();
  });

  it("follows the queue's sort (name descending)", async () => {
    writeStickyState("reviewer.queue", "sortCol", "name");
    writeStickyState("reviewer.queue", "sortAsc", false);
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v4" onBack={vi.fn()} onOpen={onOpen} />);
    const { next } = await navButtons();
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    expect(onOpen).toHaveBeenCalledWith("sip", "v1"); // v3 is closed, v2 already submitted
  });

  it("shows which filter the flow follows and how many are left", async () => {
    filterVipNotStartedClimate();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={vi.fn()} />);
    // v1 itself (not yet submitted) and v4.
    expect(await screen.findByText("Filtered: VIP · Not started · Climate — 2 left")).toBeInTheDocument();
  });

  it("drops the 'left' count under the Submitted filter", async () => {
    writeStickyState("reviewer.queue", "status", "submitted");
    render(<ReviewerEval track="sip" appId="v2" onBack={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText("Filtered: Submitted")).toBeInTheDocument();
  });

  it("Next skips an app the reviewer already submitted (status All)", async () => {
    writeStickyState("reviewer.queue", "track", "sip");
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={onOpen} />);
    const { next } = await navButtons();
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    expect(onOpen).toHaveBeenCalledWith("sip", "v4");
  });

  it("refetches the queue when moving to another app", async () => {
    const { rerender } = render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={vi.fn()} />);
    await navButtons();
    rerender(<ReviewerEval track="sip" appId="v4" onBack={vi.fn()} onOpen={vi.fn()} />);
    await navButtons();
    await waitFor(() => expect(api.getQueue).toHaveBeenCalledTimes(2));
  });
});

describe("auto-advance after submit", () => {
  it("opens the next app in the filter, using the refreshed queue", async () => {
    filterVipNotStartedClimate();
    api.getQueue.mockResolvedValueOnce(QUEUE).mockResolvedValue(markSubmitted(QUEUE, "v1"));
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={onOpen} advanceDelayMs={20} />);
    await navButtons();
    await fillAndSubmit();
    expect(await screen.findByText(/Submitted ✓ — opening next in your filter/)).toBeInTheDocument();
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("sip", "v4"));
    expect(api.getQueue).toHaveBeenCalledTimes(2);
  });

  it("'Stay here' cancels the advance", async () => {
    filterVipNotStartedClimate();
    api.getQueue.mockResolvedValueOnce(QUEUE).mockResolvedValue(markSubmitted(QUEUE, "v1"));
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={onOpen} advanceDelayMs={150} />);
    await navButtons();
    await fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: /Stay here/ }));
    await new Promise((r) => setTimeout(r, 250));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("says 'All done in this filter' when nothing is left, with a way back to the queue", async () => {
    filterVipNotStartedClimate();
    const before = markSubmitted(QUEUE, "v1");
    api.getQueue.mockResolvedValueOnce(before).mockResolvedValue(markSubmitted(before, "v4"));
    const onOpen = vi.fn();
    const onBack = vi.fn();
    render(<ReviewerEval track="sip" appId="v4" onBack={onBack} onOpen={onOpen} advanceDelayMs={10} />);
    await navButtons();
    await fillAndSubmit();
    expect(await screen.findByText(/All done in this filter/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to queue/ }));
    expect(onBack).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a re-submit of an already submitted review does not auto-advance", async () => {
    api.getContent.mockImplementation((t, id) => Promise.resolve(content(id, t, {
      evaluation: { id: "rv2", submitted_at: "2026-10-01T00:00:00Z", recommendation: "yes",
        score_problem: 7, score_solution: 7, score_tech: 7, score_founders: 7, quick_notes: "n" },
    })));
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v2" onBack={vi.fn()} onOpen={onOpen} advanceDelayMs={10} />);
    fireEvent.click(await screen.findByRole("button", { name: /Re-open to edit/ }));
    fireEvent.click(screen.getByRole("button", { name: /Re-submit evaluation/ }));
    await waitFor(() => expect(api.patchReview).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText(/opening next/)).not.toBeInTheDocument();
  });

  it("never advances while an autosave is still in flight", async () => {
    filterVipNotStartedClimate();
    api.getQueue.mockResolvedValueOnce(QUEUE).mockResolvedValue(markSubmitted(QUEUE, "v1"));
    api.getContent.mockImplementation((t, id) => Promise.resolve(content(id, t, {
      evaluation: { id: "rv1", submitted_at: null, recommendation: "yes",
        score_problem: 6, score_solution: 6, score_tech: 6, score_founders: 6, quick_notes: "draft" },
    })));
    let release;
    api.patchReview.mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }))
      .mockResolvedValue({});
    const onOpen = vi.fn();
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={onOpen} advanceDelayMs={10} />);
    await navButtons();
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "draft 2" } });
    // Wait for the debounced autosave to start (and hang).
    await waitFor(() => expect(api.patchReview).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    await screen.findByText(/opening next in your filter/);
    await new Promise((r) => setTimeout(r, 120));
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("sip", "v4"));
  });
});

describe("assignment removed mid-session (403 not_your_assignment)", () => {
  it("locks the form with a clear 'no longer assigned' banner instead of 'Save failed'", async () => {
    api.submitReview.mockRejectedValue(Object.assign(new Error("Forbidden"),
      { status: 403, code: "not_your_assignment" }));
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} onOpen={vi.fn()} />);
    await navButtons();
    await fillAndSubmit();
    expect(await screen.findByText(/This application is no longer assigned to you/)).toBeInTheDocument();
    expect(screen.queryByText(/Save failed/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/What stood out/)).toBeDisabled();
  });
});
