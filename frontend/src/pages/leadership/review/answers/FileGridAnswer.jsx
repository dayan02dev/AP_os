// FileGridAnswer — renders a list of file objects as a 2-col grid of cards.
//
// Accepts:
//   - an array of file objects (TIR evidence_files, SIP sip_traction_files,
//     execution_milestone_files, sip_patents_files, etc.)
//   - a single file object (SIP sip_pitch_deck, sip_cap_table_file)
// File shape (best-effort across wizards):
//   { name | original_filename | filename, size | size_bytes | file_size_bytes,
//     storage_path | path, mime_type }
//
// Download: each file's button calls the injected `signedUrl` prop
// (applicationId, storagePath) => Promise<{url}> to get a short-lived signed
// URL, then opens it in a new tab. The signing function is injected by the
// caller (e.g. ReviewApplicationPage passes leadershipApi.fileSignedUrl) so
// this component is reusable across reviewer and admin surfaces.
// The backend allow-lists the path against the application's own files before
// signing — the frontend never constructs storage URLs itself.

import { useCallback, useState } from "react";
import EmptyAnswer from "./EmptyAnswer.jsx";

function readableSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n = n / 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function nameOf(file) {
  return (
    file?.name ||
    file?.original_filename ||
    file?.filename ||
    file?.path ||
    file?.storage_path ||
    "(unnamed file)"
  );
}
function sizeOf(file) {
  return file?.size ?? file?.size_bytes ?? file?.file_size_bytes ?? null;
}
function pathOf(file) {
  return file?.storage_path || file?.path || null;
}

export default function FileGridAnswer({ value, applicationId, signedUrl }) {
  // Per-file UI state keyed by the file's grid index:
  //   busy[idx]  → request in flight (button disabled, "Opening…")
  //   error[idx] → inline error message
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});

  const handleDownload = useCallback(
    async (file, idx) => {
      const storagePath = pathOf(file);
      if (!applicationId || !storagePath) {
        setErrors((e) => ({
          ...e,
          [idx]: "This file can't be downloaded (missing reference).",
        }));
        return;
      }
      setErrors((e) => ({ ...e, [idx]: null }));
      setBusy((b) => ({ ...b, [idx]: true }));
      try {
        const res = await signedUrl(applicationId, storagePath);
        const url = res?.url;
        if (!url) throw new Error("No download URL returned.");
        // Open in a new tab — the signed URL points straight at storage and
        // the browser handles the download per the object's content type.
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        const code = err?.details?.code || err?.code;
        let msg;
        if (code === "file_not_available") {
          msg = "File isn't in storage (never uploaded).";
        } else if (code === "file_not_found") {
          msg = "This file isn't linked to the application.";
        } else {
          msg =
            err?.details?.message || err?.message || "Couldn't get the file. Try again.";
        }
        setErrors((e) => ({ ...e, [idx]: msg }));
      } finally {
        setBusy((b) => ({ ...b, [idx]: false }));
      }
    },
    [applicationId, signedUrl],
  );

  let files = [];
  if (Array.isArray(value)) {
    files = value.filter(Boolean);
  } else if (value && typeof value === "object") {
    files = [value];
  }
  if (files.length === 0) return <EmptyAnswer />;

  return (
    <ul className="ans-files" role="list">
      {files.map((f, idx) => {
        const hasPath = Boolean(pathOf(f));
        const isBusy = Boolean(busy[idx]);
        const err = errors[idx];
        return (
          <li key={pathOf(f) || idx} className="ans-file">
            <span className="meta">
              <span className="name">{nameOf(f)}</span>
              <span className="size">{readableSize(sizeOf(f))}</span>
              {err && (
                <span className="ans-file-error" role="alert">
                  {err}
                </span>
              )}
            </span>
            <button
              type="button"
              className="dl"
              disabled={isBusy || !hasPath || !applicationId || !signedUrl}
              aria-disabled={isBusy || !hasPath || !applicationId || !signedUrl ? "true" : undefined}
              aria-busy={isBusy ? "true" : undefined}
              title={
                hasPath ? "Download this file" : "No downloadable file reference."
              }
              onClick={() => handleDownload(f, idx)}
            >
              {isBusy ? "Opening…" : "Download ↓"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
