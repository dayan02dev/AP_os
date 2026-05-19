import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReviewerInboxPage from "../ReviewerInboxPage.jsx";

vi.mock("../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    listAssignments: vi.fn(),
    declineAssignment: vi.fn(),
  },
}));

import { reviewerApi } from "../../../lib/reviewerApi.js";

function renderPage() {
  return render(
    <MemoryRouter>
      <ReviewerInboxPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewerInboxPage", () => {
  it("renders a card per assignment in To Review", async () => {
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345", industry: "EdTech",
          problem_one_liner: "AI tutoring for K-12 in rural India",
          assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev Dayan",
          my_review: null,
        },
      ],
    });
    renderPage();
    await screen.findByText("TIR-2026-abc12345");
    expect(screen.getByText(/AI tutoring/)).toBeInTheDocument();
    expect(screen.getByText(/To review/i)).toBeInTheDocument();
  });

  it("buckets a submitted-but-unlocked assignment into Editable", async () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a2", application_id: "app2", application_track: "tir",
          app_identifier: "TIR-2026-def", industry: "FinTech",
          problem_one_liner: "Voice banking",
          assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev",
          my_review: { review_id: "r2", submitted_at: "2026-05-18T15:00:00Z", locked_at: future },
        },
      ],
    });
    renderPage();
    await screen.findByText(/Editable/i);
    expect(screen.getByText(/Edit review/)).toBeInTheDocument();
  });

  it("opens decline modal when Decline clicked", async () => {
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345", industry: "EdTech",
          problem_one_liner: "x", assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev", my_review: null,
        },
      ],
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Decline/ }));
    expect(await screen.findByRole("heading", { name: /Decline this assignment/i }))
      .toBeInTheDocument();
  });

  it("renders empty state when no assignments", async () => {
    reviewerApi.listAssignments.mockResolvedValue({ assignments: [] });
    renderPage();
    await screen.findByText(/You're caught up/i);
  });
});
