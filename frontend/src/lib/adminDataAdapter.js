export const STATUS_TO_CHIP = {
  submitted: "NEW", ai_screening: "PROCESSING", under_review: "IN REVIEW",
  evaluated: "EVALUATED", shortlisted: "SHORTLISTED", interview: "JURY REVIEW",
  on_hold: "HOLD", offered: "ACCEPTED", onboarded: "ACCEPTED",
  rejected: "REJECTED", waitlisted: "WAITLISTED", withdrawn: "WITHDRAWN",
};
export const DECISION_TO_ADMIN = {
  shortlisted: "APPROVED", on_hold: "HOLD", rejected: "REJECTED", waitlisted: "WAITLISTED",
};
export const BUTTON_TO_DECISION = {
  approve: "shortlisted", hold: "on_hold", reject: "rejected", waitlist: "waitlisted",
};

function flagColor(status) {
  if (["shortlisted", "interview", "offered", "onboarded"].includes(status)) return "darkgreen";
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
