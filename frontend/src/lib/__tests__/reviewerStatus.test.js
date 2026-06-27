import { describe, it, expect } from "vitest";
import {
  reviewerNameOf,
  reviewerStatusOf,
  reviewerStatusLabel,
  reviewerStatusDot,
} from "../reviewerStatus.js";

describe("reviewerStatus", () => {
  it("prefers the backend-derived reviewer_status", () => {
    expect(reviewerStatusOf({ reviewer_status: "evaluated", state: "pending" })).toBe("evaluated");
    expect(reviewerStatusLabel({ reviewer_status: "evaluated" })).toBe("Evaluated");
    expect(reviewerStatusDot({ reviewer_status: "evaluated" })).toBe("green");
  });

  it("falls back to timestamps when reviewer_status is absent (the bug fix)", () => {
    // completed_at set but vestigial state still 'pending' → must read Evaluated.
    expect(reviewerStatusOf({ completed_at: "2026-06-27T00:00:00Z", state: "pending" })).toBe("evaluated");
    expect(reviewerStatusOf({ declined_at: "2026-06-27T00:00:00Z" })).toBe("declined");
    expect(reviewerStatusOf({ state: "pending" })).toBe("pending");
    expect(reviewerStatusOf({})).toBe("pending");
  });

  it("maps labels and dot colours", () => {
    expect(reviewerStatusLabel({ reviewer_status: "declined" })).toBe("Declined");
    expect(reviewerStatusLabel({})).toBe("Pending");
    expect(reviewerStatusDot({ reviewer_status: "declined" })).toBe("coral");
    expect(reviewerStatusDot({})).toBe("amber");
  });

  it("resolves reviewer name with graceful fallbacks", () => {
    expect(reviewerNameOf({ reviewer_name: "Manish S Shetty" })).toBe("Manish S Shetty");
    expect(reviewerNameOf({ reviewer_user_id: "6fd9bcf5-aaaa-bbbb" })).toBe("6fd9bcf5");
    expect(reviewerNameOf({})).toBe("—");
    expect(reviewerNameOf(null)).toBe("—");
  });
});
