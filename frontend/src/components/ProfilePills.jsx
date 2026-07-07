// ProfilePills — two "green-forward" status pills shown above the AI summary on
// the reviewer & admin screens. Present = soft-green + clickable (résumé → signed
// download via onOpenResume; LinkedIn → opens the profile); absent = muted + inert.

import "../styles/profile-pills.css";

function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export default function ProfilePills({ resumeFile, linkedinUrl, onOpenResume }) {
  const hasResume = Boolean(resumeFile && resumeFile.storage_path);
  const liHref = normalizeUrl(linkedinUrl);

  return (
    <div className="profile-pills">
      {hasResume ? (
        <button
          type="button"
          className="pp-pill pp-on"
          onClick={(e) => { e.stopPropagation(); onOpenResume(); }}
        >
          Résumé ✓
        </button>
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
