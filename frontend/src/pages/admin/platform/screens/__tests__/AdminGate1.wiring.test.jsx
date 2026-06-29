import { describe, it, expect } from "vitest";
import { UPPER_TO_WIRE } from "../AdminGate1.jsx";

describe("AdminGate1 decision mapping", () => {
  it("maps batch Approve to jury_review (so the applicant email fires)", () => {
    expect(UPPER_TO_WIRE.APPROVED).toBe("jury_review");
  });
  it("no longer carries a HOLD mapping", () => {
    expect(UPPER_TO_WIRE.HOLD).toBeUndefined();
  });
});
