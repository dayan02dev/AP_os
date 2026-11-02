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
  return wsum ? total / wsum : null;
}
