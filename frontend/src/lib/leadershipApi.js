// Wrapper for the three /leadership/* read endpoints.
//
//   GET /leadership/stats                       → bundled dashboard metrics
//   GET /leadership/applications?<filters>      → paginated cross-track list
//   GET /leadership/applications/{id}           → full app detail (server-inferred track)
//
// Auth + 401 refresh are handled by the shared `api` helper.

import { api } from "./api.js";

function buildQuery(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
}

export const leadershipApi = {
  getStats: () => api.get("/leadership/stats"),
  listApplications: (params = {}) =>
    api.get(`/leadership/applications${buildQuery(params)}`),
  getApplication: (id) => api.get(`/leadership/applications/${id}`),

  // Filter-pill + dashboard-tab data source. Replaces the legacy
  // stats.industry block — returns categories with counts, cap (12), and
  // remaining_slots metadata.
  getIndustryCategories: () => api.get("/leadership/industry-categories"),

  // Short-lived signed download URL for one of an application's file
  // attachments. The backend allow-lists the path against the application's
  // own files before signing (see leadership.py). Returns
  // { url, expires_in }.
  fileSignedUrl: (applicationId, storagePath) =>
    api.get(
      `/leadership/applications/${encodeURIComponent(applicationId)}/files/signed-url` +
        `?storage_path=${encodeURIComponent(storagePath)}`,
    ),

  // ─── Writes ──────────────────────────────────────────────────────────
  //
  // Only reviewer un-assignment remains (used by the review page's Reviewers
  // tab). The status-change and reviewer-assignment writes were removed from
  // the leadership surface. The backend resolves `track` server-side; the
  // `track` arg is kept for signature symmetry with the list rows but is
  // ignored on the wire.

  unassignReviewer: (id, track, reviewer_user_id) =>
    api.del(
      `/leadership/applications/${id}/reviewers/${encodeURIComponent(reviewer_user_id)}`,
    ),

  // Bulk-assign reviewers to one application. Maps to
  //   POST /leadership/applications/{id}/reviewers
  // (leadership_actions router; capability `assign_reviewers`). The backend
  // infers track from the id, so `track` is accepted for signature symmetry
  // with the list rows but is ignored on the wire. Body:
  //   { reviewer_user_ids: string[], due_at?: string }
  // Response: { application_id, track, results: [{reviewer_user_id, status}] }
  // where status ∈ created | already_assigned | not_a_reviewer.
  assignReviewers: (id, track, body) =>
    api.post(`/leadership/applications/${id}/reviewers`, body),

  // ─── Jury v2: per-app assignment ───────────────────────────────────────
  //
  // POST /leadership/applications/{id}/jurors
  // Body: { juror_user_ids: string[] }
  // Response: { application_id, track, results: [{juror_user_id, status}] }
  // where status ∈ created | already_assigned | not_a_juror. The backend
  // also 409s the whole call as not_eligible_for_jury if the app isn't
  // already in jury_review (v2 has no shortlisted→jury_review auto-flip).
  // Track is inferred server-side; the `track` arg is signature symmetry
  // with the list rows only and is ignored on the wire.
  assignJurors: (id, track, body) =>
    api.post(`/leadership/applications/${id}/jurors`, body),

  // DELETE /leadership/applications/{id}/jurors/{juror_user_id}
  // Hard-deletes the assignment and cascades away that juror's pick for the
  // same app (if any) so no dangling selection remains. 409
  // app_already_decided once the app has a Gate-2 (Final Gate) decision —
  // assignments freeze at that point.
  unassignJuror: (id, track, jurorUserId) =>
    api.del(
      `/leadership/applications/${id}/jurors/${encodeURIComponent(jurorUserId)}`,
    ),

  // Gate-1 decision from the leadership surface. Maps to
  //   POST /leadership/applications/{id}/decision
  // (leadership_actions router; capability `decide_application`). Track is
  // inferred server-side. Body: { decision?: "rejected"|"shortlisted"|
  // "on_hold"|"waitlisted" (default "rejected"), rationale?: string }.
  // Reject is legal from any active status, so it works straight from the
  // dashboard drawer.
  decide: (id, body) =>
    api.post(`/leadership/applications/${id}/decision`, body),
};
