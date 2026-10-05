// AdminSelectedApplications — the single "Selected Applications" tab.
//
// Replaces the old TIR Selected + VIP Selected pair. Both tracks now sit in one
// list (a TRACK chip per row says which), because the work at this stage is the
// same either way: read the shortlist, attach the Investment Committee memo,
// approve it.
//
// Each application gets exactly two actions on the right:
//
//   [ Upload Memos ] upload one or more Investment Committee / MOM PDFs
//                    ("Manage Memos" once some exist: add more, remove some;
//                    the "+ Add document" link under the list opens the same)
//   [ Approve ]     draw or type a signature; it is stamped into every PDF
//   [ Reject ]      final gate-2 rejection — also overturns an earlier offer
//
// The stamp is produced in the browser (lib/pdfSign.js → pdf-lib) and uploaded
// as the signed copy; the backend records WHO signed from the session, so the
// attribution can't be spoofed by the client.
//
// TIR used to render here as AdminPipeline (readOnly, lockTrack="tir") with a
// dozen review-stage columns — reviewer score, reco, batch, status, submitted.
// Those answer "should this advance?", which is already decided by the time an
// application reaches this tab, so they are gone. What is left is what you need
// to identify the application and act on its memo. The full record is still one
// click away: the project name opens the application detail.

import React, { useMemo, useRef, useState } from "react";

import { useAdminData } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { useAuth } from "../../../../hooks/useAuth.jsx";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { icDocumentsApi } from "../../../../lib/icDocumentsApi";
import { stampSignature, formatSignedAt } from "../../../../lib/pdfSign";
import { displayIdText, trackLabel } from "../../../../lib/trackLabel.js";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState } from "../ui.jsx";
import ListToolbar from "./ListToolbar";

const MODAL_STYLES = `
  @keyframes osModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const MAX_MB = 10;
const keyOf = (track, id) => `${track}:${id}`;
// IC documents are keyed by the NATIVE track (where the application row lives),
// while a row's displayed track is the EFFECTIVE one. For a moved app those
// differ, so every IC read/write goes through nativeOf().
const nativeOf = (s) => (s?.nativeTrack || s?.track);

// Row decision state, derived — never stored.
//
// `accepted` means every memo document on this screen has been signed via
// Approve, NOT that Final Gate issued an offer. `rejected` means a gate-2
// rejection (Reject here, or Final Gate). The list only holds shortlisted and
// offered rows, so `rejected` is transient: the row leaves on the next reload
// and shows (red) in the Rejected tab instead. `docs` is the row's document list.
export const decisionStateOf = (app, docs) => {
  if ((app?.gate2_decision || "") === "rejected") return "rejected";
  const list = docListOf(docs);
  if (list.length && list.every((d) => d?.signed)) return "accepted";
  return "pending";
};

function docListOf(docs) {
  if (Array.isArray(docs)) return docs.filter(Boolean);
  return docs ? [docs] : [];
}

const backdropStyle = {
  position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)",
  backdropFilter: "blur(4px)", zIndex: 1000, display: "flex",
  alignItems: "center", justifyContent: "center", animation: "osModalFadeIn 0.2s ease-out",
};
const panelStyle = (maxWidth) => ({
  maxWidth, width: "92vw", background: "var(--bg-paper)",
  border: "1px solid var(--line-strong)", borderRadius: 4,
  boxShadow: "0 20px 60px rgba(36,36,36,0.18)",
});
const headStyle = {
  padding: "16px 24px", borderBottom: "1px solid var(--line)",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};

function openInNewTab(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// ── Memo Upload modal ─────────────────────────────────────────────────────────

function IcUploadModal({ app, existing = [], onClose, onDone, onChanged }) {
  const [files, setFiles] = useState([]);
  const [removeIds, setRemoveIds] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const replacing = existing.length > 0;

  // Adds to the selection (the input is reset each time), so an admin can pick
  // files in several goes. Invalid files are dropped with one message.
  const pick = (list) => {
    setErr(null);
    const bad = [];
    const good = [];
    for (const f of Array.from(list || [])) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
      if (!isPdf) bad.push(`${f.name}: only PDF files are accepted.`);
      else if (f.size > MAX_MB * 1024 * 1024) {
        bad.push(`${f.name} is ${(f.size / 1048576).toFixed(1)} MiB — the limit is ${MAX_MB} MiB.`);
      } else good.push(f);
    }
    if (good.length) setFiles((prev) => [...prev, ...good]);
    if (bad.length) setErr(bad.join(" "));
  };

  const dropFile = (i) => setFiles((prev) => prev.filter((_, j) => j !== i));
  const toggleRemove = (id) => setRemoveIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const dirty = files.length > 0 || removeIds.size > 0;

  const submit = async () => {
    if (!dirty || saving) return;
    setSaving(true); setErr(null);
    // Uploads first: if one fails, nothing has been removed yet.
    let done = 0;
    try {
      for (const f of files) {
        await icDocumentsApi.upload(nativeOf(app), app.id, f, { mode: "append" });
        done += 1;
      }
      for (const id of removeIds) {
        await icDocumentsApi.remove(nativeOf(app), app.id, id);
      }
      onDone();
    } catch (e) {
      const msg = e?.details?.message || e?.message || "Upload failed. Try again.";
      if (done) {
        // Keep only what still needs doing, and refresh the row behind the modal.
        setFiles((prev) => prev.slice(done));
        onChanged?.();
      }
      setErr(msg);
      setSaving(false);
    }
  };

  return (
    <div className="os-modal-backdrop" onClick={onClose} style={backdropStyle}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={panelStyle(560)}>
        <div className="os-modal-head" style={headStyle}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>
            {replacing ? "Manage memo documents" : "Upload memo documents"}
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="os-text-sm os-text-soft">
            Upload the Investment Committee memo documents (MOM) for <strong>{app.name}</strong>.
            {" "}You can add several files. PDF only, up to {MAX_MB} MiB each.
          </div>
          {replacing && (
            <div>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 6 }}>
                Current documents
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {existing.map((d) => {
                  const removing = removeIds.has(d.id);
                  return (
                    <li key={d.id} data-testid={`existing-${d.id}`}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                        fontSize: 12.5, background: "var(--bg-soft)", padding: "6px 10px", borderRadius: 4 }}>
                      <span style={{ textDecoration: removing ? "line-through" : "none",
                        color: removing ? "var(--ink-soft)" : "var(--ink)", wordBreak: "break-all" }}>
                        {d.file_name || "Memo"}{d.signed ? " · approved" : ""}
                      </span>
                      <button className="os-btn ghost sm" type="button"
                        aria-label={`${removing ? "Keep" : "Remove"} ${d.file_name || "memo"}`}
                        onClick={() => toggleRemove(d.id)} disabled={saving}>
                        {removing ? "Undo" : "Remove"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="os-text-xs os-text-dim" style={{ marginTop: 6 }}>
                Removed documents{existing.some((d) => d.signed) ? " (and their signatures)" : ""} are kept for audit.
              </div>
            </div>
          )}
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf"
            aria-label="Memo PDF"
            disabled={saving}
            onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
          />
          <div className="os-text-xs os-text-dim" style={{ marginTop: -8 }}>
            Tip: select several PDFs at once (⌘/Ctrl-click), or choose again to add more.
          </div>
          {files.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="os-mono os-text-sm"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ wordBreak: "break-all" }}>{f.name} · {(f.size / 1048576).toFixed(2)} MiB</span>
                  <button className="os-btn ghost sm" type="button" aria-label={`Drop ${f.name}`}
                    onClick={() => dropFile(i)} disabled={saving}>&times;</button>
                </li>
              ))}
            </ul>
          )}
          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              className="os-btn"
              style={{ background: "#3213b7", color: "#fff" }}
              onClick={submit}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : (files.length > 1 ? `Upload ${files.length} files` : (files.length || !replacing ? "Upload" : "Save"))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Signature pad ───────────────────────────────────────────────────────────

function SignaturePad({ canvasRef, onDrawn }) {
  const drawing = useRef(false);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
      x: (p.clientX - r.left) * (c.width / r.width),
      y: (p.clientY - r.top) * (c.height / r.height),
    };
  };

  const start = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#242424";
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onDrawn();
  };

  return (
    <canvas
      ref={canvasRef}
      width={560}
      height={160}
      aria-label="Signature pad"
      style={{
        width: "100%", height: 160, borderRadius: 8, cursor: "crosshair",
        border: "1px dashed var(--line-strong, #c8c8d0)", background: "#fff", touchAction: "none",
      }}
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
}

// ── Reject (final-gate decision) modal ─────────────────────────────────────────────
// Unlike Approve — which only signs the memo PDFs and leaves status alone — this
// records a real gate-2 decision: -> rejected. It works from jury_review AND
// after an earlier offer / waitlist / hold, so an already-selected candidate
// can still be rejected. Hence the reason box and the confirm step.
function RejectModal({ app, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    const rationale = reason.trim();
    if (!rationale || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // NATIVE track: a TIR application moved to VIP renders here as VIP but
      // lives in tir_applications, and the decision endpoint reads
      // {track}_applications.
      await adminPlatformApi.decideGate2(nativeOf(app), app.id, {
        decision: "rejected",
        rationale,
      });
      onDone();
    } catch (e) {
      const code = e?.details?.code;
      if (code === "already_rejected") {
        setErr("This application has already been rejected. Close this and refresh.");
      } else if (code === "not_rejectable" || code === "not_in_jury_review") {
        setErr(e?.details?.message || "This application can no longer be rejected here. Close this and refresh.");
      } else if (code === "rationale_required") {
        setErr("A reason is required to reject an application.");
      } else {
        setErr(e?.details?.message || e?.message || "Could not reject this application. Try again.");
      }
      setBusy(false);
    }
  };

  return (
    <div className="os-modal-backdrop" onClick={onClose} style={backdropStyle}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={panelStyle(520)}>
        <div className="os-modal-head" style={headStyle}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>Reject application</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="os-text-sm os-text-soft">
            Reject <strong>{app.name}</strong>
            {app.applicationId ? ` (${displayIdText(app.applicationId, app.movedToTrack)})` : ""}. This records a final
            decision and moves the application into <strong>Rejected</strong>
            {app.gate2_decision === "offered" ? ", withdrawing the offer already made" : ""}.
            The applicant is sent the standard decline email.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="os-text-sm" style={{ fontWeight: 600, color: "var(--ink)" }}>
              Reason for rejection
            </span>
            <textarea
              className="os-input"
              aria-label="Reason for rejection"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded on the decision log and the audit trail."
            />
          </label>
          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className="os-btn"
              style={{ background: "#d23b40", color: "#fff" }}
              onClick={submit}
              disabled={!reason.trim() || busy}
            >
              {busy ? "Rejecting…" : "Reject application"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Approve (sign memo) modal ──────────────────────────────────────────────────────

function IcSignModal({ app, docs, defaultName, signerEmail, onClose, onDone }) {
  const canvasRef = useRef(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [name, setName] = useState(defaultName || "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasDrawing(false);
  };

  const canSign = Boolean(name.trim()) && confirmed && !busy;
  const anySigned = docs.some((d) => d.signed);
  const lastSigned = docs.filter((d) => d.signed)
    .sort((a, b) => String(a.signed_at || "").localeCompare(String(b.signed_at || "")))
    .pop();

  const submit = async () => {
    if (!canSign) return;
    setBusy(true); setErr(null);
    // One approval covers the whole memo pack: the same signature is stamped
    // into every current document.
    const signatureDataUrl = hasDrawing && canvasRef.current
      ? canvasRef.current.toDataURL("image/png")
      : null;
    const signedAtIso = new Date().toISOString();
    let current = null;
    try {
      for (const doc of docs) {
        current = doc;
        // 1. Pull the original PDF through a short-lived signed URL.
        const { url } = await icDocumentsApi.fileUrl(nativeOf(app), app.id, "original", doc.id);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Couldn't download ${doc.file_name || "the IC document"} to sign.`);
        const original = await res.arrayBuffer();

        // 2. Stamp it in the browser.
        const blob = await stampSignature(original, {
          signatureDataUrl,
          signerName: name.trim(),
          signerEmail,
          signedAtIso,
        });

        // 3. Store the signed copy; the backend stamps the real signer identity.
        const base = (doc.file_name || "ic.pdf").replace(/\.pdf$/i, "");
        await icDocumentsApi.sign(nativeOf(app), app.id, blob, name.trim(), `${base}-signed.pdf`, doc.id);
      }
      onDone();
    } catch (e) {
      const msg = e?.details?.message || e?.message || "Signing failed. Try again.";
      setErr(docs.length > 1 && current ? `${current.file_name || "A document"}: ${msg}` : msg);
      setBusy(false);
    }
  };

  return (
    <div className="os-modal-backdrop" onClick={onClose} style={backdropStyle}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={panelStyle(620)}>
        <div className="os-modal-head" style={headStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>Approve</div>
            <div className="os-text-xs os-text-soft" style={{ marginTop: 2 }}>
              {app.name} · {docs.length === 1
                ? docs[0].file_name
                : `${docs.length} documents`}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {docs.length > 1 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              Your signature is stamped into every document:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {docs.map((d) => <li key={d.id}>{d.file_name || "Memo"}</li>)}
              </ul>
            </div>
          )}
          {anySigned && lastSigned && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", background: "var(--bg-soft)", padding: "8px 12px", borderRadius: 4 }}>
              Already approved by <strong>{lastSigned.signer_name}</strong> on {formatSignedAt(lastSigned.signed_at)}. Approving again replaces that signature.
            </div>
          )}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 6 }}>
              Draw your signature
            </div>
            <SignaturePad canvasRef={canvasRef} onDrawn={() => setHasDrawing(true)} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span className="os-text-xs os-text-dim">
                Optional — leave blank and your typed name is used as the mark.
              </span>
              <button className="os-btn ghost sm" onClick={clear} disabled={!hasDrawing}>Clear</button>
            </div>
          </div>
          <div>
            <label className="os-text-xs os-text-dim os-uppercase" htmlFor="ic-signer-name" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
              Signed by
            </label>
            <input
              id="ic-signer-name"
              className="os-input os-w-100"
              aria-label="Signer name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              maxLength={200}
            />
          </div>
          <label className="os-text-sm" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              aria-label="Confirm signature"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm this is my signature approving this memo.
          </label>
          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className="os-btn"
              style={{ background: "#3213b7", color: "#fff" }}
              onClick={submit}
              disabled={!canSign}
            >
              {busy ? "Approving…" : "Approve & save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

// No `go` prop: the portal tab strip directly above already carries a Dashboard
// tab, so the in-page "← Dashboard" button was redundant and has been removed.
// `onChanged` lets the portal refresh its tab badges after an upload, approve
// or reject here.
export function AdminSelectedApplications({ goDetail, onChanged } = {}) {
  const { user } = useAuth();
  // Only shortlisted (`jury_review`) rows. A final-round Reject sets the status
  // to `rejected`, so the application leaves this tab for the Rejected tab —
  // it is deliberately NOT fetched back here.
  const pipeline = useAdminData("pipeline", { status: "jury_review" });
  // Offered by Final Gate: still selected candidates, and Reject must still be
  // able to overturn the offer from here, so they stay on this list.
  const offeredPipeline = useAdminData("pipeline", { status: "offered" });
  const docs = useAdminData("icDocuments");

  const [search, setSearch] = useStickyState("admin.selected", "search", "");
  // Both tracks share the list; this narrows it. Filtering happens on the
  // EFFECTIVE track (what the row claims to be) — the server's `track` filter
  // keys off the NATIVE track, so a moved app would land in the wrong bucket.
  const [track, setTrack] = useStickyState("admin.selected", "track", "all");
  const [decisionState, setDecision] = useStickyState("admin.selected", "decision", "all");
  // "Rejected" is no longer an option; a restored sticky value falls back to All.
  const decision = decisionState === "rejected" ? "all" : decisionState;
  const [uploadFor, setUploadFor] = useState(null);
  const [signFor, setSignFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [linkErr, setLinkErr] = useState(null);

  const byKey = docs.data?.byKey || {};
  const listByKey = docs.data?.listByKey;
  // Every current memo document for a row, oldest first.
  const docsFor = (s) => {
    const k = keyOf(nativeOf(s), s.id);
    if (listByKey) return listByKey[k] || [];
    return byKey[k] ? [byKey[k]] : [];
  };

  const all = useMemo(() => {
    const shortlisted = pipeline.data?.startups ?? [];
    const offered = offeredPipeline.data?.startups ?? [];
    const seen = new Set();
    return [...shortlisted, ...offered].filter((s) => {
      const k = keyOf(s.track, s.id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [pipeline.data, offeredPipeline.data]);

  const ORDER = { pending: 0, accepted: 1, rejected: 2 };
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((s) => track === "all" || s.track === track)
      .filter((s) => decision === "all"
        || decisionStateOf(s, docsFor(s)) === decision)
      .filter((s) => !q || `${s.name || ""} ${s.domain || ""} ${(s.founders || []).join(" ")}`
        .toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        const da = ORDER[decisionStateOf(a, docsFor(a))];
        const db = ORDER[decisionStateOf(b, docsFor(b))];
        if (da !== db) return da - db;
        return String(b.sub || "").localeCompare(String(a.sub || ""));
      });
  }, [all, search, track, decision, byKey, listByKey]);

  // Per-decision counts for the filter chips (within the current track).
  const decisionCounts = useMemo(() => {
    const m = { all: 0, pending: 0, accepted: 0 };
    all.filter((s) => track === "all" || s.track === track).forEach((s) => {
      m.all += 1;
      const st = decisionStateOf(s, docsFor(s));
      if (st in m) m[st] += 1;
    });
    return m;
  }, [all, track, byKey, listByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => {
    docs.reload(); pipeline.reload(); offeredPipeline.reload();
    if (onChanged) onChanged();
  };

  const view = async (app, variant, doc) => {
    setLinkErr(null);
    try {
      const { url } = await icDocumentsApi.fileUrl(nativeOf(app), app.id, variant, doc?.id);
      openInNewTab(url);
    } catch (e) {
      setLinkErr(e?.details?.message || e?.message || "Couldn't open that file.");
    }
  };

  return (
    <div className="dash-scroll">
      <style dangerouslySetInnerHTML={{ __html: MODAL_STYLES }} />

      <PageHead
        eyebrow="SELECTED APPLICATIONS"
        title="Selected <em>applications</em>"
        sub="Shortlisted and offered TIR and VIP applications. Upload the Investment Committee memo documents and approve them to accept; a rejected application moves to the Rejected tab."
      />

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchLabel="Search selected applications"
        searchPlaceholder="Search project, founder or industry…"
        segments={[
          { ariaLabel: "Filter by track", value: track, onChange: setTrack,
            options: [["all", "All tracks"], ["tir", "TIR"], ["sip", "VIP"]] },
          { ariaLabel: "Filter by decision", value: decision, onChange: setDecision,
            options: [["all", "All"], ["pending", "Pending"], ["accepted", "Accepted"]]
              .map(([v, label]) => [v, docs.data && pipeline.data && offeredPipeline.data
                ? `${label} ${decisionCounts[v]}` : label]) },
        ]}
        count={pipeline.data && offeredPipeline.data ? rows.length : "…"}
        total={pipeline.data && offeredPipeline.data ? all.length : null}
      />

      {notice && <div className="os-text-sm os-text-soft os-mb-lg">{notice}</div>}
      {linkErr && (
        <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4, marginBottom: 12 }}>{linkErr}</div>
      )}

      {(pipeline.loading || offeredPipeline.loading) ? (
        <LoadingState label="Loading selected applications…" />
      ) : (pipeline.error || offeredPipeline.error) ? (
        <ErrorState error={pipeline.error || offeredPipeline.error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-soft)", border: "1px dashed var(--line)", borderRadius: 4 }}>
          {track === "all"
            ? "No selected applications yet."
            : `No ${trackLabel(track)} applications in this list.`}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="os-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Track</th>
                <th>Industry</th>
                <th className="num">AI score</th>
                <th>Memo</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const rowDocs = docsFor(s);
                const hasDocs = rowDocs.length > 0;
                const allSigned = hasDocs && rowDocs.every((d) => d.signed);
                const signedCount = rowDocs.filter((d) => d.signed).length;
                const lastSigned = rowDocs.filter((d) => d.signed)
                  .sort((a, b) => String(a.signed_at || "").localeCompare(String(b.signed_at || "")))
                  .pop();
                const state = decisionStateOf(s, rowDocs);
                return (
                  <tr key={s.id} data-testid={`row-${s.id}`}
                    className={state === "pending" ? "" : `adm-row-${state}`}>
                    <td>
                      <div className="startup">
                        {goDetail ? (
                          <a
                            className="nm"
                            style={{ cursor: "pointer" }}
                            onClick={() => goDetail(s.id, s.track, "jury_selected",
                              rows.map(r => ({ id: r.id, track: r.track })))}
                          >
                            {s.name}
                          </a>
                        ) : s.name}
                        <small>
                          {displayIdText(s.applicationId, s.movedToTrack) || s.founders?.[0] || "—"}
                          {s.founders?.[0] ? ` · ${s.founders[0]}` : ""}
                        </small>
                      </div>
                    </td>
                    <td>
                      <span
                        className="os-chip"
                        style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                          padding: "2px 8px",
                          background: s.track === "tir" ? "#eef2ff" : "#f3f0fd",
                          border: `1px solid ${s.track === "tir" ? "#c7d2fe" : "#cfc4f5"}`,
                          color: s.track === "tir" ? "#3730a3" : "#5b21b6",
                        }}
                      >
                        {trackLabel(s.track)}
                      </span>
                    </td>
                    <td className="os-text-soft">{s.domain || "—"}</td>
                    <td className="num">
                      {s.ai?.overall != null
                        ? <span style={{ fontWeight: 700 }}>{Number(s.ai.overall).toFixed(1)}</span>
                        : <span className="os-text-soft">—</span>}
                    </td>
                    <td>
                      {docs.loading && !docs.data ? (
                        <span className="os-text-soft os-text-sm">Loading…</span>
                      ) : !hasDocs ? (
                        <span className="os-text-soft os-text-sm">Not uploaded</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {rowDocs.map((d) => (
                            <span key={d.id || d.file_name} style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                              <a
                                className="nm"
                                style={{ cursor: "pointer", fontSize: 12.5 }}
                                onClick={() => view(s, "original", d)}
                              >
                                {d.file_name || "Memo"}
                              </a>
                              {d.signed && rowDocs.length > 1 && (
                                <a
                                  className="nm"
                                  style={{ cursor: "pointer", fontSize: 11 }}
                                  onClick={() => view(s, "signed", d)}
                                >
                                  view approved
                                </a>
                              )}
                            </span>
                          ))}
                          {state !== "rejected" && (
                            <a
                              className="nm"
                              style={{ cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                              onClick={() => setUploadFor(s)}
                            >
                              + Add document
                            </a>
                          )}
                          {allSigned ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span className="os-chip purple" style={{ fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
                                ✓ APPROVED
                              </span>
                              {lastSigned && (
                                <span className="os-text-soft" style={{ fontSize: 11 }}>
                                  {lastSigned.signer_name} · {formatSignedAt(lastSigned.signed_at)}
                                </span>
                              )}
                              {rowDocs.length === 1 && (
                                <a
                                  className="nm"
                                  style={{ cursor: "pointer", fontSize: 11 }}
                                  onClick={() => view(s, "signed", rowDocs[0])}
                                >
                                  view approved
                                </a>
                              )}
                            </span>
                          ) : (
                            <span className="os-text-soft" style={{ fontSize: 11 }}>
                              {signedCount > 0
                                ? `${signedCount} of ${rowDocs.length} approved`
                                : "Not approved"}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`os-chip adm-decision adm-decision-${state}`}
                        data-testid={`decision-${s.id}`}>
                        {state.toUpperCase()}
                      </span>
                      {s.gate2_decision === "offered" && (
                        <div className="os-text-xs os-text-soft" style={{ marginTop: 3 }}>Offered</div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="os-btn sm secondary"
                          disabled={state === "rejected"}
                          title={state === "rejected" ? "This application was rejected" : ""}
                          onClick={() => setUploadFor(s)}>
                          {hasDocs ? "Manage Memos" : "Upload Memos"}
                        </button>
                        <button
                          className="os-btn sm"
                          style={hasDocs && state !== "rejected" ? { background: "#3213b7", color: "#fff" } : undefined}
                          disabled={!hasDocs || state === "rejected"}
                          title={state === "rejected"
                            ? "This application was rejected"
                            : (hasDocs ? "" : "Upload the memo first")}
                          onClick={() => setSignFor(s)}
                        >
                          {allSigned ? "Re-approve" : "Approve"}
                        </button>
                        {/* Deliberately NOT gated on a memo: rejecting an
                            application should not require first uploading a
                            document about it. Hidden once the decision is made. */}
                        {state !== "rejected" && (
                          <button
                            className="os-btn sm"
                            style={{ background: "#fff0f0", color: "#d23b40", borderColor: "#f8c2c4" }}
                            title={s.gate2_decision === "offered"
                              ? "Reject this application — withdraws the offer (final decision)"
                              : "Reject this application (final decision)"}
                            onClick={() => setRejectFor(s)}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {uploadFor && (
        <IcUploadModal
          app={uploadFor}
          existing={docsFor(uploadFor)}
          onClose={() => setUploadFor(null)}
          onChanged={reload}
          onDone={() => {
            setUploadFor(null);
            setNotice(`Memo documents updated for ${uploadFor.name}.`);
            reload();
          }}
        />
      )}

      {signFor && docsFor(signFor).length > 0 && (
        <IcSignModal
          app={signFor}
          docs={docsFor(signFor)}
          defaultName={user?.full_name || user?.email || ""}
          signerEmail={user?.email || undefined}
          onClose={() => setSignFor(null)}
          onDone={() => {
            setSignFor(null);
            setNotice(`Memo approved for ${signFor.name}.`);
            reload();
          }}
        />
      )}

      {rejectFor && (
        <RejectModal
          app={rejectFor}
          onClose={() => setRejectFor(null)}
          onDone={() => {
            setNotice(`${rejectFor.name} rejected.`);
            setRejectFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

export default AdminSelectedApplications;
