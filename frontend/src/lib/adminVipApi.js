// Admin "VIP cohort" verification API. Mirrors backend/app/routers/admin_vip.py
// 1:1 — the AIR verification queue and the MIS submissions matrix.
//
//   GET  /admin/platform/vip/air/queue
//   GET  /admin/platform/vip/air/assessments/{id}
//   POST /admin/platform/vip/air/assessments/{id}/levers/{lever}/verify
//   POST /admin/platform/vip/air/assessments/{id}/confirm-all
//   GET  /admin/platform/vip/mis/matrix?kind=monthly|quarterly
//   GET  /admin/platform/vip/mis/charts
//   GET  /admin/platform/vip/mis/{applicationId}/{kind}/{periodKey}
//   POST /admin/platform/vip/mis/{applicationId}/{kind}/{periodKey}/reopen
//
// Reads are gated server-side by view_all_apps; writes (verify, confirm-all,
// reopen) by manage_vip_cohort. This client does not duplicate that check —
// see lib/rbac.js's hasCapability() for the UI-side gate on the screens.

import { api } from "./api.js";

const BASE = "/admin/platform/vip";

export const adminVipApi = {
  getAirQueue: () => api.get(`${BASE}/air/queue`),

  getAirAssessment: (assessmentId) =>
    api.get(`${BASE}/air/assessments/${encodeURIComponent(assessmentId)}`),

  verifyLever: (assessmentId, lever, body) =>
    api.post(
      `${BASE}/air/assessments/${encodeURIComponent(assessmentId)}/levers/${encodeURIComponent(lever)}/verify`,
      body,
    ),

  confirmAllLevers: (assessmentId) =>
    api.post(`${BASE}/air/assessments/${encodeURIComponent(assessmentId)}/confirm-all`, {}),

  getMisMatrix: (kind) => api.get(`${BASE}/mis/matrix?kind=${encodeURIComponent(kind)}`),

  getMisCharts: () => api.get(`${BASE}/mis/charts`),

  getMisPeriod: (applicationId, kind, periodKey) =>
    api.get(
      `${BASE}/mis/${encodeURIComponent(applicationId)}/${encodeURIComponent(kind)}/${encodeURIComponent(periodKey)}`,
    ),

  reopenMisPeriod: (applicationId, kind, periodKey) =>
    api.post(
      `${BASE}/mis/${encodeURIComponent(applicationId)}/${encodeURIComponent(kind)}/${encodeURIComponent(periodKey)}/reopen`,
      {},
    ),
};
