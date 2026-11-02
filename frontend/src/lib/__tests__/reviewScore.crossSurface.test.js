// RM-1: one rounding rule for a reviewer's weighted overall across surfaces.
// The backend (reviewer_query._weighted_overall) returns round(total/88, 2)
// and admin_query.reviewer_score returns round(mean_of_those, 1), with
// Python's round(): exact binary value, ties to even. Every frontend path must
// produce the same numbers so one review shows one 1-dp value everywhere.
import { describe, expect, it } from "vitest";
import { weightedReviewScore, pyRound } from "../reviewScore.js";
import { weightedOverall } from "../../pages/reviewer/v2/ui.jsx";
import { weightedReviewerScore } from "../../pages/admin/platform/screens/AdminDetail.jsx";
import { adaptDetail } from "../adminDataAdapter.js";

// Exact port of CPython round(x, nd) for a double: take the double's exact
// binary value (BigInt), scale by 10^nd, round half to even.
function pythonRound(x, nd) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp;
  if (expBits === 0) { exp = -1074; } else { mant |= 1n << 52n; exp = expBits - 1075; }
  let num = mant * 10n ** BigInt(nd);
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp); else den <<= BigInt(-exp);
  let q = num / den;
  const r2 = (num % den) * 2n;
  if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n;
  return Number(sign * q) / 10 ** nd;
}

const STEPS = Array.from({ length: 21 }, (_, i) => i / 2);
function* combos() {
  for (const p of STEPS) for (const s of STEPS) for (const t of STEPS) for (const f of STEPS) yield [p, s, t, f];
}
const backendOverall = (p, s, t, f) => pythonRound((p * 22 + s * 30 + t * 22 + f * 14) / 88, 2);

describe("pyRound matches Python round()", () => {
  it("ties go to even on exactly representable halves", () => {
    expect(pyRound(5.625, 2)).toBe(5.62);
    expect(pyRound(5.375, 2)).toBe(5.38);
    expect(pyRound(5.25, 1)).toBe(5.2);
    expect(pyRound(5.75, 1)).toBe(5.8);
    expect(pyRound(5.65, 1)).toBe(5.7); // 5.65 is stored just above 5.65
    expect(pyRound(5.6477, 2)).toBe(5.65);
    expect(pyRound(0.65, 1)).toBe(0.7); // 0.65 * 10 is exactly 6.5 in floats; not a true tie
    expect(pyRound(1.05, 1)).toBe(1.1);
    expect(pyRound(3, 2)).toBe(3);
    expect(pyRound(0.125, 2)).toBe(0.12);
  });
});

describe("cross-surface reviewer overall over every 0.5-step score combo", () => {
  it("lib, reviewer eval, admin per-review and admin consensus all follow the backend rule", () => {
    const mismatches = [];
    for (const [p, s, t, f] of combos()) {
      const want2 = backendOverall(p, s, t, f);
      const want1 = pythonRound(want2, 1); // admin_query.reviewer_score, one review
      const row = { score_problem: p, score_solution: s, score_tech: t, score_founders: f, submitted_at: "x" };
      const lib = weightedReviewScore(row);
      const evalPage = weightedOverall({ problem: p, solution: s, tech: t, founders: f });
      const adminReview = { problem: p, solution: s, tech: t, founders: f, submittedAt: "x", reviewerId: "r" };
      const adminConsensus = weightedReviewerScore([adminReview], {}, null);
      if (lib !== want2 || evalPage !== want2 || adminConsensus !== want1) {
        mismatches.push({ p, s, t, f, want2, want1, lib, evalPage, adminConsensus });
        if (mismatches.length > 5) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("adminDataAdapter per-review overall and consensus follow the backend rule", () => {
    // adaptDetail is heavier; cover every combo of the 5-10 band (where the
    // 1-dp divergence was reported) plus the documented repro.
    const mismatches = [];
    const band = STEPS.filter((v) => v >= 5);
    scan: for (const p of band) for (const s of band) for (const t of band) for (const f of band) {
      const want2 = backendOverall(p, s, t, f);
      const row = { id: "rv", reviewer_user_id: "u", submitted_at: "2026-10-01T00:00:00Z",
        score_problem: p, score_solution: s, score_tech: t, score_founders: f };
      const d = adaptDetail({ id: "A1", track: "tir", reviews: [row], application: {} });
      if (d.reviews[0].overall !== want2 || d.rev.overall !== pythonRound(want2, 1)) {
        mismatches.push({ p, s, t, f, want2, one: d.reviews[0].overall, cons: d.rev.overall });
        if (mismatches.length > 5) break scan;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("documented repro: 5/5/6/7.5 shows 5.7 on every per-review surface", () => {
    const row = { score_problem: 5, score_solution: 5, score_tech: 6, score_founders: 7.5 };
    expect(weightedReviewScore(row).toFixed(1)).toBe("5.7");
    expect(weightedOverall({ problem: 5, solution: 5, tech: 6, founders: 7.5 }).toFixed(2)).toBe("5.65");
  });
});
