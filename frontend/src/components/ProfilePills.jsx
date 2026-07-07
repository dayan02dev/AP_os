// ProfilePills — two "green-forward" status pills shown above the AI summary on
// the reviewer & admin screens. Present = soft-green + clickable (résumé → signed
// download via onOpenResume; LinkedIn → opens the profile); absent = muted + inert.
//
// The résumé pill's "present" state is driven by metadata (resume_file_id), not by
// the file's bytes existing in storage — so a download can still fail (e.g. the
// object was lost). We surface that inline instead of failing silently, mirroring
// FileGridAnswer's error copy.

import { useState } from "react";
import "../styles/profile-pills.css";

function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function resumeErrorMessage(err) {
  const code = err?.details?.code || err?.code;
  if (code === "file_not_available") return "Résumé isn't in storage.";
  if (code === "file_not_found") return "Résumé isn't linked to this application.";
  return "Couldn't open the résumé. Try again.";
}

export default function ProfilePills({ resumeFile, linkedinUrl, onOpenResume }) {
  const hasResume = Boolean(resumeFile && resumeFile.storage_path);
  const liHref = normalizeUrl(linkedinUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleResume = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onOpenResume();
    } catch (err) {
      setError(resumeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-pills">
      {hasResume ? (
        <span className="pp-slot">
          <button
            type="button"
            className="pp-pill pp-on"
            disabled={busy}
            aria-busy={busy ? "true" : undefined}
            onClick={handleResume}
          >
            {busy ? "Résumé…" : "Résumé ✓"}
          </button>
          {error && <span className="pp-error" role="alert">{error}</span>}
        </span>
      ) : (
        <span className="pp-pill pp-off">Résumé —</span>
      )}
      {liHref ? (
        <a
          className="pp-pill pp-on"
          href={liHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          LinkedIn ✓
        </a>
      ) : (
        <span className="pp-pill pp-off">LinkedIn —</span>
      )}
    </div>
  );
}
