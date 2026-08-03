// Investment Committee (IC) document API — admin "VIP Selected" section.
//
//   GET  /admin/platform/ic-documents?track=sip                 current docs
//   POST /admin/platform/ic-documents/{track}/{id}              upload IC PDF
//   POST /admin/platform/ic-documents/{track}/{id}/signature    upload signed PDF
//   GET  /admin/platform/ic-documents/{track}/{id}/file?variant= 120s signed URL
//
// Uploads are multipart — api.js passes a FormData body straight through — and
// use the longer upload timeout, since an IC PDF can be a few MiB.

import { api } from "./api.js";

const BASE = "/admin/platform/ic-documents";
const UPLOAD_TIMEOUT_MS = 60_000;

export const icDocumentsApi = {
  list: (track) => api.get(BASE + (track ? `?track=${encodeURIComponent(track)}` : "")),

  upload: (track, applicationId, file) => {
    const fd = new FormData();
    fd.append("file", file, file.name || "ic.pdf");
    return api.post(`${BASE}/${track}/${encodeURIComponent(applicationId)}`, fd,
      { timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  // `blob` is the browser-stamped signed PDF; `signerName` is the typed name
  // shown on the stamp. The signer's identity is recorded server-side from the
  // session, not from this payload.
  sign: (track, applicationId, blob, signerName, fileName = "ic-signed.pdf") => {
    const fd = new FormData();
    fd.append("file", blob, fileName);
    fd.append("signer_name", signerName);
    return api.post(`${BASE}/${track}/${encodeURIComponent(applicationId)}/signature`, fd,
      { timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  fileUrl: (track, applicationId, variant = "original") =>
    api.get(`${BASE}/${track}/${encodeURIComponent(applicationId)}/file` +
            `?variant=${encodeURIComponent(variant)}`),
};
