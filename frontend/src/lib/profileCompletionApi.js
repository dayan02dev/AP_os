import { apiCall } from "./api.js";

const enc = encodeURIComponent;

export const profileCompletionApi = {
  getState: (token) => apiCall(`/profile-completion/${enc(token)}`, { method: "GET" }),

  submit: (token, { file, linkedinUrl }) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (linkedinUrl) fd.append("linkedin_url", linkedinUrl);
    return apiCall(`/profile-completion/${enc(token)}`, { method: "POST", body: fd });
  },

  // --- Direct-to-storage evidence upload -----------------------------------
  // The browser PUTs each file STRAIGHT to Supabase Storage via a signed URL,
  // bypassing the ~6MB API-Gateway/Lambda payload cap, then we register the
  // metadata so it lands in the Evidence section (prune dead + append).
  getEvidenceUploadUrl: (token, { filename, mime }) =>
    apiCall(`/profile-completion/${enc(token)}/evidence-upload-url`, {
      method: "POST",
      body: { filename, mime },
    }),

  finalizeEvidence: (token, files) =>
    apiCall(`/profile-completion/${enc(token)}/evidence-finalize`, {
      method: "POST",
      body: { files },
    }),

  // Orchestrator: upload each file directly, then finalize. `onProgress` gets
  // { index, total, name } before each file and once more at the end.
  uploadEvidenceFiles: async (token, filesList, onProgress) => {
    const files = Array.from(filesList || []);
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (onProgress) onProgress({ index: i, total: files.length, name: f.name });
      const mime = f.type || "application/octet-stream";
      const { path, signed_url: signedUrl } = await profileCompletionApi.getEvidenceUploadUrl(token, {
        filename: f.name,
        mime,
      });
      const res = await fetch(signedUrl, {
        method: "PUT",
        body: f,
        headers: { "content-type": mime, "x-upsert": "true" },
      });
      if (!res.ok) throw new Error(`Upload failed for "${f.name}" (HTTP ${res.status})`);
      uploaded.push({ path, name: f.name, size: f.size, mime });
    }
    if (onProgress) onProgress({ index: files.length, total: files.length, name: null });
    return profileCompletionApi.finalizeEvidence(token, uploaded);
  },
};
