// BS2 wave2 — reviewer fixes: S2-REV-04 degraded history CSV, notes cap.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getHistory: vi.fn(),
  getContent: vi.fn(),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  getPanelFeedback: vi.fn(),
  generateVipMemo: vi.fn(() => new Promise(() => {})),
  getVipMemoV2: vi.fn(() => Promise.reject(Object.assign(new Error("nf"), { status: 404 }))),
  downloadVipMemoV2: vi.fn(),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));
vi.mock("../../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { email: "r@x" }, logout: vi.fn() }) }));
vi.mock("../../../../components/PortalSwitcher.jsx", () => ({ default: () => null }));
vi.mock("../../../../components/AccountSettingsButton.jsx", () => ({ default: () => null }));
vi.mock("../../../../components/VipMemoPreview.jsx", () => ({ default: () => null }));

import ReviewerPortal from "../ReviewerPortal.jsx";
import ReviewerEval from "../ReviewerEval.jsx";

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  vi.clearAllMocks();
  api.getQueue.mockReset().mockResolvedValue([]);
});

describe("S2-REV-04: degraded history is not exported as an empty CSV", () => {
  it("alerts instead of downloading a header-only file", async () => {
    api.getHistory.mockResolvedValue({ rows: [], stats: {}, degraded: true });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<MemoryRouter><ReviewerPortal tab="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Export history CSV/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/temporarily unavailable/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("reviewer notes cap", () => {
  it("the notes textarea stops at 10000 characters and a 422 shows Save failed", async () => {
    api.getQueue.mockResolvedValue([]);
    api.getContent.mockResolvedValue({
      id: "A", applicationId: "TIR-A", track: "tir", moved_to_track: null, name: "App A",
      aiSummary: null, aiSections: [], ai: null, fields: [], sections: [], attachments: [],
      application: {}, evaluation: null, assignment: { assignment_id: "a-A" },
      read_only: false, read_only_reason: null, app_status: "under_review",
    });
    api.getPanelFeedback.mockResolvedValue({ available: true, reviews: [], admin_decisions: [] });
    api.submitReview.mockRejectedValue(Object.assign(new Error("Unprocessable"),
      { status: 422, details: { detail: [{ type: "string_too_long", loc: ["body", "quick_notes"] }] } }));
    render(<ReviewerEval track="tir" appId="A" onBack={vi.fn()} />);
    const ta = await screen.findByPlaceholderText(/What stood out/);
    expect(ta.getAttribute("maxlength")).toBe("10000");
    fireEvent.click(screen.getByRole("button", { name: "YES" }));
    fireEvent.change(ta, { target: { value: "x" } });
    await screen.findByText(/Save failed/, {}, { timeout: 3000 });
  });
});
