// SIP-specific input components.
//
// Wraps the existing TIR `QuestionInput` switch with SIP-only kinds:
//   captable          → CapTableInput (founders + % shares, sums to 100)
//   sipPitchDeck      → single-PDF upload via /sip-applications/me/evidence-files?kind=pitch-deck
//   sipCapTableFile   → single PDF/XLS upload via kind=cap-table
//   sipPatents        → multi-file upload via kind=patents
//   sipTractionFiles  → multi-file upload via kind=traction
//   milestoneFiles    → reuses /sip-applications/me/milestone-files
// Stateless presentational components (ShortInput, LongInput, …) are reused
// from the TIR inputs.jsx — only track-specific kinds live here.

import { useRef, useState } from "react";
import {
  ShortInput,
  EmailQuestionInput,
  LongInput,
  SingleInput,
  MultiInput,
  DeclarationsInput,
  TeamInviteInput,
} from "./inputs.jsx";
import { ApiError, apiCall } from "./lib/api.js";
import { validateEmail } from "./validators.jsx";

const PHONE_VALID_RE = /^\+?[\d\s\-()]{7,}$/;

// ─────────────────────────────────────────────────────────────
// CapTableInput — founders / shareholders with % shares.
// Mirrors the Remix prototype; auto-validates totals to ~100%.

function CapTableInput({ q, value, onChange }) {
  const entries = Array.isArray(value) ? value : [];
  const maxEntries = q.maxEntries || 12;
  const types = q.types || [
    "Founder",
    "Co-founder",
    "Advisor",
    "Employee pool (ESOP)",
    "Investor",
    "Other",
  ];

  const addEntry = (type = "Founder") => {
    if (entries.length >= maxEntries) return;
    const next = [
      ...entries,
      {
        id: "cap" + Date.now() + Math.floor(Math.random() * 999),
        name: "",
        type,
        share: "",
      },
    ];
    onChange(next);
  };

  const updateEntry = (idx, patch) => {
    const next = entries.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange(next);
  };

  const removeEntry = (idx) => {
    const next = entries.filter((_, i) => i !== idx);
    onChange(next);
  };

  const totalShare = entries.reduce((sum, e) => {
    const v = parseFloat(e.share);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  const totalRounded = Math.round(totalShare * 100) / 100;
  const totalStatus =
    Math.abs(totalRounded - 100) < 0.01
      ? "ok"
      : totalRounded > 100
        ? "over"
        : "under";

  return (
    <div className="eir-captable">
      {entries.length === 0 && (
        <div className="eir-captable-empty">
          <div className="eir-captable-empty-icon eir-mono">▦</div>
          <p className="eir-captable-empty-title">No entries yet</p>
          <p className="eir-captable-empty-sub">
            Add each shareholder one at a time. Numbering is automatic.
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <ul className="eir-captable-list">
          {entries.map((e, idx) => (
            <li key={e.id || idx} className="eir-captable-row">
              <span className="eir-captable-num eir-mono">
                {(idx + 1).toString().padStart(2, "0")}
              </span>
              <input
                className="eir-input eir-captable-name"
                type="text"
                placeholder="Name or entity"
                value={e.name || ""}
                onChange={(ev) => updateEntry(idx, { name: ev.target.value })}
              />
              <select
                className="eir-input eir-captable-type"
                value={e.type || "Founder"}
                onChange={(ev) => updateEntry(idx, { type: ev.target.value })}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="eir-captable-share-wrap">
                <input
                  className="eir-input eir-captable-share"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="0"
                  value={e.share || ""}
                  onChange={(ev) =>
                    updateEntry(idx, { share: ev.target.value })
                  }
                />
                <span className="eir-captable-pct eir-mono">%</span>
              </div>
              <button
                type="button"
                className="eir-captable-remove"
                onClick={() => removeEntry(idx)}
                title="Remove entry"
              >
                <span className="eir-mono">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="eir-captable-actions">
        <button
          type="button"
          className="eir-captable-add"
          onClick={() => addEntry()}
          disabled={entries.length >= maxEntries}
        >
          <span className="eir-mono">+</span> add entry
        </button>
        {entries.length > 0 && (
          <div
            className={`eir-captable-total eir-mono eir-captable-total-${totalStatus}`}
          >
            total: {totalRounded.toFixed(2)}%
            {totalStatus === "ok" && (
              <span className="eir-captable-total-tick"> ✓</span>
            )}
            {totalStatus === "over" && (
              <span className="eir-captable-total-warn"> · over 100%</span>
            )}
            {totalStatus === "under" && (
              <span className="eir-captable-total-warn">
                {" "}
                · {(100 - totalRounded).toFixed(2)}% unallocated
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DpiitInput — "Is your startup DPIIT registered?" A Yes/No choice that, when
// "Yes" is picked, reveals the recognition number + recognition date inline on
// the same page (one question, one screen — matches Raghu's spec).
//
// Value shape: { registered: "Yes …" | "No …", number: string, date: string }.
//
// NOTE: frontend-only for now. There's no sip_dpiit_* column yet, so the
// wizard holds this answer in AppSip's local-only channel — nothing is PATCHed
// to /sip-applications. See LOCAL_ONLY_IDS in AppSip.jsx.

const DPIIT_OPTIONS = ["Yes — we're DPIIT recognised", "No — not yet"];

function DpiitInput({ q, value, onChange }) {
  const v = value && typeof value === "object" ? value : {};
  const registered = v.registered || "";
  const isYes = registered.startsWith("Yes");
  // A recognition date can't be in the future — cap the picker at today.
  const todayStr = new Date().toISOString().slice(0, 10);

  const pick = (opt) => {
    // Clear the detail fields when switching to "No" so stale values don't
    // linger if the applicant flips back and forth.
    if (opt.startsWith("No")) onChange({ registered: opt, number: "", date: "" });
    else onChange({ ...v, registered: opt });
  };

  return (
    <div className="eir-dpiit">
      <div className="eir-options">
        {DPIIT_OPTIONS.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const selected = registered === opt;
          return (
            <button
              key={opt}
              type="button"
              className={`eir-option ${selected ? "is-selected" : ""}`}
              onClick={() => pick(opt)}
            >
              <span className="eir-option-key">{letter}</span>
              <span className="eir-option-label">{opt}</span>
              <span className="eir-option-check">{selected ? "●" : "○"}</span>
            </button>
          );
        })}
      </div>

      {isYes && (
        <div className="eir-dpiit-details">
          <div className="eir-dpiit-field">
            <label className="eir-mono eir-link-label" htmlFor="dpiit-number">
              DPIIT recognition number
            </label>
            <input
              id="dpiit-number"
              type="text"
              className="eir-input"
              placeholder="e.g. DIPP123456"
              value={v.number || ""}
              onChange={(e) => onChange({ ...v, number: e.target.value })}
              autoFocus
            />
          </div>
          <div className="eir-dpiit-field">
            <label className="eir-mono eir-link-label" htmlFor="dpiit-date">
              Recognition date
            </label>
            <input
              id="dpiit-date"
              type="date"
              className="eir-input eir-dpiit-date"
              max={todayStr}
              value={v.date || ""}
              onChange={(e) => onChange({ ...v, date: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Single-file evidence slot (pitch deck / cap-table file).
// Backed by /sip-applications/me/evidence-files?kind=<k>. The backend stores
// the file metadata in the corresponding sip_pitch_deck / sip_cap_table_file
// JSONB column (single object, not an array).

function SingleEvidenceInput({ q, value, onChange, kind, applicationId }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const file = value && typeof value === "object" ? value : null;
  const maxBytes = (q.maxMB || 25) * 1024 * 1024;

  const upload = async (f) => {
    if (!f) return;
    if (f.size > maxBytes) {
      setErr(`${f.name} exceeds the ${q.maxMB || 25} MB limit.`);
      return;
    }
    setErr(null);
    setBusy(true);
    const extra = applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : "";
    try {
      const fd = new FormData();
      fd.append("file", f);
      const result = await apiCall(
        `/sip-applications/me/evidence-files?kind=${encodeURIComponent(kind)}${extra}`,
        { method: "POST", body: fd, timeoutMs: 60_000 },
      );
      // Backend returns { ok, kind, file, value }. `value` is the new
      // single-file metadata; fall back to `file` and the column key for
      // forward-compat.
      const colMap = {
        "pitch-deck": "sip_pitch_deck",
        "cap-table": "sip_cap_table_file",
      };
      const col = colMap[kind];
      const next = result?.value || result?.file || result?.[col] || null;
      onChange(next);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "too_large") setErr(`${f.name} exceeds the size limit.`);
        else if (e.code === "unsupported_media")
          setErr(`${f.name} — file type not allowed.`);
        else if (e.code === "application_locked")
          setErr("Application is already submitted.");
        else setErr(e.message || "Upload failed.");
      } else {
        setErr(e?.message || "Upload failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!file?.file_uuid || busy) return;
    setBusy(true);
    setErr(null);
    const extra = applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : "";
    try {
      const result = await apiCall(
        `/sip-applications/me/evidence-files/${encodeURIComponent(file.file_uuid)}?kind=${encodeURIComponent(kind)}${extra}`,
        { method: "DELETE" },
      );
      const colMap = {
        "pitch-deck": "sip_pitch_deck",
        "cap-table": "sip_cap_table_file",
      };
      const col = colMap[kind];
      // Delete returns { ok, kind, value: null }. Prefer value, fall back
      // to the column key, default to null.
      onChange(result?.value ?? result?.[col] ?? null);
    } catch (e) {
      setErr(e?.message || "Couldn't remove file.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  return (
    <div className="eir-filedrop-wrap">
      <div
        className={`eir-filedrop ${dragOver ? "is-drag" : ""} ${file ? "has-file" : ""} ${busy ? "is-disabled" : ""}`}
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={q.accept}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
          disabled={busy}
        />
        <div className="eir-filedrop-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <rect x="6" y="4" width="20" height="24" />
            <path d="M16 12 V24 M10 18 L16 12 L22 18" />
          </svg>
        </div>
        <div className="eir-filedrop-main">
          {busy
            ? "Uploading…"
            : file
              ? "Replace file (drop a new one or click)"
              : "Drop file here, or click to browse"}
        </div>
        <div className="eir-filedrop-meta eir-mono">
          {(q.accept || ".pdf").replace(/\./g, "")} · max {q.maxMB || 25} MB
        </div>
      </div>
      {err && (
        <div
          className="eir-mono eir-block-reason"
          style={{ marginTop: 10 }}
        >
          ↳ {err}
        </div>
      )}
      {file && (
        <div className="eir-file-list">
          <div className="eir-file-row">
            <span className="eir-mono eir-file-ok">✓</span>
            <span className="eir-file-name">{file.name}</span>
            <span className="eir-mono eir-dim">
              {Math.round((file.size || 0) / 1024)} KB
            </span>
            {file.file_uuid && (
              <button
                className="eir-file-x"
                onClick={remove}
                disabled={busy}
                title="Remove"
              >
                {busy ? "…" : "✕"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Multi-file evidence slot (patents / traction).
// Stored in sip_patents_files / sip_traction_files JSONB array columns.

function MultiEvidenceInput({ q, value, onChange, kind, applicationId }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(null);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const files = Array.isArray(value) ? value : [];
  const maxFiles = q.maxFiles || 5;
  const maxBytes = (q.maxMB || 10) * 1024 * 1024;
  const remaining = maxFiles - files.length;

  const colMap = {
    patents: "sip_patents_files",
    traction: "sip_traction_files",
  };
  const col = colMap[kind];

  // The evidence-files router returns { ok, kind, file, value: <new array> }
  // — `value` is the authoritative new list. We also fall back to the
  // column key and `files` for forward-compat in case the API shape ever
  // changes.
  const pickList = (result, prev) => {
    if (Array.isArray(result?.value)) return result.value;
    if (Array.isArray(result?.[col])) return result[col];
    if (Array.isArray(result?.files)) return result.files;
    return prev;
  };

  const upload = async (incoming) => {
    setErr(null);
    if (busy) return;
    const list = Array.from(incoming || []).slice(0, remaining);
    if (list.length === 0) return;
    const extra = applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : "";
    let latest = files;
    for (const f of list) {
      if (f.size > maxBytes) {
        setErr(`${f.name} exceeds ${q.maxMB || 10} MB.`);
        continue;
      }
      setBusy(true);
      setBusyFor("upload");
      try {
        const fd = new FormData();
        fd.append("file", f);
        const result = await apiCall(
          `/sip-applications/me/evidence-files?kind=${encodeURIComponent(kind)}${extra}`,
          { method: "POST", body: fd, timeoutMs: 60_000 },
        );
        latest = pickList(result, latest);
        onChange(latest);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "file_cap_reached")
            setErr(`You can attach at most ${maxFiles} files.`);
          else if (e.code === "too_large")
            setErr(`${f.name} exceeds the size limit.`);
          else if (e.code === "unsupported_media")
            setErr(`${f.name} — file type not allowed.`);
          else if (e.code === "application_locked")
            setErr("Application is already submitted.");
          else setErr(e.message || "Upload failed.");
        } else {
          setErr(e?.message || "Upload failed.");
        }
        break;
      } finally {
        setBusy(false);
        setBusyFor(null);
      }
    }
  };

  const remove = async (file_uuid) => {
    if (!file_uuid || busy) return;
    setErr(null);
    setBusy(true);
    setBusyFor(file_uuid);
    const extra = applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : "";
    try {
      const result = await apiCall(
        `/sip-applications/me/evidence-files/${encodeURIComponent(file_uuid)}?kind=${encodeURIComponent(kind)}${extra}`,
        { method: "DELETE" },
      );
      onChange(pickList(result, files.filter((f) => f.file_uuid !== file_uuid)));
    } catch (e) {
      setErr(e?.message || "Couldn't remove file.");
    } finally {
      setBusy(false);
      setBusyFor(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (remaining > 0 && !busy) upload(e.dataTransfer.files);
  };

  return (
    <div className="eir-filedrop-wrap">
      <div
        className={`eir-filedrop ${dragOver ? "is-drag" : ""} ${files.length ? "has-file" : ""} ${remaining === 0 || busy ? "is-disabled" : ""}`}
        onDragOver={(e) => {
          if (remaining === 0 || busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (remaining > 0 && !busy) inputRef.current?.click();
        }}
        style={
          remaining === 0 || busy
            ? { opacity: 0.6, cursor: "not-allowed" }
            : undefined
        }
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={q.accept}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
          disabled={remaining === 0 || busy}
        />
        <div className="eir-filedrop-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <rect x="6" y="4" width="20" height="24" />
            <path d="M16 12 V24 M10 18 L16 12 L22 18" />
          </svg>
        </div>
        <div className="eir-filedrop-main">
          {busyFor === "upload"
            ? "Uploading…"
            : remaining === 0
              ? `${maxFiles} of ${maxFiles} files attached`
              : `Drop files here, or click to browse · ${remaining} of ${maxFiles} slots left`}
        </div>
        <div className="eir-filedrop-meta eir-mono">
          {(q.accept || ".pdf").replace(/\./g, "")} · max {q.maxMB || 10} MB each
        </div>
      </div>
      {err && (
        <div
          className="eir-mono eir-block-reason"
          style={{ marginTop: 10 }}
        >
          ↳ {err}
        </div>
      )}
      {files.length > 0 && (
        <div className="eir-file-list">
          {files.map((f, i) => {
            const isBusyHere = busy && busyFor === f.file_uuid;
            return (
              <div
                key={f.file_uuid || `legacy-${i}`}
                className="eir-file-row"
              >
                <span className="eir-mono eir-file-ok">✓</span>
                <span className="eir-file-name">{f.name}</span>
                <span className="eir-mono eir-dim">
                  {Math.round((f.size || 0) / 1024)} KB
                </span>
                {f.file_uuid ? (
                  <button
                    className="eir-file-x"
                    onClick={() => remove(f.file_uuid)}
                    disabled={busy}
                    title="Remove"
                  >
                    {isBusyHere ? "…" : "✕"}
                  </button>
                ) : (
                  <span className="eir-mono eir-dim" title="legacy entry">
                    —
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Milestone files — same backend semantics as TIR but at /sip-applications/*

function SipMilestoneFilesInput({ q, value, onChange, applicationId }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(null);
  const [err, setErr] = useState(null);

  const files = Array.isArray(value) ? value : [];
  const maxFiles = q.maxFiles || 3;
  const maxBytes = (q.maxMB || 5) * 1024 * 1024;
  const remaining = maxFiles - files.length;

  const handleFiles = async (fileList) => {
    setErr(null);
    if (busy) return;
    const incoming = Array.from(fileList || []).slice(0, remaining);
    if (incoming.length === 0) return;
    const q_param = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : "";
    let latest = files;
    for (const f of incoming) {
      if (f.size > maxBytes) {
        setErr(`${f.name} exceeds ${q.maxMB || 5} MB.`);
        continue;
      }
      setBusy(true);
      setBusyFor("upload");
      try {
        const fd = new FormData();
        fd.append("file", f);
        const result = await apiCall(
          `/sip-applications/me/milestone-files${q_param}`,
          { method: "POST", body: fd, timeoutMs: 60_000 },
        );
        latest = result.files || result.execution_milestone_files || latest;
        onChange(latest);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "file_cap_reached")
            setErr(`You can attach at most ${maxFiles} files.`);
          else if (e.code === "too_large")
            setErr(`${f.name} exceeds the size limit.`);
          else if (e.code === "unsupported_media")
            setErr(`${f.name} — file type not allowed.`);
          else if (e.code === "application_locked")
            setErr("Application is already submitted.");
          else setErr(e.message || "Upload failed.");
        } else {
          setErr(e?.message || "Upload failed.");
        }
        break;
      } finally {
        setBusy(false);
        setBusyFor(null);
      }
    }
  };

  const removeFile = async (file_uuid) => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    setBusyFor(file_uuid);
    const q_param = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : "";
    try {
      const result = await apiCall(
        `/sip-applications/me/milestone-files/${encodeURIComponent(file_uuid)}${q_param}`,
        { method: "DELETE" },
      );
      onChange(result.files || result.execution_milestone_files || []);
    } catch (e) {
      setErr(e?.message || "Couldn't remove file.");
    } finally {
      setBusy(false);
      setBusyFor(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (remaining > 0 && !busy) handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="eir-filedrop-wrap">
      <div
        className={`eir-filedrop ${dragOver ? "is-drag" : ""} ${files.length ? "has-file" : ""} ${remaining === 0 || busy ? "is-disabled" : ""}`}
        onDragOver={(e) => {
          if (remaining === 0 || busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (remaining > 0 && !busy) inputRef.current?.click();
        }}
        style={
          remaining === 0 || busy
            ? { opacity: 0.6, cursor: "not-allowed" }
            : undefined
        }
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={q.accept}
          onChange={(e) => handleFiles(e.target.files)}
          disabled={remaining === 0 || busy}
        />
        <div className="eir-filedrop-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <rect x="6" y="4" width="20" height="24" />
            <path d="M16 12 V24 M10 18 L16 12 L22 18" />
          </svg>
        </div>
        <div className="eir-filedrop-main">
          {busyFor === "upload"
            ? "Uploading…"
            : remaining === 0
              ? `${maxFiles} of ${maxFiles} files attached`
              : `Drop files here, or click to browse · ${remaining} of ${maxFiles} slots left`}
        </div>
        <div className="eir-filedrop-meta eir-mono">
          {(q.accept || ".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg").replace(
            /\./g,
            "",
          )}{" "}
          · max {q.maxMB || 5} MB each
        </div>
      </div>
      {err && (
        <div
          className="eir-mono eir-block-reason"
          style={{ marginTop: 10 }}
        >
          ↳ {err}
        </div>
      )}
      {files.length > 0 && (
        <div className="eir-file-list">
          {files.map((f) => {
            const isBusyHere = busy && busyFor === f.file_uuid;
            return (
              <div key={f.file_uuid} className="eir-file-row">
                <span className="eir-mono eir-file-ok">✓</span>
                <span className="eir-file-name">{f.name}</span>
                <span className="eir-mono eir-dim">
                  {Math.round((f.size || 0) / 1024)} KB
                </span>
                <button
                  className="eir-file-x"
                  onClick={() => removeFile(f.file_uuid)}
                  disabled={busy}
                  title="Remove"
                >
                  {isBusyHere ? "…" : "✕"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Wired switch — same shape as the TIR QuestionInput, with SIP kinds.

export function SipQuestionInput(props) {
  switch (props.q.kind) {
    case "short":
      return <ShortInput {...props} />;
    case "email":
      return <EmailQuestionInput {...props} />;
    case "long":
      return <LongInput {...props} />;
    case "single":
      return <SingleInput {...props} />;
    case "multi":
      return <MultiInput {...props} />;
    case "declarations":
      return <DeclarationsInput {...props} />;
    case "teamInvite":
      return <TeamInviteInput {...props} />;
    case "captable":
      return <CapTableInput {...props} />;
    case "dpiit":
      return <DpiitInput {...props} />;
    case "sipPitchDeck":
      return <SingleEvidenceInput {...props} kind="pitch-deck" />;
    case "sipCapTableFile":
      return <SingleEvidenceInput {...props} kind="cap-table" />;
    case "sipPatents":
      return <MultiEvidenceInput {...props} kind="patents" />;
    case "sipTractionFiles":
      return <MultiEvidenceInput {...props} kind="traction" />;
    case "milestoneFiles":
      return <SipMilestoneFilesInput {...props} />;
    default:
      return <div>unknown: {props.q.kind}</div>;
  }
}

export function isAnsweredSip(q, value) {
  if (q.optional) return true;
  switch (q.kind) {
    case "short":
      if (!(value && value.trim().length > 0)) return false;
      if (q.id === "phone" && !PHONE_VALID_RE.test(value.trim())) return false;
      return true;
    case "email":
      return !!(
        value &&
        value.trim().length > 0 &&
        validateEmail(value).valid
      );
    case "long":
      return !!(value && value.trim());
    case "single": {
      if (!value) return false;
      const opts = q.options || [];
      const isOther = opts.some(
        (o) => /(?:^|[\s/])Other\s*$/i.test(o) && (value === o || value.startsWith(`${o}:`))
      );
      if (isOther) {
        const colonIdx = value.indexOf(":");
        return colonIdx > 0 && value.slice(colonIdx + 1).trim().length > 0;
      }
      return true;
    }
    case "multi":
      return Array.isArray(value) && value.length > 0;
    case "declarations":
      return q.items
        .filter((i) => i.key !== "newsletter")
        .every((i) => value && value[i.key]);
    case "teamInvite":
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.some(
        (m) => m && m.email && m.fullName && m.phone && m.org,
      );
    case "captable": {
      if (!Array.isArray(value) || value.length === 0) return false;
      const allFilled = value.every(
        (e) =>
          e &&
          e.name &&
          e.name.trim() &&
          e.share !== undefined &&
          e.share !== "" &&
          !isNaN(parseFloat(e.share)),
      );
      if (!allFilled) return false;
      const total = value.reduce(
        (sum, e) => sum + (parseFloat(e.share) || 0),
        0,
      );
      return Math.abs(total - 100) < 0.01;
    }
    case "dpiit": {
      if (!value || typeof value !== "object" || !value.registered) return false;
      // "Yes" requires both the recognition number and date; "No" stands alone.
      if (value.registered.startsWith("Yes")) {
        return !!(value.number && value.number.trim() && value.date);
      }
      return true;
    }
    case "sipPitchDeck":
    case "sipCapTableFile":
      return !!(value && (value.file_uuid || value.name));
    case "sipPatents":
    case "sipTractionFiles":
    case "milestoneFiles":
      return true; // all optional or backend-validated
    default:
      return false;
  }
}

export function whyBlockedSip(q, value) {
  if (q.optional) return null;
  switch (q.kind) {
    case "short":
      if (!value || !value.trim()) return "this field is required";
      if (q.id === "phone" && !PHONE_VALID_RE.test(value.trim()))
        return "enter a valid phone number (digits only)";
      return null;
    case "email":
      if (!value || !value.trim()) return "this field is required";
      if (!validateEmail(value).valid)
        return "enter a valid email like name@domain.com";
      return null;
    case "long":
      if (!value || !value.trim()) return "please write your response to continue";
      return null;
    case "single":
      return value ? null : "pick one option";
    case "multi":
      return Array.isArray(value) && value.length > 0
        ? null
        : "pick at least one option";
    case "declarations": {
      const missing = q.items.filter(
        (i) => i.key !== "newsletter" && !(value && value[i.key]),
      );
      if (missing.length === 0) return null;
      return `tick the ${missing.length} remaining box${missing.length > 1 ? "es" : ""} to submit`;
    }
    case "teamInvite": {
      if (!Array.isArray(value) || value.length === 0)
        return "add at least one co-founder";
      const complete = value.some(
        (m) => m && m.email && m.fullName && m.phone && m.org,
      );
      return complete
        ? null
        : "complete email, name, phone and organization for at least one co-founder";
    }
    case "captable": {
      if (!Array.isArray(value) || value.length === 0)
        return "add at least one shareholder entry";
      const incomplete = value.some(
        (e) =>
          !e ||
          !e.name ||
          !e.name.trim() ||
          e.share === undefined ||
          e.share === "" ||
          isNaN(parseFloat(e.share)),
      );
      if (incomplete) return "fill name and % share for every entry";
      const total = value.reduce(
        (sum, e) => sum + (parseFloat(e.share) || 0),
        0,
      );
      const totalRounded = Math.round(total * 100) / 100;
      if (totalRounded > 100.01)
        return `total share is ${totalRounded.toFixed(2)}% — must equal 100% exactly`;
      if (totalRounded < 99.99)
        return `total share is ${totalRounded.toFixed(2)}% — ${(100 - totalRounded).toFixed(2)}% still unallocated`;
      return null;
    }
    case "dpiit": {
      if (!value || typeof value !== "object" || !value.registered)
        return "let us know if your startup is DPIIT registered";
      if (value.registered.startsWith("Yes")) {
        if (!value.number || !value.number.trim())
          return "enter your DPIIT recognition number";
        if (!value.date) return "enter your DPIIT recognition date";
      }
      return null;
    }
    case "sipPitchDeck":
      return value && (value.file_uuid || value.name)
        ? null
        : "upload your pitch deck to continue";
    case "sipCapTableFile":
      return value && (value.file_uuid || value.name)
        ? null
        : "upload your cap table to continue";
    default:
      return "answer required";
  }
}
