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
// `lever.required_document` is null for TWO different reasons, and they need
// different copy:
//   1. No level is claimed yet — the founder has not answered the questions.
//   2. A level IS claimed, but the catalog defines no document at or below
//      it. Real case: supply_chain's lowest document sits at AIR 2 while
//      AIR 1 is reachable, so a venture claiming supply_chain 1 owes nothing.
// Telling case 2 to "answer the questions" is wrong — they already have.
// Either way no file input is rendered: uploading at a level with no
// document 422s `no_document_required` on the backend, so the control would
// be guaranteed to fail.
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

  const definedLevels = Object.keys(documents || {})
    .map(Number)
    .sort((a, b) => a - b);

  // The level whose document is ACTUALLY required. The catalog has gaps —
  // supply_chain defines documents only at 2/4/6/8/9 — and the backend's
  // `required_document` falls back to the highest defined level at or below
  // the claimed one. So a venture claiming supply_chain 5 is required to
  // supply the level-4 document.
  //
  // Backfill must be computed from THIS level, not from `claimed_level`:
  // filtering `lvl < claimed_level` would list level 4 as optional backfill
  // while the very same document is displayed above it as required, so the
  // founder sees one document twice and can upload it to two different
  // levels.
  const resolvedLevel =
    requiredLevel == null
      ? null
      : definedLevels.filter((lvl) => lvl <= requiredLevel).pop() ?? null;

  const backfillLevels =
    resolvedLevel == null
      ? []
      : definedLevels.filter((lvl) => lvl < resolvedLevel);

  return (
    <div className="fj-evidence-row">
      <div className="fj-evidence-head">
        <span className="fj-evidence-lever-name">{lever.name}</span>
        {requiredDoc != null && <span className="fj-evidence-doc-name">{requiredDoc}</span>}
      </div>

      {requiredDoc == null ? (
        <div className="fj-evidence-empty">
          {requiredLevel == null
            ? "The qualifying document is named once this lever's questions are answered."
            : `No qualifying document is defined at or below AIR ${requiredLevel} for this lever — nothing to upload yet.`}
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
