// SipTemplateScreen — offline-template upload step for the SIP wizard.
// Sits between section 01 (Basic Details) and section 02 (Quick gates).
// The applicant either downloads the .docx, fills Q5..Q24 (minus
// Q7/Q22/Q23) offline, uploads the filled file, and continues — or
// skips this step entirely and types in the wizard.

import { useRef, useState } from "react";
import { useSipTemplate } from "../hooks/useSipTemplate.js";

const SIP_TEMPLATE_DOWNLOAD_URL =
  "/templates/ARTPARK_SIP_Application_Template.docx?v=1";

export function SipTemplateScreen({ onContinue, onBack, onTemplateApplied }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);

  const tpl = useSipTemplate({
    onApplied: (result) => {
      const filled = (result?.applied_fields || []).length;
      const skipped = (result?.skipped_fields || []).length;
      const missing = (result?.missing_answers || []).length;
      const parts = [
        `Pre-filled ${filled} field${filled === 1 ? "" : "s"}`,
      ];
      if (skipped) parts.push(`${skipped} kept (you'd already typed them)`);
      if (missing) parts.push(`${missing} couldn't be read — fill them in the wizard`);
      setToast(parts.join(" · "));
      if (onTemplateApplied) {
        try { onTemplateApplied(result); } catch { /* swallow */ }
      }
    },
  });

  const handleFile = (file) => {
    if (!file) return;
    setToast(null);
    tpl.upload(file).catch(() => { /* surfaces via tpl.error */ });
  };

  const status = tpl.template?.parse_status;
  const busy = tpl.uploading || tpl.parsing || tpl.applying;
  const continueLabel =
    status === "completed" ? "Continue" : "Skip — I'll type in the wizard";

  return (
    <div className="eir-screen eir-template-screen">
      <div className="eir-coord eir-mono">
        <span>between 01 and 02</span>
        <span>offline template · optional</span>
      </div>
      <div className="eir-template-screen-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">↳</span>
          <span className="eir-q-index-arrow">→</span>
          <span className="eir-q-optional">optional</span>
        </div>
        <h2 className="eir-q-prompt">Want to type the long answers offline?</h2>
        <p className="eir-q-help">
          Download the VIP Word template, fill the long answers at your
          own pace (Word, Pages, Google Docs — anything that opens
          .docx), then drop it back here and we'll auto-fill those
          fields in the wizard. You'll still review and edit each answer
          before submitting.
        </p>
        <p className="eir-q-help eir-dim" style={{ marginTop: -16 }}>
          ↳ Skip this step entirely if you'd rather type your answers
          directly in the next sections.
        </p>

        <div className="eir-template-block eir-template-block-screen">
          <div className="eir-template-row">
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 1 · download</div>
              <div className="eir-template-blurb">
                Grab the VIP .docx. The questions inside have answer
                markers we use to read your responses — please don't
                delete or rename them.
              </div>
            </div>
            <a
              className="eir-btn eir-btn-ghost eir-template-dl"
              href={SIP_TEMPLATE_DOWNLOAD_URL}
              download
            >
              <span>Download template (.docx)</span>
              <span className="eir-mono">↓</span>
            </a>
          </div>

          <div className="eir-template-row" style={{ marginBottom: 0 }}>
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 2 · upload filled</div>
              <div className="eir-template-blurb">
                Once you've filled it, drop the same file back here.
                We'll read your answers and pre-populate the wizard.
              </div>
            </div>
          </div>

          <div
            className={`eir-filedrop eir-template-drop ${dragOver ? "is-drag" : ""} ${status === "completed" ? "has-file" : ""} ${busy ? "is-disabled" : ""}`}
            onDragOver={(e) => { if (busy) return; e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!busy) handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => { if (!busy) fileInputRef.current?.click(); }}
            style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            <input
              ref={fileInputRef}
              data-testid="sip-template-file-input"
              type="file"
              hidden
              accept=".docx,.pdf"
              onChange={(e) => handleFile(e.target.files[0])}
              disabled={busy}
            />
            {tpl.uploading && (
              <div className="eir-filedrop-main">Uploading filled template…</div>
            )}
            {!tpl.uploading && tpl.parsing && (
              <div className="eir-filedrop-main">Reading your answers…</div>
            )}
            {!tpl.uploading && !tpl.parsing && tpl.applying && (
              <div className="eir-filedrop-main">Pre-filling the wizard…</div>
            )}
            {!busy && status !== "completed" && (
              <>
                <div className="eir-filedrop-main">
                  Drop your filled template here, or <u>click to browse</u>
                </div>
                <div className="eir-filedrop-meta eir-mono">.docx (preferred) or .pdf · max 10 MiB</div>
              </>
            )}
            {!busy && status === "completed" && (
              <div className="eir-file-chip">
                <span className="eir-mono eir-file-ok">✓ parsed</span>
                <span className="eir-file-name">
                  {tpl.template?.original_filename || "template"}
                </span>
                <span className="eir-mono eir-dim">replace ↺</span>
              </div>
            )}
          </div>

          {tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.error?.message || "We couldn't read that template — make sure the answer markers are intact and try again."}
            </div>
          )}
          {status === "failed" && !tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.template?.parse_error || "Parse failed."} You can still continue — the wizard works manually.
            </div>
          )}
          {toast && (
            <div className="eir-mono eir-template-ok">↳ {toast}</div>
          )}
        </div>

        <div className="eir-q-actions">
          {onBack && (
            <button type="button" className="eir-btn eir-btn-ghost" onClick={onBack}>
              <span>← Back</span>
            </button>
          )}
          <button
            type="button"
            className={`eir-btn ${busy ? "eir-btn-disabled" : "eir-btn-primary"}`}
            onClick={onContinue}
            disabled={busy}
          >
            <span>{continueLabel}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}
