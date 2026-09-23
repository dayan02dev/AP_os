import { describe, it, expect } from "vitest";
import { pipelineBadges, selectedCount } from "../adminBadges";

const ALL_NULL = {
  appsBadge: null, rejectedBadge: null, juryBadge: null,
};

describe("pipelineBadges", () => {
  it("subtracts rejected from the Applications badge and exposes the rejected count", () => {
    const stats = { totals: { apps_submitted: 595 }, statusCounts: [
      { id: "rejected", n: 20 }, { id: "evaluated", n: 5 },
    ]};
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 575, rejectedBadge: 20, juryBadge: 0 });
  });
  it("returns nulls while stats are loading", () => {
    expect(pipelineBadges(null, true)).toEqual(ALL_NULL);
  });
  it("treats a missing rejected bucket as 0", () => {
    const stats = { totals: { apps_submitted: 10 }, statusCounts: [{ id: "evaluated", n: 3 }] };
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 10, rejectedBadge: 0, juryBadge: 0 });
  });
  it("returns nulls when stats data is unavailable (load failure, not loading)", () => {
    expect(pipelineBadges(null, false)).toEqual(ALL_NULL);
  });
  it("clamps the Applications badge at 0 when rejected exceeds submitted", () => {
    const stats = { totals: { apps_submitted: 5 }, statusCounts: [{ id: "rejected", n: 20 }] };
    expect(pipelineBadges(stats, false)).toEqual(
      { appsBadge: 0, rejectedBadge: 20, juryBadge: 0 });
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
      appsBadge: 595 - 32 - 140, rejectedBadge: 32, juryBadge: 140 });
  });

  it("treats missing entries as zero", () => {
    const s = stats([], 10);
    expect(pipelineBadges(s, false)).toEqual(
      { appsBadge: 10, rejectedBadge: 0, juryBadge: 0 });
  });
});

describe("pipelineBadges — the merged Selected Applications badge", () => {
  it("counts BOTH tracks in one jury badge", () => {
    // The jury stage used to be two tabs (TIR Selected / VIP Selected) with a
    // badge each. It is one tab now, so the badge is the combined count.
    const s = {
      totals: { apps_submitted: 500 },
      statusCounts: [{ id: "jury_review", n: 16 }],
    };
    const b = pipelineBadges(s, false);
    expect(b.juryBadge).toBe(16);
    expect(b.appsBadge).toBe(500 - 16);
  });

  it("no longer emits the retired per-track badges", () => {
    const s = {
      totals: { apps_submitted: 20 },
      statusCounts: [{ id: "jury_review", n: 4 }],
      // /stats still sends this split; nothing consumes it any more.
      statusCountsByTrack: [{ id: "jury_review", tir: 4, sip: 0 }],
    };
    const b = pipelineBadges(s, false);
    expect(b).toEqual({ appsBadge: 16, rejectedBadge: 0, juryBadge: 4 });
  });
});

describe("pipelineBadges — overlay-aware jury count", () => {
  it("falls back to jury_review + accepted (the /stats overlay folds shortlisted apps into accepted)", () => {
    const s = stats([{ id: "rejected", n: 10 }, { id: "jury_review", n: 0 }, { id: "accepted", n: 16 }], 200);
    expect(pipelineBadges(s, false)).toEqual({ appsBadge: 174, rejectedBadge: 10, juryBadge: 16 });
  });

  it("prefers an exact raw jury_review count when given", () => {
    const s = stats([{ id: "rejected", n: 10 }, { id: "accepted", n: 16 }], 200);
    expect(pipelineBadges(s, false, 18)).toEqual({ appsBadge: 172, rejectedBadge: 10, juryBadge: 18 });
  });
});

describe("selectedCount — the Accepted (green) badge", () => {
  const rows = [
    { id: "a", track: "tir", nativeTrack: "tir" },
    { id: "b", track: "sip", nativeTrack: "tir" },          // moved; doc keyed natively
    { id: "c", track: "sip", nativeTrack: "sip" },          // unsigned memo
    { id: "d", track: "tir", nativeTrack: "tir" },          // no memo
    { id: "e", track: "tir", nativeTrack: "tir", gate2_decision: "rejected" },
  ];
  const docs = [
    { track: "tir", application_id: "a", signed: true },
    { track: "tir", application_id: "b", signed: true },
    { track: "sip", application_id: "c", signed: false },
    { track: "tir", application_id: "e", signed: true },
    { track: "sip", application_id: "b", signed: true },    // wrong (effective) key only
  ];

  it("counts signed + jury_review rows only, keyed by native track", () => {
    expect(selectedCount(rows, docs)).toBe(2);
  });

  it("is null while either list is missing", () => {
    expect(selectedCount(null, docs)).toBeNull();
    expect(selectedCount(rows, undefined)).toBeNull();
  });

  it("is 0, not null, when nothing is signed yet", () => {
    expect(selectedCount(rows, [])).toBe(0);
  });
});
