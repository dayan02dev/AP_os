// Investment Committee (IC) document API — admin "Accepted" tab.
//
//   GET    /admin/platform/ic-documents?track=sip                    current docs
//   POST   /admin/platform/ic-documents/{track}/{id}?mode=           upload IC PDF
//   POST   /admin/platform/ic-documents/{track}/{id}/signature       upload signed PDF
//   GET    /admin/platform/ic-documents/{track}/{id}/file?variant=   120s signed URL
//   DELETE /admin/platform/ic-documents/{track}/{id}/documents/{doc} retire one doc
//
// An application can hold several current documents. `upload` appends by
// default; sign / fileUrl take the document id so each file is addressed
// individually (omitting it means the newest document, the pre-multi contract).
//
// Uploads are multipart — api.js passes a FormData body straight through — and
// use the longer upload timeout, since an IC PDF can be a few MiB.

import { api } from "./api.js";

const BASE = "/admin/platform/ic-documents";
const UPLOAD_TIMEOUT_MS = 60_000;

const appPath = (track, applicationId) =>
  `${BASE}/${track}/${encodeURIComponent(applicationId)}`;

export const icDocumentsApi = {
  list: (track) => api.get(BASE + (track ? `?track=${encodeURIComponent(track)}` : "")),

  // mode: "append" (add next to the current documents) | "replace" (supersede them).
  upload: (track, applicationId, file, { mode = "append" } = {}) => {
    const fd = new FormData();
    fd.append("file", file, file.name || "ic.pdf");
    return api.post(`${appPath(track, applicationId)}?mode=${encodeURIComponent(mode)}`, fd,
      { timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  // `blob` is the browser-stamped signed PDF; `signerName` is the typed name
  // shown on the stamp. The signer's identity is recorded server-side from the
  // session, not from this payload.
  sign: (track, applicationId, blob, signerName, fileName = "ic-signed.pdf", documentId) => {
    const fd = new FormData();
    fd.append("file", blob, fileName);
    fd.append("signer_name", signerName);
    if (documentId) fd.append("document_id", documentId);
    return api.post(`${appPath(track, applicationId)}/signature`, fd,
      { timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  fileUrl: (track, applicationId, variant = "original", documentId) =>
    api.get(`${appPath(track, applicationId)}/file` +
            `?variant=${encodeURIComponent(variant)}` +
            (documentId ? `&document_id=${encodeURIComponent(documentId)}` : "")),

  // Supersedes (never deletes) one document; the file stays for audit.
  remove: (track, applicationId, documentId) =>
    api.del(`${appPath(track, applicationId)}/documents/${encodeURIComponent(documentId)}`),
};
