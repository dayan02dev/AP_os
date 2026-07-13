import { describe, it, expect } from "vitest";
import { moveButtonLabel, moveBadgeText } from "../trackMove";

describe("trackMove labels", () => {
  it("labels the button to move to the other track when not moved", () => {
    expect(moveButtonLabel("tir", null)).toBe("Move to VIP");
    expect(moveButtonLabel("sip", null)).toBe("Move to TIR");
  });
  it("labels the button to move back to the home track when moved", () => {
    expect(moveButtonLabel("tir", "sip")).toBe("Move back to TIR");
    expect(moveButtonLabel("sip", "tir")).toBe("Move back to VIP");
  });
  it("badge text shows the direction only when moved", () => {
    expect(moveBadgeText("tir", "sip")).toBe("MOVED · TIR → VIP");
    expect(moveBadgeText("tir", null)).toBeNull();
  });
});
