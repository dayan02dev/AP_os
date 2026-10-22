// VIP memo v2 Navigator on the reviewer evaluation page: any VIP app with a
// ready memo; legacy memo fallback only for the v1 pilot ids.
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

  it("memo shows for assigned non-pilot VIP app", async () => {
    api.getContent.mockResolvedValue(content("other-app"));
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(api.getVipMemoV2).toHaveBeenCalledWith("sip", "other-app");
  });

  it("non-pilot VIP app without memo (404) does NOT call the v1 generate API", async () => {
    api.getContent.mockResolvedValue(content("other-app"));
    api.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    await waitFor(() => expect(api.getVipMemoV2).toHaveBeenCalled());
    expect(api.generateVipMemo).not.toHaveBeenCalled();
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });

  it("TIR app makes no v2 request", async () => {
    api.getContent.mockResolvedValue({ ...content("tir-app"), track: "tir" });
    render(<ReviewerEval track="tir" appId="tir-app" onBack={vi.fn()} />);
    await screen.findByText(/Your scores/);
    expect(api.getVipMemoV2).not.toHaveBeenCalled();
  });

  it("memo shows for a TIR-native app moved to VIP", async () => {
    api.getContent.mockResolvedValue({ ...content("moved-app"), track: "tir", moved_to_track: "sip" });
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewerEval track="tir" appId="moved-app" onBack={vi.fn()} />);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(api.getVipMemoV2).toHaveBeenCalledWith("sip", "moved-app");
  });

  it("ready memo: admin-style AI Memo / Application tabs replace the application card", async () => {
    api.getContent.mockResolvedValue({ ...content("other-app"), aiSummary: "AI says hello" });
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    const { container } = render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    const tabs = container.querySelector("nav.vipnav-tabs");
    expect(tabs).toBeTruthy();
    expect([...tabs.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["AI Memo", "Application"]);
    expect(tabs.querySelector("button.active").textContent).toBe("AI Memo");
    expect(screen.queryByText("AI says hello")).toBeNull();
    expect(screen.queryByRole("button", { name: /View full application/ })).toBeNull();
    expect(screen.getByText(/Your scores/)).toBeTruthy();
  });

  it("Application tab renders the full application inline, scoring stays visible", async () => {
    api.getContent.mockResolvedValue(content("other-app"));
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    await screen.findByText("VIP memo · Acme Robotics");
    fireEvent.click(screen.getByRole("button", { name: "Application" }));
    expect(await screen.findByText("Problem & importance")).toBeTruthy();
    expect(screen.queryByText("VIP memo · Acme Robotics")).toBeNull();
    expect(screen.getByText(/Your scores/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Back to evaluation/ })).toBeNull();
  });

  it("no memo yet: keeps the application card with AI summary and no tabs", async () => {
    api.getContent.mockResolvedValue({ ...content("other-app"), aiSummary: "AI says hello" });
    api.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    const { container } = render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    expect(await screen.findByText("AI says hello")).toBeTruthy();
    await waitFor(() => expect(api.getVipMemoV2).toHaveBeenCalled());
    expect(container.querySelector("nav.vipnav-tabs")).toBeNull();
    expect(screen.getByRole("button", { name: /View full application/ })).toBeTruthy();
  });

  it("failed v2 download shows an inline error and keeps the memo", async () => {
    api.getContent.mockResolvedValue(content("other-app"));
    api.getVipMemoV2.mockResolvedValue(FIXTURE);
    api.downloadVipMemoV2.mockRejectedValue(new Error("boom"));
    render(<ReviewerEval track="sip" appId="other-app" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByText("VIP memo · Acme Robotics")).toBeTruthy();
  });
});
