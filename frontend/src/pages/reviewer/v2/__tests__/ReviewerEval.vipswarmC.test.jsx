// VIP-swarm-C: reviewer eval write flows for VIP apps. Tests named BUG_* document defects.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getContent: vi.fn(),
  getQueue: () => Promise.resolve([]),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  generateVipMemo: vi.fn(() => new Promise(() => {})),
  getVipMemoV2: vi.fn(() => Promise.reject(Object.assign(new Error("nf"), { status: 404 }))),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));

import ReviewerEval from "../ReviewerEval.jsx";

const content = (over = {}) => ({
  id: "v1", applicationId: "VIP-26001", track: "sip", moved_to_track: null,
  name: "Some App", aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

const notesBox = () => document.querySelector("textarea");

describe("ReviewerEval (VIP) write flows", () => {
  it("moved TIR->VIP app submits with the NATIVE track and assignment id", async () => {
    api.getContent.mockResolvedValue(content({ track: "tir", moved_to_track: "sip" }));
    api.submitReview.mockResolvedValue({ review: { id: "r1" } });
    render(<ReviewerEval track="tir" appId="v1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.change(notesBox(), { target: { value: "ok" } });
    fireEvent.click(await screen.findByRole("button", { name: /Yes|YES/ }));
    fireEvent.click(screen.getByRole("button", { name: /Submit evaluation/ }));
    await waitFor(() => expect(api.submitReview).toHaveBeenCalled());
    const last = api.submitReview.mock.calls.at(-1)[0];
    expect(last.application_track).toBe("tir");
    expect(last.assignment_id).toBe("a1");
  });

  it("submit_is_disabled_without_recommendation_and_hint_shown", async () => {
    // Submit is enabled with only notes; server answers 422 incomplete_review. UI only shows
    // the generic "Save failed" chip, no mention that a recommendation is required.
    api.getContent.mockResolvedValue(content());
    api.submitReview.mockRejectedValue(Object.assign(new Error("x"), {
      status: 422, code: "incomplete_review", details: { missing: ["recommendation"] } }));
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.change(notesBox(), { target: { value: "ok" } });
    const btn = screen.getByRole("button", { name: /Submit evaluation/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Choose a recommendation to submit/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Yes|YES/ }));
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(api.submitReview).toHaveBeenCalled());
    await screen.findByText(/Missing: recommendation/);
  });

  it("edit_made_while_autosave_in_flight_is_saved_afterwards", async () => {
    api.getContent.mockResolvedValue(content());
    let resolveFirst;
    api.submitReview.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    api.patchReview.mockResolvedValue({});
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.change(notesBox(), { target: { value: "first" } });
    await waitFor(() => expect(api.submitReview).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(notesBox(), { target: { value: "first and more" } }); // edit during in-flight save
    await new Promise((r) => setTimeout(r, 1200));                          // debounce fires, savingRef still true
    resolveFirst({ review: { id: "r1" } });
    await new Promise((r) => setTimeout(r, 1800));
    const saved = api.patchReview.mock.calls.some(([, p]) => p.quick_notes === "first and more");
    expect(saved).toBe(true);
  }, 15000);

  it("409 application_decided locks the form", async () => {
    api.getContent.mockResolvedValue(content());
    api.submitReview.mockRejectedValue(Object.assign(new Error("x"), { status: 409, code: "application_decided" }));
    render(<ReviewerEval track="sip" appId="v1" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    fireEvent.change(notesBox(), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Save draft/ })).toBeDisabled());
  });
});
