import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReviewerCompletedPage from "../ReviewerCompletedPage.jsx";

vi.mock("../../../lib/reviewerApi.js", () => ({
  reviewerApi: { listCompletedReviews: vi.fn() },
}));
import { reviewerApi } from "../../../lib/reviewerApi.js";

beforeEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter>
      <ReviewerCompletedPage />
    </MemoryRouter>,
  );
}

describe("ReviewerCompletedPage", () => {
  it("renders rows from the API", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({
      reviews: [
        {
          review_id: "r1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345",
          problem_one_liner: "AI tutoring",
          score_overall_mine: 6.6, recommendation: "maybe",
          submitted_at: "2026-05-15T10:00:00Z",
        },
      ],
      page: 1, total_pages: 1, total: 1,
    });
    renderPage();
    await screen.findByText("TIR-2026-abc12345");
    expect(screen.getByText("6.6")).toBeInTheDocument();
    expect(screen.getByText("Maybe")).toBeInTheDocument();
  });

  it("renders empty state when there are no reviews", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({ reviews: [], page: 1, total_pages: 1, total: 0 });
    renderPage();
    await screen.findByText(/Nothing here yet/i);
  });

  it("re-fetches with track filter when a chip is clicked", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({ reviews: [], page: 1, total_pages: 1, total: 0 });
    renderPage();
    await screen.findByText(/Nothing here yet/i);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^TIR$/ }));
    expect(reviewerApi.listCompletedReviews).toHaveBeenLastCalledWith({ track: "tir", page: 1 });
  });
});
