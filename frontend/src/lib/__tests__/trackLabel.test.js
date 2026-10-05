import { describe, it, expect } from "vitest";
import { trackLabel, relabelDisplayId, movedMarker, displayIdText } from "../trackLabel.js";

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

describe("moved-app display ID (native prefix + marker)", () => {
  it("movedMarker labels the destination track, empty when not moved", () => {
    expect(movedMarker("sip")).toBe("→ VIP");
    expect(movedMarker("tir")).toBe("→ TIR");
    expect(movedMarker(null)).toBe("");
  });
  it("collision case: native VIP-26255 and moved TIR-26255 stay distinct", () => {
    const nativeVip = displayIdText("SIP-26255", null);
    const movedTir = displayIdText("TIR-26255", "sip");
    expect(nativeVip).toBe("VIP-26255");
    expect(movedTir).toBe("TIR-26255 → VIP");
    expect(nativeVip).not.toBe(movedTir);
  });
  it("csv form wraps the marker in parens, empty-safe", () => {
    expect(displayIdText("TIR-26255", "sip", { csv: true })).toBe("TIR-26255 (→ VIP)");
    expect(displayIdText("SIP-26011", "tir", { csv: true })).toBe("VIP-26011 (→ TIR)");
    expect(displayIdText("TIR-1", null, { csv: true })).toBe("TIR-1");
    expect(displayIdText("", "sip")).toBe("");
  });
});
