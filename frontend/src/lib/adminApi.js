// Admin endpoints client. Mirrors backend/app/routers/admin_users.py.
//
// Session 1 only ships createUser (vertical slice). Session 2 fills in the
// rest of the surface (list, detail, patch, grant/revoke, reset-password).
// Keep the function names aligned with the API path names so the mapping
// is obvious in network-tab diagnostics.

import { api } from "./api.js";

export const adminApi = {
  createUser: (payload) => api.post("/admin/users", payload),

  // Stubs for Session 2 — listed here so Session 3 frontend code can
  // import them as soon as the backend ships. Calling these before
  // Session 2 lands will 404; that's expected.
  listUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get(`/admin/users${qs ? `?${qs}` : ""}`);
  },
  getUser: (userId) => api.get(`/admin/users/${userId}`),
  patchUser: (userId, patch) => api.patch(`/admin/users/${userId}`, patch),
  grantRole: (userId, role) =>
    api.post(`/admin/users/${userId}/roles`, { role }),
  revokeRole: (userId, role) =>
    api.del(`/admin/users/${userId}/roles/${role}`),
  resetPassword: (userId) =>
    api.post(`/admin/users/${userId}/reset-password`, null),
};
