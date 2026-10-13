// VIP memo v2 Navigator on the reviewer evaluation page: pilot apps only,
// legacy memo fallback when the v2 memo is unavailable.
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FIXTURE from "../../../../components/__tests__/fixtures/vipMemoV2.fake.json";

const api = vi.hoisted(() => ({
  getContent: vi.fn(),
  getQueue: () => Promise.resolve([]),
  getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  submitReview: vi.fn(),
  patchReview: vi.fn(),
  generateVipMemo: vi.fn(() => new Promise(() => {})),
  getVipMemoV2: vi.fn(),
  downloadVipMemoV2: vi.fn(() => Promise.resolve(new Blob(["x"]))),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: api }));
vi.mock("../../../../components/VipMemoPreview.jsx", () => ({
  default: () => <div data-testid="vip-memo-legacy" />,
}));

import ReviewerEval from "../ReviewerEval.jsx";

const PILOT = "0117bc80-98c1-4172-bccd-af61327ac580";
const content = (id) => ({
  id, applicationId: "VIP-26001", track: "sip", moved_to_track: null,
  name: "Some App", aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review",
});

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("ReviewerEval — VIP memo Navigator", () => {
  it("renders the Navigator for an assigned pilot app instead of the legacy memo", async () => {
    api.getContent.mockResolvedValue(content(PILOT));
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewerEval track="sip" appId={PILOT} onBack={vi.fn()} />);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(api.getVipMemoV2).toHaveBeenCalledWith("sip", PILOT);
    expect(api.generateVipMemo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("vip-memo-legacy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download DOCX" }));
    await waitFor(() => expect(api.downloadVipMemoV2).toHaveBeenCalledWith("sip", PILOT, "docx"));
  });

  it("falls back to the legacy memo when the v2 memo 404s", async () => {
    api.getContent.mockResolvedValue(content(PILOT));
    api.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    render(<ReviewerEval track="sip" appId={PILOT} onBack={vi.fn()} />);
    expect(await screen.findByTestId("vip-memo-legacy")).toBeTruthy();
    await waitFor(() => expect(api.generateVipMemo).toHaveBeenCalledWith("sip", PILOT));
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });

  it("does not ask for the v2 memo on non-pilot apps", async () => {
    api.getContent.mockResolvedValue(content("other-app"));
    render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    expect(api.getVipMemoV2).not.toHaveBeenCalled();
  });
});
