// Pipeline bars scale with their value: a small floor keeps a non-zero bar
// visible, but it must not erase differences between small values.
import { describe, expect, it } from "vitest";
import { funnelBarWidth } from "../screens/AdminDashboard";

describe("funnelBarWidth", () => {
  it("is 0 for a zero count", () => {
    expect(funnelBarWidth(0, 605)).toBe(0);
  });
  it("preserves order for small values (2 < 10 < 16 < 20 < 48)", () => {
    const w = [2, 10, 16, 20, 48].map((c) => funnelBarWidth(c, 605));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThan(w[i - 1]);
  });
  it("is proportional above the floor", () => {
    expect(funnelBarWidth(20, 605)).toBeCloseTo((20 / 605) * 100, 5);
    expect(funnelBarWidth(605, 605)).toBe(100);
  });
  it("keeps a visible sliver for a tiny non-zero count", () => {
    expect(funnelBarWidth(1, 100000)).toBeGreaterThan(0);
  });
});
