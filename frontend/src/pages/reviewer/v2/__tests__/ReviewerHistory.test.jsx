import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    getHistory: () =>
      Promise.resolve({
        rows: [
          {
            reviewId: "rv1", name: "Cognitive Warfare AI", date: "2026-06-27T00:00:00Z",
            myScore: 2.1, reco: "no", adminDecision: "rejected", track: "tir", appId: "id1",
            editWindowExpiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
          },
        ],
      }),
  },
}));

import ReviewerHistory from "../ReviewerHistory.jsx";

describe("ReviewerHistory edit-anytime", () => {
  it("enables Edit even when the edit window has expired", async () => {
    render(<ReviewerHistory onOpenEval={() => {}} />);
    const btn = await screen.findByRole("button", { name: /Edit/i });
    expect(btn).not.toBeDisabled();
  });
});
