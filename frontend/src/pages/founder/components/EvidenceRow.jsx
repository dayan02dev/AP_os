// One AIR lever's qualifying-document evidence: the required upload at the
// claimed level, plus optional backfill uploads for lower levels the
// catalog also defines a document for.
//
// Presentational only, matching AirBar.jsx / LeverPanel.jsx: no founderApi
// import, everything reported upward through onUpload/onDelete/onDownload,
// everything framework-specific (lever name, document names, which levels
// exist) taken from `lever` and `documents` — both server-owned. The wizard
// (a later task) owns fetching, including turning onDownload's id into an
// actual signed-URL download the way FounderMou.jsx already does.
//
// `lever.required_document` is only ever null when `lever.claimed_level` is
// null (see air_query.assessment_bundle) — i.e. no level has been claimed
// yet. Rendering a file input in that state would let a founder submit a
// request the backend always 422s (`no_document_required`), so the empty
// state below is the *only* thing that state renders.
//
// Evidence rows carry `air_level`. The required slot only ever shows rows
// at exactly `lever.claimed_level`; each backfill slot only shows rows at
// its own catalog level. Nothing is ever listed against the wrong slot,
// per the brief: "file each under its own level rather than listing them
// all against the required one."
import { useRef, useState } from "react";

function formatSize(bytes) {
  if (bytes == null) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// One (lever, air_level) slot: whatever evidence is already on file at that
// exact level, plus the upload control that targets it. `level` is always a
// concrete number by the time this renders — the caller (EvidenceRow below)
// resolves it, so this component never has to guess which level an upload
// belongs to. That is also why `onUpload` is called as `onUpload(level, file)`
// rather than the file alone: a backfill upload targets a level below the
// claimed one, and the level has to travel with the file for the caller to
// know which slot it came from.
function EvidenceSlot({ level, rows, disabled, onUpload, onDelete, onDownload }) {
  const inputRef = useRef(null);
  const hasRows = rows.length > 0;

  const pick = () => inputRef.current?.click();
  const handleFile = (f) => {
    if (!f) return;
    onUpload(level, f);
    // Reset so re-picking the same filename still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="fj-evidence-slot">
      {rows.map((row) => (
        <div className="fj-evidence-file" key={row.id}>
          <span className="fj-evidence-filename">{row.filename}</span>
          <span className="fj-evidence-meta">
            {formatSize(row.size_bytes)}
            {row.uploaded_at && ` · ${new Date(row.uploaded_at).toLocaleDateString()}`}
          </span>
          <div className="fj-evidence-actions">
            {/* Download stays enabled even when the round is read-only — a
                founder must always be able to retrieve their own documents,
                including after they've submitted. Only upload and delete
                lock. */}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDownload(row.id)}>
              Download
            </button>
            <button
              type="button"
              className="btn btn-sm btn-destructive"
              disabled={disabled}
              onClick={() => onDelete(row.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="fj-evidence-upload">
        <button type="button" className="btn btn-sm btn-ghost" disabled={disabled} onClick={pick}>
          {hasRows ? "Replace" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          aria-label={`Upload AIR ${level} evidence`}
          disabled={disabled}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

export default function EvidenceRow({ lever, documents, disabled, onUpload, onDelete, onDownload }) {
  const [expanded, setExpanded] = useState(false);
  const requiredLevel = lever.claimed_level;
  const requiredDoc = lever.required_document;
  const evidence = lever.evidence || [];

  // Catalog levels below the claimed one that actually define a document.
  // Sourced from `documents` (bundle.catalog.documents[lever]) rather than
  // walking 1..claimed_level, so a level the catalog leaves undefined (a
  // deliberate gap, e.g. supply_chain has none at 1/3/5/7) never renders an
  // empty row.
  const backfillLevels =
    requiredLevel == null
      ? []
      : Object.keys(documents || {})
          .map(Number)
          .filter((lvl) => lvl < requiredLevel)
          .sort((a, b) => a - b);

  return (
    <div className="fj-evidence-row">
      <div className="fj-evidence-head">
        <span className="fj-evidence-lever-name">{lever.name}</span>
        {requiredDoc != null && <span className="fj-evidence-doc-name">{requiredDoc}</span>}
      </div>

      {requiredDoc == null ? (
        <div className="fj-evidence-empty">
          The qualifying document is named once this lever's questions are answered.
        </div>
      ) : (
        <EvidenceSlot
          level={requiredLevel}
          rows={evidence.filter((e) => e.air_level === requiredLevel)}
          disabled={disabled}
          onUpload={onUpload}
          onDelete={onDelete}
          onDownload={onDownload}
        />
      )}

      {backfillLevels.length > 0 && (
        <div className="fj-evidence-backfill">
          <button
            type="button"
            className="fj-evidence-backfill-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="fj-evidence-backfill-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
            Optional backfill documents
          </button>
          {expanded && (
            <div className="fj-evidence-backfill-body">
              {backfillLevels.map((lvl) => (
                <div className="fj-evidence-backfill-item" key={lvl}>
                  <div className="fj-evidence-backfill-item-head">
                    <span className="fj-evidence-backfill-level">AIR {lvl}</span>
                    <span className="fj-evidence-optional-tag">Optional</span>
                    <span className="fj-evidence-doc-name">{documents[lvl]}</span>
                  </div>
                  <EvidenceSlot
                    level={lvl}
                    rows={evidence.filter((e) => e.air_level === lvl)}
                    disabled={disabled}
                    onUpload={onUpload}
                    onDelete={onDelete}
                    onDownload={onDownload}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
