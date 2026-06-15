import { describe, expect, it } from "vitest";

import {
  canSubmitDecision,
  illegalTransitionMessage,
} from "../AdminApplicationDetail.jsx";

describe("canSubmitDecision — rationale gate", () => {
  it("requires a chosen decision", () => {
    expect(canSubmitDecision(null, "")).toBe(false);
    expect(canSubmitDecision("", "anything")).toBe(false);
  });

  it("lets shortlist submit without a rationale", () => {
    expect(canSubmitDecision("shortlisted", "")).toBe(true);
    expect(canSubmitDecision("shortlisted", "   ")).toBe(true);
  });

  it("requires a non-blank rationale for hold / reject / waitlist", () => {
    for (const d of ["on_hold", "rejected", "waitlisted"]) {
      expect(canSubmitDecision(d, "")).toBe(false);
      expect(canSubmitDecision(d, "   ")).toBe(false);
      expect(canSubmitDecision(d, "not a fit")).toBe(true);
    }
  });

  it("rejects an unknown decision id", () => {
    expect(canSubmitDecision("approved", "x")).toBe(false);
  });
});

describe("illegalTransitionMessage — 422 hint", () => {
  it("includes the allowed list and prettified current status", () => {
    const msg = illegalTransitionMessage("under_review", ["shortlisted", "on_hold"]);
    expect(msg).toContain("isn't allowed");
    expect(msg).toContain("Under Review");
    expect(msg).toContain("Shortlisted");
    expect(msg).toContain("On Hold");
  });

  it("degrades gracefully with no allowed list", () => {
    const msg = illegalTransitionMessage("submitted", undefined);
    expect(msg).toBe("That decision isn't allowed from the current status.");
  });

  it("handles a missing current status", () => {
    const msg = illegalTransitionMessage(null, ["rejected"]);
    expect(msg).toContain("current status");
    expect(msg).toContain("Rejected");
  });
});
