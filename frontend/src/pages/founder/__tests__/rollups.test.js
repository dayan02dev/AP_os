import { describe, it, expect } from "vitest";
import { fmtINR, sum, lineTotal } from "../ui.jsx";

describe("founder ui helpers", () => {
  it("formats INR with Indian grouping and ₹", () => {
    expect(fmtINR(2500000)).toBe("₹25,00,000");
    expect(fmtINR(0)).toBe("₹0");
    expect(fmtINR(180000)).toBe("₹1,80,000");
  });
  it("sums a numeric field across rows", () => {
    expect(sum([{ cost: 220000 }, { cost: 145000 }], "cost")).toBe(365000);
  });
  it("computes qty*unit line total", () => {
    expect(lineTotal({ qty: 6, unit_cost: 8500 })).toBe(51000);
  });
});
