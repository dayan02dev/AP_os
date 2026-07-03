import { describe, it, expect } from "vitest";
import { progressFromRow, STATUS_TO_MILESTONE } from "../applicantProgress.js";

describe("progressFromRow", () => {
  it("maps jury_review (admin Approve) → the jury stage, non-terminal", () => {
    const p = progressFromRow({ status: "jury_review" });
    expect(p.currentMilestone).toBe("jury");
    expect(p.outcome).toBeNull();
    expect(p.lastReached).toBeNull();
  });

  it("maps rejected → terminal outcome, always striking Under review", () => {
    const p = progressFromRow({ status: "rejected" });
    expect(p.outcome).toBe("rejected");
    expect(p.lastReached).toBe("under_review");
    expect(p.currentMilestone).toBe("under_review");
  });

  it("rejected is terminal regardless of the from-status shape", () => {
    // Even if the row also carried a current_milestone, rejected wins.
    const p = progressFromRow({ status: "rejected", current_milestone: "jury" });
    expect(p.outcome).toBe("rejected");
    expect(p.lastReached).toBe("under_review");
  });

  it("maps under_review → the under_review stage", () => {
    expect(progressFromRow({ status: "under_review" }).currentMilestone).toBe("under_review");
  });

  it("honours an explicit current_milestone override for non-terminal rows", () => {
    const p = progressFromRow({ status: "submitted", current_milestone: "interview" });
    expect(p.currentMilestone).toBe("interview");
  });

  it("falls back to submitted for unknown / missing status", () => {
    expect(progressFromRow({}).currentMilestone).toBe("submitted");
    expect(progressFromRow(null).currentMilestone).toBe("submitted");
  });

  it("STATUS_TO_MILESTONE includes the new jury_review mapping", () => {
    expect(STATUS_TO_MILESTONE.jury_review).toBe("jury");
  });
});
