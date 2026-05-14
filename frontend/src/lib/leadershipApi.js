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
};
