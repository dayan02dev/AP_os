// Weighted overall for a reviewer's submitted review — the canonical "signal
// score" a reviewer sees as "My Score" in their own portal. Mirrors
// frontend/src/pages/reviewer/v2/ui.jsx `weightedOverall` and the backend
// `reviewer_query._SCORE_WEIGHTS`. Lives in lib/ so the leadership surface does
// NOT import from the reviewer-portal module.
//
// `score_solution` is the DB column for the "Completeness / depth of solution"
// dimension (legacy name kept) and carries weight 30.

const WEIGHTED_DIMS = [
  { col: "score_problem", weight: 22 },
  { col: "score_solution", weight: 30 },
  { col: "score_tech", weight: 22 },
  { col: "score_founders", weight: 14 },
];
// "Commitment to be fully available" (score_commitment, weight 12) was removed
// from the reviewer rubric in v3.2. Historical reviews still carry the column;
// it is deliberately ignored so old and new reviews are on the same 4-criterion
// scale (22/30/22/14, normalised by 88) — same as backend _weighted_overall.

// Python's round(x, nd) for the values the score code produces: correctly
// rounded from the double's exact value, ties (only possible when the double
// is an exact decimal half, e.g. 5.625 or 5.25) to even. The backend rounds
// every reviewer overall this way — reviewer_query._weighted_overall to 2 dp,
// admin_query.reviewer_score to 1 dp — so the frontend must too, or the same
// review shows different 1-dp values on different surfaces (RM-1).
export function pyRound(x, nd) {
  // toFixed is exact (spec: closest decimal to the double's true value) and
  // breaks ties away from zero. 30 extra digits are enough to tell a true
  // half from a near-half for scores in 0..10, so only a true half is sent
  // to even. (x * 10**nd can't be used: 0.65 * 10 rounds to exactly 6.5.)
  const wide = x.toFixed(nd + 30);
  if (/^50*$/.test(wide.slice(-30))) {
    const truncated = wide.slice(0, -30).replace(/\.$/, "");
    if (Number(truncated.slice(-1)) % 2 === 0) return Number(truncated);
  }
  return Number(x.toFixed(nd));
}

// One review's weighted overall exactly as the backend sends it: 2 dp.
export function weightedReviewScore(review) {
  if (!review || typeof review !== "object") return null;
  let total = 0;
  let wsum = 0;
  for (const { col, weight } of WEIGHTED_DIMS) {
    const v = review[col];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    total += v * weight;
    wsum += weight;
  }
  return wsum ? pyRound(total / wsum, 2) : null;
}
