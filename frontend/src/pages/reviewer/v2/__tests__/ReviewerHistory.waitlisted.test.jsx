import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    getHistory: () =>
      Promise.resolve({
        rows: [
          { reviewId: "rv1", name: "Alpha Co", date: "2026-06-27T00:00:00Z", myScore: 7,
            reco: "yes", adminDecision: "waitlisted", track: "tir", appId: "id1" },
          { reviewId: "rv2", name: "Beta Co", date: "2026-06-27T00:00:00Z", myScore: 7,
            reco: "yes", adminDecision: "withdrawn", track: "tir", appId: "id2" },
        ],
      }),
  },
}));

import ReviewerHistory from "../ReviewerHistory.jsx";

describe("ReviewerHistory waitlisted/withdrawn (S2-REV-24/29)", () => {
  it("labels waitlisted and withdrawn instead of Awaiting admin", async () => {
    render(<ReviewerHistory onOpenEval={() => {}} />);
    expect((await screen.findAllByText(/Waitlisted/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Withdrawn/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Awaiting admin/)).toBeNull();
  });
});
