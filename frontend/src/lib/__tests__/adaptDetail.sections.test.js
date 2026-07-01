import { describe, it, expect } from "vitest";
import { adaptDetail } from "../adminDataAdapter.js";

describe("adaptDetail aiSections", () => {
  it("passes aiSections through", () => {
    const out = adaptDetail({ id: "a1", track: "tir", aiSections: { problem: ["p"] } });
    expect(out.aiSections).toEqual({ problem: ["p"] });
  });
  it("defaults aiSections to null", () => {
    const out = adaptDetail({ id: "a1", track: "tir" });
    expect(out.aiSections).toBeNull();
  });
});
