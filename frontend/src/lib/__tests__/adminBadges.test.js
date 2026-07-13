import { describe, it, expect } from "vitest";
import { pipelineBadges } from "../adminBadges";

describe("pipelineBadges", () => {
  it("subtracts rejected from the Applications badge and exposes the rejected count", () => {
    const stats = { totals: { apps_submitted: 595 }, statusCounts: [
      { id: "rejected", n: 20 }, { id: "evaluated", n: 5 },
    ]};
    expect(pipelineBadges(stats, false)).toEqual({ appsBadge: 575, rejectedBadge: 20, juryBadge: 0 });
  });
  it("returns nulls while stats are loading", () => {
    expect(pipelineBadges(null, true)).toEqual({ appsBadge: null, rejectedBadge: null, juryBadge: null });
  });
  it("treats a missing rejected bucket as 0", () => {
    const stats = { totals: { apps_submitted: 10 }, statusCounts: [{ id: "evaluated", n: 3 }] };
    expect(pipelineBadges(stats, false)).toEqual({ appsBadge: 10, rejectedBadge: 0, juryBadge: 0 });
  });
  it("returns nulls when stats data is unavailable (load failure, not loading)", () => {
    expect(pipelineBadges(null, false)).toEqual({ appsBadge: null, rejectedBadge: null, juryBadge: null });
  });
  it("clamps the Applications badge at 0 when rejected exceeds submitted", () => {
    const stats = { totals: { apps_submitted: 5 }, statusCounts: [{ id: "rejected", n: 20 }] };
    expect(pipelineBadges(stats, false)).toEqual({ appsBadge: 0, rejectedBadge: 20, juryBadge: 0 });
  });
});

const stats = (counts, submitted) => ({
  statusCounts: counts,
  totals: { apps_submitted: submitted },
});

describe("pipelineBadges — jury badge", () => {
  it("returns nulls while loading", () => {
    expect(pipelineBadges(null, true)).toEqual({ appsBadge: null, rejectedBadge: null, juryBadge: null });
  });

  it("counts rejected and jury_review, and subtracts BOTH from apps", () => {
    const s = stats([{ id: "rejected", n: 32 }, { id: "jury_review", n: 140 }], 595);
    expect(pipelineBadges(s, false)).toEqual({ appsBadge: 595 - 32 - 140, rejectedBadge: 32, juryBadge: 140 });
  });

  it("treats missing entries as zero", () => {
    const s = stats([], 10);
    expect(pipelineBadges(s, false)).toEqual({ appsBadge: 10, rejectedBadge: 0, juryBadge: 0 });
  });
});
