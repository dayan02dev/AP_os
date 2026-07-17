// Wrapper for /founder/* endpoints. Mirrors reviewerApi.js shape.
import { api } from "./api.js";

export const founderApi = {
  me: () => api.get("/founder/me"),

  // MOU
  getMou: () => api.get("/founder/mou"),
  signMou: (signerName, signaturePng) =>
    api.post("/founder/mou/sign", { signer_name: signerName, signature_png: signaturePng }),
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
};
