// Input components for the TIR application

import { useState, useRef, useEffect } from "react";
import { ApiError, apiCall } from "./lib/api.js";
import { EmailInput as EnhancedEmailInput, validateEmail } from "./validators.jsx";

// Phone-number pattern accepted as "valid": at least 7 digits, allows
// +, spaces, dashes, parentheses. Letters are stripped on input so the
// user can't type them in the first place; the regex below is used to
// flag the red-shadow state once the user has typed enough to evaluate.
const PHONE_VALID_RE = /^\+?[\d\s\-()]{7,}$/;

function ShortInput({ q, value, onChange, autoFocus }) {
  const ref = useRef(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);

  const isPhone = q.id === "phone" || q.kind === "phone";
  const isName = q.id === "fullName";

  const handleChange = (raw) => {
    if (isPhone) {
      // Strip anything that isn't a digit, +, space, -, (, ). Keeps the
      // user from typing letters at all rather than telling them off
      // after the fact.
      const cleaned = raw.replace(/[^\d+\-()\s]/g, "");
      onChange(cleaned);
    } else if (isName) {
      // Only allow letters, spaces, hyphens, periods, and apostrophes
      // (covers names like "Dr. Arun Kumar", "O'Brien", "Mary-Jane").
      const cleaned = raw.replace(/[^a-zA-Z\s.\-']/g, "");
      onChange(cleaned);
    } else {
      onChange(raw);
    }
  };

  const text = value || "";
  const phoneInvalid =
    isPhone && touched && text.trim().length > 0 && !PHONE_VALID_RE.test(text);
  const cls = `eir-input${phoneInvalid ? " eir-input-invalid" : ""}`;

  return (
    <input
      ref={ref}
      type={isPhone ? "tel" : "text"}
      inputMode={isPhone ? "tel" : undefined}
      className={cls}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => setTouched(true)}
      placeholder={q.placeholder || "Type your answer…"}
      autoComplete={isPhone ? "tel" : "off"}
      aria-invalid={phoneInvalid || undefined}
    />
  );
}

function EmailQuestionInput({ q, value, onChange, autoFocus }) {
  const ref = useRef(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);

  const text = value || "";
  // Show the red-shadow only after the user has interacted (blur) so we
  // don't shout at them while they're still typing.
  const invalid = touched && text.trim().length > 0 && !validateEmail(text).valid;
  const cls = `eir-input${invalid ? " eir-input-invalid" : ""}`;

  return (
    <input
      ref={ref}
      type="email"
      className={cls}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setTouched(true)}
      placeholder={q.placeholder}
      autoComplete="email"
      aria-invalid={invalid || undefined}
    />
  );
}

function LongInput({ q, value, onChange, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const text = value || "";
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="eir-long-wrap">
      <textarea
        ref={ref}
        className="eir-textarea"
        rows={7}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder || "Take your time…"}
      />
      <div className="eir-word-meter">
        <span className="eir-mono eir-dim">
          {wordCount.toString().padStart(3, "0")} words
        </span>
      </div>
    </div>
  );
}

// Options ending in "Other" (or containing "/ Other") open a text input
// when picked — the free text is encoded as `"<option>: <text>"` and
// decoded back on render. Matches: "Other", "Self-taught / Other",
// "Something else — Other", etc.
function _isOtherOption(opt) {
  return /(?:^|[\s/])Other\s*$/i.test(opt || "");
}

// Return { baseOpt, freeText } for a stored value. If the value exactly
// equals one of the options, baseOpt = that option, freeText = "". If it
// starts with one of the "Other"-flavoured options followed by ":", split.
function _splitOtherValue(value, options) {
  if (!value) return { baseOpt: "", freeText: "" };
  if (options.includes(value)) return { baseOpt: value, freeText: "" };
  for (const opt of options) {
    if (_isOtherOption(opt) && value.startsWith(`${opt}:`)) {
      return { baseOpt: opt, freeText: value.slice(opt.length + 1).trim() };
    }
  }
  // Unknown stored string → leave base empty so the user re-picks.
  return { baseOpt: "", freeText: "" };
}

function SingleInput({ q, value, onChange }) {
  const { baseOpt, freeText } = _splitOtherValue(value, q.options);

  const pick = (opt) => {
    if (_isOtherOption(opt)) {
      // Picking "Other" with no text yet stores just the option so the
      // completion check still sees this field as "filled". As soon as
      // they type, the value becomes "Other: <text>".
      onChange(opt);
    } else {
      onChange(opt);
    }
  };

  const updateFreeText = (text) => {
    const trimmed = text.trim();
    onChange(trimmed ? `${baseOpt}: ${trimmed}` : baseOpt);
  };

  return (
    <div className="eir-options">
      {q.options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const selected = baseOpt === opt;
        return (
          <div key={opt}>
            <button
              type="button"
              className={`eir-option ${selected ? "is-selected" : ""}`}
              onClick={() => pick(opt)}
            >
              <span className="eir-option-key">{letter}</span>
              <span className="eir-option-label">{opt}</span>
              <span className="eir-option-check">{selected ? "●" : "○"}</span>
            </button>
            {selected && _isOtherOption(opt) && (
              <input
                type="text"
                className="eir-input eir-input-other"
                placeholder="Please specify…"
                value={freeText}
                onChange={(e) => updateFreeText(e.target.value)}
                autoFocus
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MultiInput({ q, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (opt) => {
    if (selected.includes(opt)) onChange(selected.filter((o) => o !== opt));
    else onChange([...selected, opt]);
  };
  return (
    <div className="eir-options eir-options-multi">
      {q.options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isOn = selected.includes(opt);
        return (
          <button key={opt} type="button" className={`eir-option ${isOn ? "is-selected" : ""}`} onClick={() => toggle(opt)}>
            <span className="eir-option-key">{letter}</span>
            <span className="eir-option-label">{opt}</span>
            <span className="eir-option-check">{isOn ? "✕" : " "}</span>
          </button>
        );
      })}
      <div className="eir-hint eir-mono">{selected.length} selected · multi-select</div>
    </div>
  );
}

// EvidenceFilesInput — backed by /applications/me/evidence-files. Same
// contract as MilestoneFilesInput: `value` is the JSONB array stored on
// applications.evidence_files; onChange is called with the latest
// server-confirmed list after each upload/delete so the parent stays in
// sync without redundant PATCH writes.
//
// Files go straight to the private 'evidence-files' bucket via the
// backend; admins can sign URLs against it later from the dashboard.
function EvidenceFilesInput({ q, value, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(null);
  const [err, setErr] = useState(null);

  // Defensive: pre-bucket-3 evidence rows hold bare {name,size,type}
  // entries without file_uuid. We render them but don't allow deletion
  // via this UI (no file_uuid to address) — they're frozen artefacts
  // from before storage was wired up.
  const files = Array.isArray(value) ? value : [];
  const maxFiles = q.maxFiles || 5;
  const maxBytes = (q.maxMB || 10) * 1024 * 1024;
  const remaining = maxFiles - files.length;

  const handleFiles = async (fileList) => {
    setErr(null);
    if (busy) return;
    const incoming = Array.from(fileList || []).slice(0, remaining);
    if (incoming.length === 0) return;

    let latest = files;
    for (const f of incoming) {
      if (f.size > maxBytes) {
        setErr(`${f.name} exceeds ${q.maxMB || 10} MiB.`);
        continue;
      }
      setBusy(true);
      setBusyFor("upload");
      try {
        const fd = new FormData();
        fd.append("file", f);
        const result = await apiCall("/applications/me/evidence-files", {
          method: "POST",
          body: fd,
          timeoutMs: 60_000,
        });
        latest = result.files || latest;
        onChange(latest);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "file_cap_reached") setErr(`You can attach at most ${maxFiles} files.`);
          else if (e.code === "too_large") setErr(`${f.name} exceeds the size limit.`);
          else if (e.code === "unsupported_media") setErr(`${f.name} — file type not allowed.`);
          else if (e.code === "application_locked") setErr("Application is already submitted.");
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
    if (!file_uuid || busy) return;
    setErr(null);
    setBusy(true);
    setBusyFor(file_uuid);
    try {
      const result = await apiCall(
        `/applications/me/evidence-files/${encodeURIComponent(file_uuid)}`,
        { method: "DELETE" },
      );
      onChange(result.files || []);
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
        style={remaining === 0 || busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
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
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25">
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
          {(q.accept || ".pdf,.png,.jpg,.jpeg,.doc,.docx").replace(/\./g, "")} · max {q.maxMB || 10} MiB each
        </div>
      </div>
      {err && <div className="eir-mono eir-block-reason" style={{ marginTop: 10 }}>↳ {err}</div>}
      {files.length > 0 && (
        <div className="eir-file-list">
          {files.map((f, i) => {
            const isBusyHere = busy && busyFor === f.file_uuid;
            return (
              <div key={f.file_uuid || `legacy-${i}`} className="eir-file-row">
                <span className="eir-mono eir-file-ok">✓</span>
                <span className="eir-file-name">{f.name}</span>
                <span className="eir-mono eir-dim">{Math.round((f.size || 0) / 1024)} KB</span>
                {f.file_uuid ? (
                  <button
                    className="eir-file-x"
                    onClick={() => removeFile(f.file_uuid)}
                    disabled={busy}
                    title="Remove"
                  >
                    {isBusyHere ? "…" : "✕"}
                  </button>
                ) : (
                  <span className="eir-mono eir-dim" title="legacy entry">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// MilestoneFilesInput — backed by the /applications/me/milestone-files
// endpoints. The `value` prop is the JSONB array stored on the application
// row; onChange is called with the latest server-confirmed list after each
// upload/delete so the parent stays in sync without redundant PATCH writes.
//
// Files go straight to the private 'milestone-files' bucket via the backend
// (multipart upload). No signed-URL dance — for ~3 files × 5 MiB it's
// simpler and the bucket is RLS-locked anyway.
function MilestoneFilesInput({ q, value, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(null); // file_uuid being deleted, or "upload"
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

    let latest = files;
    for (const f of incoming) {
      if (f.size > maxBytes) {
        setErr(`${f.name} exceeds ${q.maxMB || 5} MiB.`);
        continue;
      }
      setBusy(true);
      setBusyFor("upload");
      try {
        const fd = new FormData();
        fd.append("file", f);
        const result = await apiCall("/applications/me/milestone-files", {
          method: "POST",
          body: fd,
          timeoutMs: 60_000,
        });
        latest = result.files || latest;
        onChange(latest);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "file_cap_reached") setErr(`You can attach at most ${maxFiles} files.`);
          else if (e.code === "too_large") setErr(`${f.name} exceeds the size limit.`);
          else if (e.code === "unsupported_media") setErr(`${f.name} — file type not allowed.`);
          else if (e.code === "application_locked") setErr("Application is already submitted.");
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
    try {
      const result = await apiCall(
        `/applications/me/milestone-files/${encodeURIComponent(file_uuid)}`,
        { method: "DELETE" },
      );
      onChange(result.files || []);
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
        style={remaining === 0 || busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
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
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25">
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
          {(q.accept || ".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg").replace(/\./g, "")} · max {q.maxMB || 5} MiB each
        </div>
      </div>
      {err && <div className="eir-mono eir-block-reason" style={{ marginTop: 10 }}>↳ {err}</div>}
      {files.length > 0 && (
        <div className="eir-file-list">
          {files.map((f) => {
            const isBusyHere = busy && busyFor === f.file_uuid;
            return (
              <div key={f.file_uuid} className="eir-file-row">
                <span className="eir-mono eir-file-ok">✓</span>
                <span className="eir-file-name">{f.name}</span>
                <span className="eir-mono eir-dim">{Math.round((f.size || 0) / 1024)} KB</span>
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

function DeclarationsInput({ q, value, onChange }) {
  const v = value || {};
  const toggle = (key) => onChange({ ...v, [key]: !v[key] });
  return (
    <div className="eir-decls">
      {q.items.map((item) => (
        <label key={item.key} className={`eir-decl ${v[item.key] ? "is-on" : ""}`}>
          <input type="checkbox" checked={!!v[item.key]} onChange={() => toggle(item.key)} />
          <span className="eir-decl-box">
            {v[item.key] ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7 L6 11 L12 3" stroke="currentColor" strokeWidth="2" /></svg>
            ) : null}
          </span>
          <span className="eir-decl-label">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

function TeamInviteInput({ q, value, onChange }) {
  const members = Array.isArray(value) ? value : [];
  const maxMembers = q.maxMembers || 3;
  const [draftOpenIdx, setDraftOpenIdx] = useState(null);

  const addMember = () => {
    if (members.length >= maxMembers) return;
    const next = [...members, { id: "m" + Date.now(), email: "", fullName: "", phone: "", org: "", inviteSent: false }];
    onChange(next);
    setDraftOpenIdx(next.length - 1);
  };

  const updateMember = (idx, patch) => {
    const next = members.map((m, i) => i === idx ? { ...m, ...patch } : m);
    onChange(next);
  };

  const removeMember = (idx) => {
    if (!confirm("Remove this co-founder from the invite list?")) return;
    const next = members.filter((_, i) => i !== idx);
    onChange(next);
    if (draftOpenIdx === idx) setDraftOpenIdx(null);
  };

  const sendInvite = (idx) => {
    const m = members[idx];
    const emailCheck = validateEmail(m.email);
    if (!emailCheck.valid) {
      alert("Please enter a valid email for this co-founder first.");
      return;
    }
    updateMember(idx, { inviteSent: true, invitedAt: Date.now() });
  };

  const memberComplete = (m) => !!(m && m.email && m.fullName && m.phone && m.org && validateEmail(m.email).valid);

  return (
    <div className="eir-team-invite">
      {members.length === 0 && (
        <div className="eir-team-empty">
          <div className="eir-team-empty-icon eir-mono">✉ ✉ ✉</div>
          <p className="eir-team-empty-title">No co-founders added yet</p>
          <p className="eir-team-empty-sub">Add up to {maxMembers} co-founders. Each gets an email invite to this application.</p>
        </div>
      )}

      {members.length > 0 && (
        <ul className="eir-team-list">
          {members.map((m, idx) => {
            const isOpen = draftOpenIdx === idx;
            const complete = memberComplete(m);
            const displayName = m.fullName || m.email || `Co-founder ${idx + 1}`;
            return (
              <li key={m.id || idx} className={`eir-team-card ${isOpen ? "is-open" : ""} ${complete ? "is-complete" : ""}`}>
                <button
                  type="button"
                  className="eir-team-card-head"
                  onClick={() => setDraftOpenIdx(isOpen ? null : idx)}
                >
                  <span className="eir-team-card-avatar eir-mono">
                    {(m.fullName || m.email || "?").trim()[0]?.toUpperCase() || "?"}
                  </span>
                  <div className="eir-team-card-headline">
                    <div className="eir-team-card-name">{displayName}</div>
                    <div className="eir-team-card-meta eir-mono">
                      {m.email || <span className="eir-dim">no email yet</span>}
                      {m.org && <> · {m.org}</>}
                    </div>
                  </div>
                  <div className="eir-team-card-badges">
                    {m.inviteSent && <span className="eir-team-badge eir-team-badge-sent eir-mono">✓ invited</span>}
                    {!m.inviteSent && complete && <span className="eir-team-badge eir-team-badge-ready eir-mono">ready</span>}
                    {!complete && <span className="eir-team-badge eir-team-badge-draft eir-mono">incomplete</span>}
                    <span className="eir-team-card-chevron eir-mono">{isOpen ? "−" : "+"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="eir-team-card-body">
                    <div className="eir-team-field">
                      <label className="eir-mono eir-link-label">email address</label>
                      <EnhancedEmailInput
                        value={m.email || ""}
                        onChange={(v) => updateMember(idx, { email: v })}
                        placeholder="cofounder@domain.com"
                        showValidation
                      />
                    </div>
                    <div className="eir-team-field">
                      <label className="eir-mono eir-link-label">full name</label>
                      <input
                        className="eir-input"
                        type="text"
                        value={m.fullName || ""}
                        onChange={(e) => updateMember(idx, { fullName: e.target.value })}
                        placeholder="e.g. Dr. Priya Sharma"
                      />
                    </div>
                    <div className="eir-team-grid2">
                      <div className="eir-team-field">
                        <label className="eir-mono eir-link-label">phone number</label>
                        <input
                          className="eir-input"
                          type="tel"
                          value={m.phone || ""}
                          onChange={(e) => updateMember(idx, { phone: e.target.value })}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                      <div className="eir-team-field">
                        <label className="eir-mono eir-link-label">current organization</label>
                        <input
                          className="eir-input"
                          type="text"
                          value={m.org || ""}
                          onChange={(e) => updateMember(idx, { org: e.target.value })}
                          placeholder="e.g. IISc / Independent"
                        />
                      </div>
                    </div>

                    <div className="eir-team-card-actions">
                      <button
                        type="button"
                        className={`eir-btn ${complete && !m.inviteSent ? "eir-btn-primary" : "eir-btn-disabled"}`}
                        disabled={!complete || m.inviteSent}
                        onClick={() => sendInvite(idx)}
                      >
                        <span>{m.inviteSent ? "Invitation sent ✓" : "Send invitation"}</span>
                        {!m.inviteSent && <span className="eir-btn-key eir-mono">↗</span>}
                      </button>
                      <button
                        type="button"
                        className="eir-link-btn eir-mono eir-team-remove"
                        onClick={() => removeMember(idx)}
                      >
                        remove co-founder
                      </button>
                    </div>

                    {m.inviteSent && (
                      <div className="eir-team-invite-note eir-mono">
                        ↳ invite email queued to {m.email}. they can sign in at any time to collaborate.
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {members.length < maxMembers && (
        <button type="button" className="eir-team-add eir-mono" onClick={addMember}>
          <span className="eir-team-add-plus">+</span>
          <span>add co-founder {members.length > 0 && `(${members.length}/${maxMembers})`}</span>
        </button>
      )}

      <div className="eir-team-foot eir-mono eir-dim">
        <div>↳ one application, shared across your team. only one person edits at a time.</div>
        <div>↳ invited teammates can sign in with the email you provided.</div>
      </div>
    </div>
  );
}

function QuestionInput(props) {
  switch (props.q.kind) {
    case "short": return <ShortInput {...props} />;
    case "email": return <EmailQuestionInput {...props} />;
    case "long": return <LongInput {...props} />;
    case "single": return <SingleInput {...props} />;
    case "multi": return <MultiInput {...props} />;
    case "files": return <EvidenceFilesInput {...props} />;
    case "milestoneFiles": return <MilestoneFilesInput {...props} />;
    case "declarations": return <DeclarationsInput {...props} />;
    case "teamInvite": return <TeamInviteInput {...props} />;
    default: return <div>unknown: {props.q.kind}</div>;
  }
}

function isAnswered(q, value) {
  if (q.optional) return true;
  switch (q.kind) {
    case "short":
      if (!(value && value.trim().length > 0)) return false;
      if (q.id === "phone" && !PHONE_VALID_RE.test(value.trim())) return false;
      return true;
    case "email":
      return !!(value && value.trim().length > 0 && validateEmail(value).valid);
    case "long":
      if (!value || !value.trim()) return false;
      return true;
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
    case "multi": return Array.isArray(value) && value.length > 0;
    case "files":
      if (q.multi) return Array.isArray(value) && value.length > 0;
      return !!value;
    case "milestoneFiles":
      // Always considered "answered" — it's optional per the manager spec.
      // q.optional short-circuits above; this branch is here for symmetry.
      return true;
    case "declarations":
      return q.items.filter(i => i.key !== "newsletter").every(i => value && value[i.key]);
    case "teamInvite":
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.some(m => m && m.email && m.fullName && m.phone && m.org);
    default: return false;
  }
}

function whyBlocked(q, value) {
  if (q.optional) return null;
  switch (q.kind) {
    case "short":
      if (!value || !value.trim()) return "this field is required";
      // Phone fields use kind="short" but get format-validated so the
      // applicant doesn't get to advance with "abc" in the box.
      if (q.id === "phone" && !PHONE_VALID_RE.test(value.trim())) {
        return "enter a valid phone number (digits only)";
      }
      return null;
    case "email":
      if (!value || !value.trim()) return "this field is required";
      if (!validateEmail(value).valid) return "enter a valid email like name@domain.com";
      return null;
    case "long": {
      if (!value || !value.trim()) return "please write your response to continue";
      return null;
    }
    case "single": return value ? null : "pick one option";
    case "multi":
      return (Array.isArray(value) && value.length > 0) ? null : "pick at least one option";
    case "files":
      if (q.multi) return (Array.isArray(value) && value.length > 0) ? null : "upload at least one file";
      return value ? null : "upload a file to continue";
    case "milestoneFiles":
      return null;
    case "declarations": {
      const missing = q.items.filter(i => i.key !== "newsletter" && !(value && value[i.key]));
      if (missing.length === 0) return null;
      return `tick the ${missing.length} remaining box${missing.length > 1 ? "es" : ""} to submit`;
    }
    case "teamInvite": {
      if (!Array.isArray(value) || value.length === 0) return "add at least one co-founder";
      const complete = value.some(m => m && m.email && m.fullName && m.phone && m.org);
      return complete ? null : "complete email, name, phone and organization for at least one co-founder";
    }
    default: return "answer required";
  }
}

export {
  ShortInput, EmailQuestionInput, LongInput, SingleInput, MultiInput,
  EvidenceFilesInput, MilestoneFilesInput, DeclarationsInput, TeamInviteInput,
  QuestionInput, isAnswered, whyBlocked,
};
