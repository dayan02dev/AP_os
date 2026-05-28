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
// Download is a Phase 1.5 capability — the button stays disabled and shows
// a tooltip. We don't construct signed URLs here; that wiring ships next.

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

export default function FileGridAnswer({ value }) {
  let files = [];
  if (Array.isArray(value)) {
    files = value.filter(Boolean);
  } else if (value && typeof value === "object") {
    files = [value];
  }
  if (files.length === 0) return <EmptyAnswer />;

  return (
    <ul className="ans-files" role="list">
      {files.map((f, idx) => (
        <li key={f?.storage_path || f?.path || idx} className="ans-file">
          <span className="meta">
            <span className="name">{nameOf(f)}</span>
            <span className="size">{readableSize(sizeOf(f))}</span>
          </span>
          <span
            className="dl"
            aria-disabled="true"
            title="Download arrives in Phase 1.5 once signed URLs are wired in."
          >
            Download ↓
          </span>
        </li>
      ))}
    </ul>
  );
}
