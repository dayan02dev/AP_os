import { describe, it, expect } from "vitest";
import { pipelineBadges } from "../adminBadges";

// Per-track badges are null unless statusCountsByTrack carries a jury_review
// row, so the pre-existing cases below all expect null for those two keys.
const NO_TRACK_SPLIT = { juryTirBadge: null, juryVipBadge: null };
const ALL_NULL = {
  appsBadge: null, rejectedBadge: null, juryBadge: null,
  juryTirBadge: null, juryVipBadge: null,
};

describe("pipelineBadges", () => {
  it("subtracts rejected from the Applications badge and exposes the rejected count", () => {
    const stats = { totals: { apps_submitted: 595 }, statusCounts: [
      { id: "rejected", n: 20 }, { id: "evaluated", n: 5 },
    ]};
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 575, rejectedBadge: 20, juryBadge: 0, ...NO_TRACK_SPLIT });
  });
  it("returns nulls while stats are loading", () => {
    expect(pipelineBadges(null, true)).toEqual(ALL_NULL);
  });
  it("treats a missing rejected bucket as 0", () => {
    const stats = { totals: { apps_submitted: 10 }, statusCounts: [{ id: "evaluated", n: 3 }] };
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 10, rejectedBadge: 0, juryBadge: 0, ...NO_TRACK_SPLIT });
  });
  it("returns nulls when stats data is unavailable (load failure, not loading)", () => {
    expect(pipelineBadges(null, false)).toEqual(ALL_NULL);
  });
  it("clamps the Applications badge at 0 when rejected exceeds submitted", () => {
    const stats = { totals: { apps_submitted: 5 }, statusCounts: [{ id: "rejected", n: 20 }] };
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 0, rejectedBadge: 20, juryBadge: 0, ...NO_TRACK_SPLIT });
  });
});

const stats = (counts, submitted) => ({
  statusCounts: counts,
  totals: { apps_submitted: submitted },
});

describe("pipelineBadges — jury badge", () => {
  it("returns nulls while loading", () => {
    expect(pipelineBadges(null, true)).toEqual(ALL_NULL);
  });

  it("counts rejected and jury_review, and subtracts BOTH from apps", () => {
    const s = stats([{ id: "rejected", n: 32 }, { id: "jury_review", n: 140 }], 595);
    expect(pipelineBadges(s, false)).toEqual({
      appsBadge: 595 - 32 - 140, rejectedBadge: 32, juryBadge: 140, ...NO_TRACK_SPLIT });
  });

  it("treats missing entries as zero", () => {
    const s = stats([], 10);
    expect(pipelineBadges(s, false)).toEqual(
      { appsBadge: 10, rejectedBadge: 0, juryBadge: 0, ...NO_TRACK_SPLIT });
  });
});

describe("pipelineBadges — per-track jury badges", () => {
  it("splits jury_review into TIR and VIP counts", () => {
    const s = {
      totals: { apps_submitted: 500 },
      statusCounts: [{ id: "jury_review", n: 16 }],
      statusCountsByTrack: [
        { id: "evaluated", tir: 3, sip: 1 },
        { id: "jury_review", tir: 11, sip: 5 },
      ],
    };
    const b = pipelineBadges(s, false);
    expect(b.juryTirBadge).toBe(11);
    expect(b.juryVipBadge).toBe(5);
    // The combined badge (still used for the Applications subtraction) is intact.
    expect(b.juryBadge).toBe(16);
    expect(b.appsBadge).toBe(500 - 16);
  });

  it("treats a track with no jury_review apps as 0, not null", () => {
    const s = {
      totals: { apps_submitted: 20 },
      statusCounts: [{ id: "jury_review", n: 4 }],
      statusCountsByTrack: [{ id: "jury_review", tir: 4 }],
    };
    const b = pipelineBadges(s, false);
    expect(b.juryTirBadge).toBe(4);
    expect(b.juryVipBadge).toBe(0);
  });

  it("stays null when the backend has no per-track field yet", () => {
    const b = pipelineBadges(stats([{ id: "jury_review", n: 9 }], 30), false);
    expect(b.juryTirBadge).toBeNull();
    expect(b.juryVipBadge).toBeNull();
    expect(b.juryBadge).toBe(9);
  });
});
