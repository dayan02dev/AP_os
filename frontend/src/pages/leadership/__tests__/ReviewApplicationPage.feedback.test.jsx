// Leadership review page: reviewer feedback + admin decisions reach the
// Reviews section (default and VIP memo layouts) and the Export PDF.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FIXTURE from "../../../components/__tests__/fixtures/vipMemoV2.fake.json";

const params = { track: "sip", id: "app-vip-1" };
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
    downloadVipMemoV2: vi.fn(),
  },
}));
vi.mock("../review/ApplicationTab.jsx", () => ({ default: () => <div data-testid="app-tab" /> }));
vi.mock("../review/AIScreeningPanel.jsx", () => ({ default: () => <aside /> }));
vi.mock("../../../components/VipMemoPreview.jsx", () => ({ default: () => <div /> }));

import { leadershipApi } from "../../../lib/leadershipApi.js";
import ReviewApplicationPage from "../ReviewApplicationPage.jsx";

const REVIEW = {
  id: "rv-1", reviewer_user_id: "u-rev1", reviewer_name: "Asha Rao",
  submitted_at: "2026-10-20T10:00:00Z",
  score_problem: 8, score_solution: 7, score_tech: 6, score_founders: 7,
  recommendation: "maybe", quick_notes: "QUICKNOTE-TEXT weak GTM", flags: [], disagree_with_ai: {},
};
const DECISION = {
  id: "d1", gate_stage: "gate1", decision: "on_hold", rationale: "ADMIN-RATIONALE waiting on IP",
  decided_by: "a1", decided_by_name: "Admin Ann", decided_at: "2026-10-25T10:00:00Z",
};
const DETAIL = (track) => ({
  id: params.id, track, native_track: track, moved_to_track: null,
  display_id: track === "sip" ? "VIP-26001" : "TIR-26001",
  application: { status: "on_hold" }, ai_screening: {},
  reviews: [REVIEW], reviewer_assignments: [{ reviewer_user_id: "u-rev1" }], status_history: [],
  admin_decisions: [DECISION],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewApplicationPage — Reviews section feedback", () => {
  it("VIP memo layout: the Reviews tab shows reviewer notes and admin rationale", async () => {
    params.track = "sip";
    leadershipApi.getApplication.mockResolvedValue(DETAIL("sip"));
    leadershipApi.getVipMemoV2.mockResolvedValue(FIXTURE);
    render(<ReviewApplicationPage />);
    await screen.findByRole("button", { name: "AI Memo" });
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.getByText("QUICKNOTE-TEXT weak GTM")).toBeTruthy();
    expect(screen.getByText("ADMIN-RATIONALE waiting on IP")).toBeTruthy();
  });

  it("default layout: the Reviews tab shows reviewer notes and admin rationale", async () => {
    params.track = "tir";
    leadershipApi.getApplication.mockResolvedValue(DETAIL("tir"));
    render(<ReviewApplicationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reviews" }));
    expect(screen.getByText("QUICKNOTE-TEXT weak GTM")).toBeTruthy();
    expect(screen.getByText("ADMIN-RATIONALE waiting on IP")).toBeTruthy();
  });

  it("Export PDF prints the reviews (with feedback) below the application", async () => {
    params.track = "tir";
    leadershipApi.getApplication.mockResolvedValue(DETAIL("tir"));
    let printed = null;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {
      printed = document.body.textContent;
    });
    render(<ReviewApplicationPage />);
    const btn = await screen.findByRole("button", { name: /Export PDF/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(printed).toContain("QUICKNOTE-TEXT weak GTM");
    expect(printed).toContain("ADMIN-RATIONALE waiting on IP");
    expect(screen.getByTestId("app-tab")).toBeTruthy();
    // After printing the screen goes back to the Application tab alone.
    await waitFor(() => expect(screen.queryByText("QUICKNOTE-TEXT weak GTM")).toBeNull());
    printSpy.mockRestore();
  });
});
