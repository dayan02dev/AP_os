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

  // ─── Writes (Session 6 / Tasks 20-22) ───────────────────────────────
  //
  // The backend resolves `track` server-side from the application id, so the
  // `track` arg below is forwarded as an advisory body field only. We keep
  // it in the signature for symmetry with the list rows (which already carry
  // track) and for clearer network-tab traces.

  changeStatus: (id, track, to_status, reason) =>
    api.patch(`/leadership/applications/${id}/status`, {
      to_status,
      reason: reason || null,
      track: track || undefined,
    }),

  // Single-reviewer assignment — wraps the bulk endpoint with [user_id]. The
  // backend is idempotent, so calling this for an already-active reviewer is
  // a 201 with `added=[]` and `already_assigned=[user_id]`.
  assignReviewer: (id, track, reviewer_user_id) =>
    api.post(`/leadership/applications/${id}/reviewers`, {
      reviewer_user_ids: [reviewer_user_id],
      track: track || undefined,
    }),

  // Bulk path for the modal's "set the whole reviewer list to X" use case.
  // Caller passes the *new* desired list; the modal handles diffing against
  // the current set and issues separate DELETEs for removals.
  bulkAssignReviewers: (id, track, reviewer_user_ids) =>
    api.post(`/leadership/applications/${id}/reviewers`, {
      reviewer_user_ids,
      track: track || undefined,
    }),

  unassignReviewer: (id, track, reviewer_user_id) =>
    api.del(
      `/leadership/applications/${id}/reviewers/${encodeURIComponent(reviewer_user_id)}`,
    ),

  legalNextStatuses: (id) =>
    api.get(`/leadership/applications/${id}/legal-next-statuses`),
};
