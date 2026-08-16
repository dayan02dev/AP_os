// Wrapper for /founder/* endpoints. Mirrors reviewerApi.js shape.
import { api, UPLOAD_TIMEOUT_MS } from "./api.js";

export const founderApi = {
  me: () => api.get("/founder/me"),

  // MOU
  getMou: () => api.get("/founder/mou"),
  signMou: (signerName, signaturePng, acknowledgements = []) =>
    api.post("/founder/mou/sign", {
      signer_name: signerName,
      signature_png: signaturePng,
      acknowledgements,
    }),
  mouSignedUrl: () => api.get("/founder/mou/signed-url"),

  // Approach
  getApproach: () => api.get("/founder/approach"),
  putApproach: (payload) => api.put("/founder/approach", payload),

  // Organization / team
  listTeam: () => api.get("/founder/team"),
  addTeam: (m) => api.post("/founder/team", m),
  editTeam: (id, patch) => api.patch(`/founder/team/${id}`, patch),
  delTeam: (id) => api.del(`/founder/team/${id}`),

  // Expense
  getExpense: () => api.get("/founder/expense"),
  addBom: (b) => api.post("/founder/bom", b),
  editBom: (id, patch) => api.patch(`/founder/bom/${id}`, patch),
  delBom: (id) => api.del(`/founder/bom/${id}`),
  addEquipment: (e) => api.post("/founder/equipment", e),
  editEquipment: (id, patch) => api.patch(`/founder/equipment/${id}`, patch),
  delEquipment: (id) => api.del(`/founder/equipment/${id}`),
  addProcurement: (p) => api.post("/founder/procurement", p),
  editProcurement: (id, patch) => api.patch(`/founder/procurement/${id}`, patch),
  delProcurement: (id) => api.del(`/founder/procurement/${id}`),

  // Dashboard
  getDashboard: () => api.get("/founder/dashboard"),

  // Residency journey · Approach 6-step wizard
  getExperiments: () => api.get("/founder/experiments"),
  addExperiment: (track) => api.post("/founder/experiments", { track }),
  patchExperiment: (id, patch) => api.patch(`/founder/experiments/${id}`, patch),
  delExperiment: (id) => api.del(`/founder/experiments/${id}`),

  getTasks: () => api.get("/founder/tasks"),
  addTask: (task) => api.post("/founder/tasks", task),
  patchTask: (id, patch) => api.patch(`/founder/tasks/${id}`, patch),
  delTask: (id) => api.del(`/founder/tasks/${id}`),

  getReview: () => api.get("/founder/review"),
  submitReview: () => api.post("/founder/review/submit"),
  advanceReview: () => api.post("/founder/review/advance"),

  getMentors: () => api.get("/founder/mentors"),
  getResidency: () => api.get("/founder/residency"),
  syncProcurement: () => api.post("/founder/procurement/sync"),

  // Founders resources · Procurement store
  getStore: () => api.get("/founder/store"),
  addToCart: (productId, qty = 1) => api.post("/founder/store/cart", { product_id: productId, qty }),
  setCartQty: (productId, qty) => api.patch(`/founder/store/cart/${productId}`, { qty }),
  removeCartItem: (productId) => api.del(`/founder/store/cart/${productId}`),
  requestQuote: (productId) => api.post("/founder/store/quote-request", { product_id: productId }),
  pushCartToProcurement: () => api.post("/founder/store/push-to-procurement"),

  // Founders resources · Fundraising & connects
  getFundraising: () => api.get("/founder/fundraising"),
  toggleIntro: (investorId) => api.post("/founder/fundraising/intro", { investor_id: investorId }),

  // Founders resources · Corporate partners
  getPartners: () => api.get("/founder/partners"),
  togglePartner: (partnerId) => api.post("/founder/partners/request", { partner_id: partnerId }),

  // Founders resources · Book ARTPARK assets
  getAssets: () => api.get("/founder/assets"),
  createBooking: (assetId, date, slot) => api.post("/founder/assets/bookings", { asset_id: assetId, date, slot }),
  deleteBooking: (id) => api.del(`/founder/assets/bookings/${id}`),

  // Founders resources · IT & Facilities support
  getSupport: () => api.get("/founder/support"),
  createTicket: (payload) => api.post("/founder/support/tickets", payload),

  // ---- AIR (VIP TLR evaluation) ----
  getAir: () => api.get("/founder/air"),
  putAirLever: (lever, payload) => api.put(`/founder/air/levers/${lever}`, payload),
  submitAir: () => api.post("/founder/air/submit"),
  // Multipart — field names are exact, `upload_evidence` reads them via
  // Form(...) on the backend, not JSON. The backend allows up to 25MB
  // (26,214,400 bytes); the default 30s timeout is too tight for that on a
  // slow connection, so this follows the same UPLOAD_TIMEOUT_MS precedent
  // as api.uploadSipTemplate, the only other upload path in this codebase.
  uploadAirEvidence: (lever, airLevel, file) => {
    const fd = new FormData();
    fd.append("file", file, file.name || "evidence");
    fd.append("lever", lever);
    fd.append("air_level", airLevel);
    return api.post("/founder/air/evidence", fd, { timeoutMs: UPLOAD_TIMEOUT_MS });
  },
  delAirEvidence: (id) => api.del(`/founder/air/evidence/${id}`),
  airEvidenceSignedUrl: (id) => api.get(`/founder/air/evidence/${id}/signed-url`),

  // ---- MIS (VIP monthly + quarterly reporting) ----
  // `kind` is "monthly" | "quarterly"; `periodKey` is the server's own key
  // ("2026-05", "FY26-27-Q1") — never construct one client-side, the
  // calendar is server-owned and IST-anchored.
  //
  // Every write below returns the whole period bundle, so callers replace
  // state wholesale rather than merging: `overdue`, `vs_last`, `needs_gap`
  // and headcount `net_change` are all derived server-side and re-derive on
  // each response.
  //
  // The API validates rather than coerces — send JSON numbers and `null`
  // for empty, never `""`, or the call 422s `invalid_value`.
  getMis: () => api.get("/founder/mis"),
  getMisPeriod: (kind, periodKey) => api.get(`/founder/mis/${kind}/${periodKey}`),
  putMisMetrics: (kind, periodKey, items) =>
    api.put(`/founder/mis/${kind}/${periodKey}/metrics`, items),
  putMisNarrative: (kind, periodKey, patch) =>
    api.put(`/founder/mis/${kind}/${periodKey}/narrative`, patch),
  putMisEntries: (kind, periodKey, section, rows) =>
    api.put(`/founder/mis/${kind}/${periodKey}/entries/${section}`, rows),
  putMisFinancials: (kind, periodKey, rows) =>
    api.put(`/founder/mis/${kind}/${periodKey}/financials`, rows),
  putMisHeadcount: (kind, periodKey, rows) =>
    api.put(`/founder/mis/${kind}/${periodKey}/headcount`, rows),
  // 409s `mis_earlier_period_open` (with the blocking period's key + label
  // in the detail) while any earlier period of the same kind is still draft.
  submitMisPeriod: (kind, periodKey) =>
    api.post(`/founder/mis/${kind}/${periodKey}/submit`),
};
