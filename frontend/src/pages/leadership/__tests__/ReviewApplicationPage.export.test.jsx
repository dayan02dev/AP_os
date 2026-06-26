import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Router + auth + api mocks (the page calls these on mount).
vi.mock("react-router-dom", () => ({
  useParams: () => ({ track: "sip", id: "aae677aa-0000-0000-0000-000000000000" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getApplication: vi.fn(),
    listApplications: vi.fn(),
  },
}));
// Stub the heavy tab/aside children — we only test the export wiring.
vi.mock("../review/ApplicationTab.jsx", () => ({
  default: () => <div data-testid="app-tab">application</div>,
}));
vi.mock("../review/ReviewsTab.jsx", () => ({ default: () => <div /> }));
vi.mock("../review/HistoryTab.jsx", () => ({ default: () => <div /> }));
vi.mock("../review/AIScreeningPanel.jsx", () => ({ default: () => <aside /> }));

import { leadershipApi } from "../../../lib/leadershipApi.js";
import ReviewApplicationPage from "../ReviewApplicationPage.jsx";

const DETAIL = {
  application: {
    status: "under_review",
    basic_org_name: "Brain Morph Technologies Pvt. Ltd.",
    submitted_at: "2026-06-01T00:00:00Z",
  },
  ai_screening: { score_overall: 8.5, project_name: "Brain Morph Technologies" },
  reviews: [],
  reviewer_assignments: [],
  status_history: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  leadershipApi.getApplication.mockResolvedValue(DETAIL);
  leadershipApi.listApplications.mockResolvedValue({ applications: [] });
  document.title = "original";
});

describe("ReviewApplicationPage export", () => {
  it("clicking Export PDF calls window.print with a titled document", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ReviewApplicationPage />);

    // Wait for detail to load (button becomes enabled).
    const btn = await screen.findByRole("button", { name: /Export PDF/i });
    await waitFor(() => expect(btn).not.toBeDisabled());

    await userEvent.click(btn);

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(document.title).toContain("SIP-2026-aae677aa");
    expect(document.title).toContain("Brain Morph Technologies");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("original");
    printSpy.mockRestore();
  });
});
