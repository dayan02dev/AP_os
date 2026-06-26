import { describe, it, expect } from "vitest";
import { trackLabel, relabelDisplayId } from "../trackLabel.js";

describe("trackLabel", () => {
  it("maps tir→TIR and sip→VIP, case-insensitively", () => {
    expect(trackLabel("tir")).toBe("TIR");
    expect(trackLabel("sip")).toBe("VIP");
    expect(trackLabel("SIP")).toBe("VIP");
    expect(trackLabel("Tir")).toBe("TIR");
  });
  it("uppercases unknown tracks and is empty-safe", () => {
    expect(trackLabel("other")).toBe("OTHER");
    expect(trackLabel("")).toBe("");
    expect(trackLabel(null)).toBe("");
    expect(trackLabel(undefined)).toBe("");
  });
});

describe("relabelDisplayId", () => {
  it("rewrites a leading SIP- prefix to VIP-", () => {
    expect(relabelDisplayId("SIP-26710")).toBe("VIP-26710");
    expect(relabelDisplayId("sip-26710")).toBe("VIP-26710");
  });
  it("leaves TIR- and other strings untouched, empty-safe", () => {
    expect(relabelDisplayId("TIR-26013")).toBe("TIR-26013");
    expect(relabelDisplayId("VIP-26710")).toBe("VIP-26710");
    expect(relabelDisplayId("")).toBe("");
    expect(relabelDisplayId(null)).toBe("");
  });
});
