// Swarm-2 (reviewer_eval) @ 837ccf0. Each test asserts CORRECT behaviour, so
// it FAILS while the documented bug is present (test names say which).
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
import { Slider } from "../ui.jsx";
import { pyRound } from "../../../../lib/reviewScore.js";

const row = (id, reviewStatus = "not-started") => ({
  id, track: "tir", applicationId: `TIR-${id}`, name: `App ${id}`, founders: ["F"],
  industry: "Health", stage: "MVP", due: null, ai: null, reviewStatus, myScore: null,
  myReco: reviewStatus === "submitted" ? "yes" : null, movedToTrack: null,
  detached: false, closed: false,
});
const content = (id, over = {}) => ({
  id, applicationId: `TIR-${id}`, track: "tir", moved_to_track: null, name: `App ${id}`,
  aiSummary: null, aiSections: [], ai: null, fields: [], sections: [], attachments: [],
  application: {}, evaluation: null, assignment: { assignment_id: "a-" + id },
  read_only: false, read_only_reason: null, app_status: "under_review", ...over,
});
const SUBMITTED = {
  id: "rv1", submitted_at: "2026-10-01T00:00:00Z", recommendation: "yes",
  score_problem: 7, score_solution: 7, score_tech: 7, score_founders: 7, quick_notes: "n",
};

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  vi.clearAllMocks();
  api.getQueue.mockReset().mockResolvedValue([row("A"), row("B")]);
  api.getContent.mockReset().mockImplementation((t, id) => Promise.resolve(content(id)));
  api.submitReview.mockReset().mockResolvedValue({ review: { id: "r-new" } });
  api.patchReview.mockReset().mockResolvedValue({});
  api.getPanelFeedback.mockReset().mockResolvedValue({ available: true, reviews: [], admin_decisions: [] });
});

describe("auto-advance vs 'Re-open to edit' (NEW)", () => {
  it("does not yank the reviewer to the next app after they re-opened the review", async () => {
    // First getQueue (mount) resolves; the post-submit refetch is slow.
    let releaseQueue;
    api.getQueue.mockReset()
      .mockResolvedValueOnce([row("A"), row("B")])
      .mockImplementationOnce(() => new Promise((r) => { releaseQueue = () => r([row("A", "submitted"), row("B")]); }));
    const onOpen = vi.fn();
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} onOpen={onOpen} advanceDelayMs={20} />);
    await screen.findByText(/Your scores/);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "good" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    // Reviewer spots a typo and re-opens before the queue refetch returns.
    fireEvent.click(await screen.findByRole("button", { name: /Re-open to edit/ }));
    fireEvent.change(screen.getByPlaceholderText(/What stood out/), { target: { value: "good, fixed typo" } });
    await act(async () => { releaseQueue(); });
    await new Promise((r) => setTimeout(r, 120));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("panel feedback score rounding (NEW)", () => {
  it("shows another reviewer's 6.25 overall at 1 dp the way the backend rounds (6.2), not 6.3", async () => {
    api.getContent.mockResolvedValue(content("A", { evaluation: SUBMITTED }));
    api.getPanelFeedback.mockResolvedValue({
      available: true,
      admin_decisions: [],
      reviews: [{ id: "o1", reviewer_name: "Other", recommendation: "maybe", quick_notes: "x",
        flags: [], disagree_with_ai: {}, submitted_at: "2026-10-02T00:00:00Z",
        score_problem: 5, score_solution: 6, score_tech: 8, score_founders: 6, overall: 6.25 }],
    });
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} />);
    await screen.findByTestId("panel-feedback");
    expect(pyRound(6.25, 1)).toBe(6.2);
    expect(screen.queryByText("6.3")).not.toBeInTheDocument();
    expect(screen.getByText("6.2")).toBeInTheDocument();
  });
});

describe("REV-15: re-opened review, notes cleared", () => {
  it("autosave 422 notes_required highlights the notes field instead of a bare 'Save failed'", async () => {
    api.getContent.mockResolvedValue(content("A", { evaluation: SUBMITTED }));
    api.patchReview.mockRejectedValue(Object.assign(new Error("Unprocessable"),
      { status: 422, code: "notes_required" }));
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Re-open to edit/ }));
    const ta = screen.getByPlaceholderText(/What stood out/);
    fireEvent.change(ta, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "NO" }));
    await waitFor(() => expect(api.patchReview).toHaveBeenCalled(), { timeout: 2000 });
    await screen.findByText(/Save failed/);
    // The reco change was rejected along with the empty notes; the field must say why.
    expect(ta.style.borderColor).toBe("var(--bad)");
  });
});

describe("Slider accessibility (NEW)", () => {
  it("is keyboard operable (role=slider, focusable, ArrowRight moves it)", () => {
    const onChange = vi.fn();
    render(<Slider label="Technical Depth" value={5} onChange={onChange} />);
    const s = screen.getByRole("slider");
    s.focus();
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(5.5);
  });
});

describe("submit waits for an in-flight autosave (NEW, plausible)", () => {
  it("does not send the submit PATCH while the previous autosave PATCH is still unresolved", async () => {
    api.getContent.mockResolvedValue(content("A", {
      evaluation: { ...SUBMITTED, submitted_at: null, quick_notes: "draft" },
    }));
    let release;
    api.patchReview.mockReset()
      .mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }))
      .mockResolvedValue({});
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} advanceDelayMs={10} />);
    const ta = await screen.findByPlaceholderText(/What stood out/);
    fireEvent.change(ta, { target: { value: "v1 notes" } });
    await waitFor(() => expect(api.patchReview).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.change(ta, { target: { value: "v2 notes (final)" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    await new Promise((r) => setTimeout(r, 30));
    // Two concurrent PATCHes to the same row may be applied out of order
    // (autosave 'v1 notes' landing last on the now-submitted review).
    expect(api.patchReview).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });
});
