import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FIXTURE from "../../../components/__tests__/fixtures/vipMemoV2.fake.json";

const PILOT = "0117bc80-98c1-4172-bccd-af61327ac580";
const params = { track: "sip", id: PILOT };
vi.mock("react-router-dom", () => ({
  useParams: () => params,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getApplication: vi.fn(),
    listApplications: vi.fn(() => Promise.resolve({ applications: [] })),
    generateVipMemo: vi.fn(() => new Promise(() => {})),
    getVipMemoV2: vi.fn(),
    downloadVipMemoV2: vi.fn(() => Promise.resolve(new Blob(["x"]))),
  },
}));
vi.mock("../review/ApplicationTab.jsx", () => ({ default: () => <div data-testid="app-tab" /> }));
vi.mock("../review/ReviewsTab.jsx", () => ({ default: () => <div /> }));
vi.mock("../review/AIScreeningPanel.jsx", () => ({ default: () => <aside /> }));
vi.mock("../../../components/VipMemoPreview.jsx", () => ({
  default: () => <div data-testid="vip-memo-legacy" />,
}));

import { leadershipApi } from "../../../lib/leadershipApi.js";
import ReviewApplicationPage from "../ReviewApplicationPage.jsx";

const DETAIL = (id) => ({
  id, track: "sip", native_track: "sip", moved_to_track: null, display_id: "VIP-26001",
  application: { status: "evaluated" }, ai_screening: {}, reviews: [],
  reviewer_assignments: [], status_history: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  params.id = PILOT;
  leadershipApi.getApplication.mockImplementation((id) => Promise.resolve(DETAIL(id)));
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

describe("ReviewApplicationPage — VIP memo Navigator (pilot)", () => {
  it("opens on an AI Memo tab, moves the full application to its own tab, and drops History", async () => {
    leadershipApi.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewApplicationPage />);
    expect(await screen.findByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(leadershipApi.getVipMemoV2).toHaveBeenCalledWith(PILOT);
    const tabs = screen.getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(expect.arrayContaining(["AI Memo", "Application", "Reviews"]));
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    expect(screen.queryByTestId("app-tab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Application" }));
    expect(screen.getByTestId("app-tab")).toBeTruthy();
    expect(screen.queryByText("VIP memo · Acme Robotics")).toBeNull();
    expect(screen.queryByTestId("vip-memo-legacy")).toBeNull();
    expect(leadershipApi.generateVipMemo).not.toHaveBeenCalled();
  });

  it("downloads through the v2 endpoint with the chosen format", async () => {
    leadershipApi.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewApplicationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Download DOCX" }));
    await waitFor(() => expect(leadershipApi.downloadVipMemoV2).toHaveBeenCalledWith(PILOT, "docx"));
  });

  it("falls back to the existing memo preview when the v2 memo 404s", async () => {
    leadershipApi.getVipMemoV2.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    render(<ReviewApplicationPage />);
    expect(await screen.findByTestId("vip-memo-legacy")).toBeTruthy();
    await waitFor(() => expect(leadershipApi.generateVipMemo).toHaveBeenCalledWith(PILOT));
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });

  it("is not requested for a non-pilot VIP application", async () => {
    params.id = "not-a-pilot";
    render(<ReviewApplicationPage />);
    await screen.findByTestId("app-tab");
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(leadershipApi.getVipMemoV2).not.toHaveBeenCalled();
    expect(screen.queryByText(/VIP memo · /)).toBeNull();
  });
});
