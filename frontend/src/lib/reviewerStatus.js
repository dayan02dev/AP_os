// reviewerStatus.js — single source for rendering a reviewer's NAME + STATUS
// across the leadership AppDrawer, the leadership review-page Reviewers panel,
// and the admin application detail.
//
// The backend (applications_query.enrich_reviewers) attaches `reviewer_name`
// and a timestamp-derived `reviewer_status` (pending | evaluated | declined)
// to each assignment, and `reviewer_name` to each review. These helpers add
// graceful fallbacks so older/absent payloads still render sensibly — and so
// the UI never shows a stale "pending" once a review has been submitted.

export const REVIEWER_STATUS_LABEL = {
  evaluated: "Evaluated",
  declined: "Declined",
  pending: "Pending",
};

// Small dot-color tokens used by the detail UIs.
export const REVIEWER_STATUS_DOT = {
  evaluated: "green",
  declined: "coral",
  pending: "amber",
};

// Prefer the backend-derived status; fall back to timestamps, then "pending".
export function reviewerStatusOf(assignment) {
  if (!assignment) return "pending";
  if (assignment.reviewer_status) return assignment.reviewer_status;
  if (assignment.declined_at) return "declined";
  if (assignment.completed_at) return "evaluated";
  return "pending";
}

export function reviewerStatusLabel(assignment) {
  const s = reviewerStatusOf(assignment);
  return REVIEWER_STATUS_LABEL[s] || s;
}

export function reviewerStatusDot(assignment) {
  return REVIEWER_STATUS_DOT[reviewerStatusOf(assignment)] || "amber";
}

// Reviewer display name: backend `reviewer_name`, else short UUID, else dash.
export function reviewerNameOf(row) {
  if (!row) return "—";
  return row.reviewer_name || row.reviewer_user_id?.slice(0, 8) || "—";
}
