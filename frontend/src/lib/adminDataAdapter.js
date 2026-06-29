export const STATUS_TO_CHIP = {
  submitted: "NEW", ai_screening: "PROCESSING", under_review: "IN REVIEW",
  evaluated: "EVALUATED", shortlisted: "SHORTLISTED", jury_review: "JURY REVIEW", interview: "JURY REVIEW",
  on_hold: "HOLD", offered: "ACCEPTED", onboarded: "ACCEPTED",
  rejected: "REJECTED", waitlisted: "WAITLISTED", withdrawn: "WITHDRAWN",
};
export const DECISION_TO_ADMIN = {
  shortlisted: "APPROVED", jury_review: "APPROVED", on_hold: "HOLD", rejected: "REJECTED", waitlisted: "WAITLISTED",
};
export const BUTTON_TO_DECISION = {
  approve: "jury_review", hold: "on_hold", reject: "rejected", waitlist: "waitlisted",
};

function flagColor(status) {
  if (["shortlisted", "interview", "jury_review", "offered", "onboarded"].includes(status)) return "darkgreen";
  if (["under_review", "evaluated"].includes(status)) return "green";
  return "orange";
}

export function adaptPipelineRow(row) {
  return {
    id: row.id,
    applicationId: row.applicationId,
    track: row.track,
    name: row.name,
    founders: row.founder ? [row.founder] : [],
    domain: row.industry || "—",
    stage: row.stage || "—",
    ai: { overall: row.ai_score_overall ?? null },
    rev: undefined,
    flags: [],
    variance: null,
    chip: STATUS_TO_CHIP[row.status] || "NEW",
    flag: flagColor(row.status),
    adminDecision: row.decision ? DECISION_TO_ADMIN[row.decision] : undefined,
    hidden: !!row.isHidden,
    archived: !!row.isArchived,
    batch: row.batch || "Unassigned",
    sub: row.submitted_at ? row.submitted_at.slice(0, 10) : "",
  };
}

export function adaptStats(api) {
  return {
    totals: api.totals || {},
    funnel: api.funnel || {},
    statusCounts: api.status_counts || [],
    aiScores: api.ai_score_overalls || [],
    decisions: api.decisions || {},
  };
}

const AI_CAT = { score_problem: "problem", score_completeness: "solution", score_tech: "tech",
  score_founders: "founders", score_commitment: "commit", score_integrity: "integrity" };
// Reviews carry their OWN columns — there is NO score_completeness / score_integrity
// on a review. The reviewer's "Solution" score lives in score_solution.
const REVIEW_CAT = { score_problem: "problem", score_solution: "solution", score_tech: "tech",
  score_founders: "founders", score_commitment: "commit" };

function adaptAi(scr) {
  if (!scr) return { overall: null };
  const out = { overall: scr.score_overall ?? null, conf: null };
  for (const [k, v] of Object.entries(AI_CAT)) if (scr[k] != null) out[v] = scr[k];
  return out;
}
function adaptOneReview(rv) {
  const out = {
    reco: rv.recommendation || rv.reco || null,
    notes: rv.quick_notes || rv.notes || rv.comment || "",
    flags: Array.isArray(rv.flags) ? rv.flags : [],
    reviewerId: rv.reviewer_user_id || null,
    reviewerName: rv.reviewer_name || null,
    submittedAt: rv.submitted_at || null,
  };
  for (const [k, v] of Object.entries(REVIEW_CAT)) if (rv[k] != null) out[v] = rv[k];
  // Overall: explicit score_overall, else average of present category scores.
  if (rv.score_overall != null) {
    out.overall = rv.score_overall;
  } else {
    const cats = Object.values(REVIEW_CAT).map(v => out[v]).filter(n => typeof n === "number");
    out.overall = cats.length ? Math.round((cats.reduce((a, b) => a + b, 0) / cats.length) * 10) / 10 : null;
  }
  return out;
}

export const adaptReviewer = (r) => ({
  id: r.user_id, name: r.name, email: r.email, weight: r.weight ?? 1.0,
  domains: r.domains || [], domain: (r.domains || []).join(", "), batch: r.batch || "Unassigned",
  batches: r.batches || [],
  assigned: r.assigned, completed: r.completed, progress: r.progress || "0 / 0",
  consistency: r.consistency, last: r.lastActivity, startups: [],
});
export const adaptReviewerApplication = (a) => ({
  id: a.id,
  track: a.track,
  project: a.project || "—",
  industry: a.industry || "—",
  status: a.status,
  chip: STATUS_TO_CHIP[a.status] || "NEW",
  batch: a.batch || null,               // null → UI shows "Random allotment"
  reviewStatus: a.reviewStatus || "pending",
  assignmentId: a.assignment_id || null,
});
export const adaptCalibrationRow = (r) => ({
  id: r.user_id, name: r.name, nReviews: r.n_reviews, avgScore: r.avg_score,
  variance: r.avg_variance_vs_ai,
});
export const adaptAuditEntry = (e) => ({ ts: e.ts, actor: e.actor, action: e.action,
  target: e.target, detail: e.detail });
export const adaptBatch = (b) => ({ id: b.id, name: b.name, phase: b.phase || "",
  created: b.created_at, updated: b.updated_at });

export function adaptDetail(d) {
  const founders = [];
  if (d.founder?.name) founders.push(d.founder.name);
  if (d.founder?.affiliation) founders.push(d.founder.affiliation);
  const reviews = Array.isArray(d.reviews) ? d.reviews.filter(r => r.submitted_at) : [];
  return {
    id: d.id,
    application: d.application || null,
    track: d.track,
    applicationId: d.display_id,
    name: d.project_name,
    founders,
    domain: d.industry?.label || "—",
    stage: d.stage || "—",
    trl: d.application?.tir_trl ?? d.application?.sip_trl ?? "—",
    sub: d.application?.submitted_at ? d.application.submitted_at.slice(0, 10) : "",
    chip: STATUS_TO_CHIP[d.application?.status] || "NEW",
    flag: flagColor(d.application?.status),
    ai: adaptAi(d.ai_screening),
    aiSummary: d.ai_screening?.summary || "",
    rev: reviews.length ? adaptOneReview(reviews[0]) : undefined,
    reviews: reviews.map(adaptOneReview),
    flags: [],
    variance: null,
    adminDecision: d.decision?.decision ? DECISION_TO_ADMIN[d.decision.decision] : undefined,
    adminRationale: d.decision?.rationale || "",
    batch: d.batch?.name || "Unassigned",
    assignedReviewers: (d.reviewer_assignments || []).map(a => a.reviewer_user_id),
    // Full enriched assignment rows (carry reviewer_name + reviewer_status from
    // the backend) so the detail card can show names + real status, not IDs.
    reviewerAssignments: Array.isArray(d.reviewer_assignments) ? d.reviewer_assignments : [],
    statusHistory: d.status_history || [],
    hidden: !!d.meta?.is_hidden,
    archived: !!d.meta?.is_archived,
  };
}
