import { useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ResumeUploadCard({
  resumeFileId,
  resumeFilename,
  resumeSize,
  onUpload,
  onRemove,
}) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const pick = () => inputRef.current?.click();

  const handleFile = (file) => {
    setError("");
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!isPdf) {
      setError("PDF only — please choose a .pdf file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Max 5 MB — please shrink the PDF or split into pages.");
      return;
    }
    onUpload(file);
  };

  if (resumeFileId) {
    return (
      <div className="resume-card resume-card-filled">
        <div className="resume-card-row">
          <span className="resume-card-name">{resumeFilename || "Resume on file"}</span>
          {typeof resumeSize === "number" && (
            <span className="resume-card-size">{formatSize(resumeSize)}</span>
          )}
        </div>
        <div className="resume-card-actions">
          <button type="button" className="btn-secondary" onClick={pick}>Replace</button>
          <button type="button" className="btn-ghost" onClick={onRemove}>Remove</button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Upload resume"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {error && <div className="resume-card-error" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="resume-card resume-card-empty">
      <button type="button" className="resume-card-dropzone" onClick={pick}>
        Drop a PDF or click to choose
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload resume"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <div className="resume-card-error" role="alert">{error}</div>}
    </div>
  );
}
