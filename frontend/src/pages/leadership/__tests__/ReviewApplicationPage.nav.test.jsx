import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

const params = { track: "sip", id: "app-2" };
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useParams: () => params,
  useNavigate: () => navigate,
}));
vi.mock("../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getApplication: vi.fn(),
    listApplications: vi.fn(() => Promise.resolve({ applications: [] })),
    generateVipMemo: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock("../review/ApplicationTab.jsx", () => ({
  default: ({ schema }) => <div data-testid="app-tab">{schema === TIR_SCHEMA_REF.current ? "tir-schema" : "other-schema"}</div>,
}));
vi.mock("../review/ReviewsTab.jsx", () => ({ default: () => <div data-testid="reviews-tab" /> }));
vi.mock("../review/AIScreeningPanel.jsx", () => ({ default: () => <aside /> }));
vi.mock("../../../components/VipMemoPreview.jsx", () => ({
  default: () => <div data-testid="vip-memo" />,
}));

const TIR_SCHEMA_REF = { current: null };

import { leadershipApi } from "../../../lib/leadershipApi.js";
import { TIR_SCHEMA } from "../applicationSchemas.js";
import { writeReviewIdList, ID_LIST_KEY } from "../reviewNav.js";
import ReviewApplicationPage from "../ReviewApplicationPage.jsx";

TIR_SCHEMA_REF.current = TIR_SCHEMA;

const MOVED = {
  id: "app-2",
  track: "sip",
  native_track: "tir",
  moved_to_track: "sip",
  display_id: "VIP-26701",
  application: { status: "jury_review", submitted_at: "2026-06-01T00:00:00Z" },
  ai_screening: { score_overall: 8 },
  reviews: [],
  reviewer_assignments: [{ reviewer_user_id: "rev-1", reviewer_name: "Asha Rao" }],
  status_history: [
    { id: "h1", from_status: "evaluated", to_status: "jury_review", changed_by: "rev-1", changed_at: "2026-07-01T00:00:00Z" },
    { id: "h2", from_status: "under_review", to_status: "evaluated", changed_by: "22753867-aaaa", changed_by_name: "Admin Person", changed_at: "2026-06-20T00:00:00Z" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  params.track = "sip";
  params.id = "app-2";
  sessionStorage.removeItem(ID_LIST_KEY);
  leadershipApi.getApplication.mockResolvedValue(MOVED);
});

describe("ReviewApplicationPage — moved apps + identity", () => {
  it("uses the NATIVE schema and the native → effective badge whatever the URL track", async () => {
    render(<ReviewApplicationPage />);
    expect(await screen.findByText("tir-schema")).toBeTruthy();
    expect(screen.getByText("MOVED · TIR → VIP")).toBeTruthy();
  });

  it("shows the display id and a gate-aware status label, never JURY_REVIEW / Accepted", async () => {
    render(<ReviewApplicationPage />);
    await screen.findByText("tir-schema");
    expect(screen.getAllByText("VIP-26701").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Final round").length).toBeGreaterThan(0);
    expect(screen.queryByText("Accepted")).toBeNull();
  });

  it("uses the list's stage label when it came from the dashboard", async () => {
    writeReviewIdList([{ id: "app-2", track: "tir", label: "Final selected" }]);
    render(<ReviewApplicationPage />);
    await screen.findByText("tir-schema");
    expect(screen.getAllByText("Final selected").length).toBeGreaterThan(0);
  });
});

describe("ReviewApplicationPage — Prev / Next", () => {
  it("walks the dashboard's filtered list (native tracks) and never fetches an unfiltered one", async () => {
    writeReviewIdList([
      { id: "app-1", track: "tir", label: "Reviewed" },
      { id: "app-2", track: "tir", label: "Final round" },
    ]);
    render(<ReviewApplicationPage />);
    await screen.findByText("tir-schema");
    const next = screen.getByRole("button", { name: /Next/ });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    expect(navigate).toHaveBeenCalledWith("/leadership/applications/tir/app-1/review");
    expect(leadershipApi.listApplications).not.toHaveBeenCalled();
  });

  it("picks up the full list when it lands after mount", async () => {
    writeReviewIdList([{ id: "app-2", track: "tir" }]);
    render(<ReviewApplicationPage />);
    await screen.findByText("tir-schema");
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    act(() => {
      writeReviewIdList([{ id: "app-2", track: "tir" }, { id: "app-3", track: "sip" }]);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Next/ })).not.toBeDisabled());
  });
});

describe("ReviewApplicationPage — VIP memo placement", () => {
  it("does not render the VIP memo on the Reviews or History tabs", async () => {
    leadershipApi.getApplication.mockResolvedValue({ ...MOVED, native_track: "sip", moved_to_track: null });
    render(<ReviewApplicationPage />);
    await screen.findByTestId("vip-memo");
    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    expect(screen.queryByTestId("vip-memo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByTestId("vip-memo")).toBeNull();
  });
});

describe("HistoryTab actors", () => {
  it("shows actor names (backend name, else a reviewer name from the detail) instead of uuids", async () => {
    render(<ReviewApplicationPage />);
    await screen.findByText("tir-schema");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/by Asha Rao/)).toBeTruthy();
    expect(screen.getByText(/by Admin Person/)).toBeTruthy();
    expect(screen.queryByText(/by 22753867/)).toBeNull();
  });
});
