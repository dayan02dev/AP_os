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
};
