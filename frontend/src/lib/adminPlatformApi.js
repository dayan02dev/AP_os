// Wrapper for /admin/platform/* endpoints. Mirrors reviewerApi.js shape.
//
// Every method maps 1:1 to a backend route built + tested in Tasks 8–13:
//   GET  /admin/platform/applications
//   GET  /admin/platform/applications/{track}/{id}
//   POST /admin/platform/applications/{track}/{id}/decision
//   POST /admin/platform/decisions/bulk
//   PATCH /admin/platform/applications/{track}/{id}/meta
//   GET/POST /admin/platform/batches
//   PATCH /admin/platform/batches/{id}
//   POST /admin/platform/batches/{id}/applications
//   GET  /admin/platform/reviewers
//   PATCH /admin/platform/reviewers/{id}
//   POST /admin/platform/reviewers/rebalance
//   GET  /admin/platform/audit-log
//   GET  /admin/platform/analytics/reviewer-calibration
//   GET  /admin/platform/stats

import { api } from "./api.js";

function buildQuery(params) {
  const entries = Object.entries(params || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
}

export const adminPlatformApi = {
  getPipeline: (params) =>
    api.get(`/admin/platform/applications${buildQuery(params)}`),

  getApplication: (track, id) =>
    api.get(`/admin/platform/applications/${track}/${id}`),

  decide: (track, id, body) =>
    api.post(`/admin/platform/applications/${track}/${id}/decision`, body),

  bulkDecide: (body) => api.post(`/admin/platform/decisions/bulk`, body),

  patchMeta: (track, id, body) =>
    api.patch(`/admin/platform/applications/${track}/${id}/meta`, body),

  getBatches: () => api.get(`/admin/platform/batches`),
  createBatch: (body) => api.post(`/admin/platform/batches`, body),
  renameBatch: (id, body) => api.patch(`/admin/platform/batches/${id}`, body),
  assignBatch: (id, body) =>
    api.post(`/admin/platform/batches/${id}/applications`, body),
  removeAppFromBatch: (id, items) =>
    api.post(`/admin/platform/batches/${id}/applications/remove`, { items }),
  unassignBatch: (items) =>
    api.post(`/admin/platform/batches/unassign`, { items }),
  deleteBatch: (id) => api.del(`/admin/platform/batches/${id}`),

  assignBatchReviewers: (batchId, body) =>
    api.post(`/admin/platform/batches/${batchId}/reviewers`, body),
  unassignBatchReviewer: (batchId, reviewerId) =>
    api.del(`/admin/platform/batches/${batchId}/reviewers/${reviewerId}`),

  getReviewers: () => api.get(`/admin/platform/reviewers`),
  getReviewerApplications: (userId) =>
    api.get(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications`),
  bulkAssignReviewerApps: (userId, items) =>
    api.post(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications`, { items }),
  bulkRemoveReviewerApps: (userId, items) =>
    api.post(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications/remove`, { items }),
  patchReviewer: (id, body) =>
    api.patch(`/admin/platform/reviewers/${id}`, body),
  rebalance: (body) => api.post(`/admin/platform/reviewers/rebalance`, body || {}),

  getAuditLog: (params) =>
    api.get(`/admin/platform/audit-log${buildQuery(params)}`),

  getCalibration: () =>
    api.get(`/admin/platform/analytics/reviewer-calibration`),

  getStats: () => api.get(`/admin/platform/stats`),
};
