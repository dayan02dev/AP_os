// VIP memo v2 Navigator on the admin detail: pilot apps only, legacy fallback.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FIXTURE from "../../../../components/__tests__/fixtures/vipMemoV2.fake.json";

vi.mock("../../../../hooks/useAdminData", () => ({
  loadDetail: vi.fn(),
  useAdminData: () => ({ data: null, loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(),
    generateVipMemo: vi.fn(() => new Promise(() => {})),
    getVipMemoV2: vi.fn(),
    downloadVipMemoV2: vi.fn(() => Promise.resolve(new Blob(["x"]))),
  },
}));
vi.mock("../../../../lib/leadershipApi", () => ({ leadershipApi: {} }));
vi.mock("../../../../components/VipMemoPreview.jsx", () => ({
  default: () => <div data-testid="vip-memo-legacy" />,
}));

import { loadDetail } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminDetail } from "../screens/AdminDetail";

const PILOT = "c8e45451-b9eb-4bed-8293-7a6782237168";
const APP = (id) => ({ id, track: "sip", applicationId: "VIP-1", name: "Some App", founders: [], domain: "X",
  stage: "Lab", sub: "2026-06-01", ai: {}, reviews: [], flags: [], statusHistory: [], assignedReviewers: [],
  chip: "EVALUATED" });
const mount = (id) => {
  loadDetail.mockResolvedValue(APP(id));
  return render(<AdminDetail startupId={id} track="sip" onBack={() => {}} />);
};

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("AdminDetail — VIP memo Navigator", () => {
  it("renders the Navigator for a pilot app instead of the legacy memo", async () => {
    adminPlatformApi.getVipMemoV2.mockResolvedValue(FIXTURE);
    mount(PILOT);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(adminPlatformApi.getVipMemoV2).toHaveBeenCalledWith("sip", PILOT);
    expect(adminPlatformApi.generateVipMemo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("vip-memo-legacy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(adminPlatformApi.downloadVipMemoV2).toHaveBeenCalledWith("sip", PILOT, "pdf"));
  });

  it("falls back to the legacy memo flow when the v2 memo 404s", async () => {
    adminPlatformApi.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    mount(PILOT);
    await waitFor(() => expect(adminPlatformApi.generateVipMemo).toHaveBeenCalledWith("sip", PILOT));
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });

  it("does not ask for the v2 memo on non-pilot apps", async () => {
    mount("other-app");
    await screen.findByRole("heading", { level: 2, name: /Some App/ });
    expect(adminPlatformApi.getVipMemoV2).not.toHaveBeenCalled();
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });
});
