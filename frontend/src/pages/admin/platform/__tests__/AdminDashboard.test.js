import { describe, expect, it } from "vitest";

import { buildHistogram } from "../AdminDashboard.jsx";

describe("buildHistogram", () => {
  it("produces 10 bins over 0..10 by default", () => {
    const { bins } = buildHistogram([]);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toMatchObject({ from: 0, to: 1, count: 0 });
    expect(bins[9]).toMatchObject({ from: 9, to: 10, count: 0 });
  });

  it("buckets scores by floor and clamps 10.0 into the top bin", () => {
    const { bins, total } = buildHistogram([0, 5.4, 9.99, 10]);
    expect(total).toBe(4);
    expect(bins[0].count).toBe(1); // 0
    expect(bins[5].count).toBe(1); // 5.4
    expect(bins[9].count).toBe(2); // 9.99 and 10 both land in top bin
  });

  it("ignores non-finite / non-number values and handles missing input", () => {
    expect(buildHistogram(undefined).total).toBe(0);
    const { total } = buildHistogram([NaN, null, "7", Infinity, 7]);
    expect(total).toBe(1);
  });

  it("reports the median bin index", () => {
    const { medianIdx } = buildHistogram([1, 1, 8, 8, 8]);
    expect(medianIdx).toBe(8);
  });
});
