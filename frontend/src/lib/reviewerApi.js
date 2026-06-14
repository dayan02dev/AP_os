// Wrapper for /reviewer/* endpoints. Mirrors leadershipApi.js shape.

import { api } from "./api.js";

function buildQuery(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
}

export const reviewerApi = {
  listAssignments: () => api.get("/reviewer/assignments"),

  getApplication: (track, id) =>
    api.get(`/reviewer/applications/${track}/${id}`),

  getMyReview: (applicationId) =>
    api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(applicationId)}`),

  submitReview: (payload) => api.post("/reviewer/reviews", payload),

  patchReview: (reviewId, patch) =>
    api.patch(`/reviewer/reviews/${reviewId}`, patch),

  declineAssignment: (assignmentId, reason) =>
    api.post(`/reviewer/assignments/${assignmentId}/decline`, { reason }),

  listCompletedReviews: (params = {}) =>
    api.get(`/reviewer/reviews${buildQuery({ mine: true, locked: true, ...params })}`),

  getQueue: () => api.get("/reviewer/queue"),
  getContent: (track, id) =>
    api.get(`/reviewer/applications/${track}/${id}/content`),
  getHistory: () => api.get("/reviewer/history"),
  getRubric: (track) =>
    api.get(`/reviewer/rubric?track=${encodeURIComponent(track)}`),
};
