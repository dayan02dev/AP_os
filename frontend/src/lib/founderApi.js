// Wrapper for /founder/* endpoints. Mirrors reviewerApi.js shape.
import { api } from "./api.js";

export const founderApi = {
  me: () => api.get("/founder/me"),

  // MOU — a founder's track can require more than one agreement
  // (agreements.TRACK_AGREEMENTS); one set of 1-3 collaborator party
  // details feeds every agreement, previewed and signed together.
  getMou: () => api.get("/founder/mou"),
  previewMou: (collaborators) => api.post("/founder/mou/preview", { collaborators }),
  // The embedded live preview: real PDF bytes (a Blob) for ONE agreement,
  // built from the collaborator details typed so far and, once the founder
  // has reached the Sign step, whatever they've drawn on the pad. Works
  // before signing -- signerName/signaturePng are optional.
  previewMouPdf: (slug, { collaborators, signerName, signaturePng, signal } = {}) =>
    api.postBlob(
      `/founder/mou/preview/pdf?slug=${encodeURIComponent(slug)}`,
      { collaborators, signer_name: signerName || "", signature_png: signaturePng || null },
      { signal },
    ),
  signMou: (signerName, signaturePng, acknowledgements = [], collaborators = []) =>
    api.post("/founder/mou/sign", {
      signer_name: signerName,
      signature_png: signaturePng,
      acknowledgements,
      collaborators,
    }),
  // agreement omitted -> the row's primary (first-signed) document, same
  // shape as before this task; pass a slug (e.g. "collaboration-v1") to
  // fetch that specific agreement's own signed PDF.
  mouSignedUrl: (agreement) =>
    api.get(agreement ? `/founder/mou/signed-url?agreement=${encodeURIComponent(agreement)}` : "/founder/mou/signed-url"),

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
};
