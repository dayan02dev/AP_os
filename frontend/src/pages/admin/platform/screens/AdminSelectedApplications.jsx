// AdminSelectedApplications — the single "Selected Applications" tab.
//
// Replaces the old TIR Selected + VIP Selected pair. Both tracks now sit in one
// list (a TRACK chip per row says which), because the work at this stage is the
// same either way: read the shortlist, attach the Investment Committee memo,
// approve it.
//
// Each application gets exactly two actions on the right:
//
//   [ Memo Upload ] upload the Investment Committee / MOM PDF
//   [ Approve ]     draw or type a signature; it is stamped into that PDF
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
import { icDocumentsApi } from "../../../../lib/icDocumentsApi";
import { stampSignature, formatSignedAt } from "../../../../lib/pdfSign";
import { relabelDisplayId, trackLabel } from "../../../../lib/trackLabel.js";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState } from "../ui.jsx";

const MODAL_STYLES = `
  @keyframes osModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const MAX_MB = 10;
const keyOf = (track, id) => `${track}:${id}`;
// IC documents are keyed by the NATIVE track (where the application row lives),
// while a row's displayed track is the EFFECTIVE one. For a moved app those
// differ, so every IC read/write goes through nativeOf().
const nativeOf = (s) => (s?.nativeTrack || s?.track);

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

function IcUploadModal({ app, existing, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const pick = (f) => {
    setErr(null);
    if (!f) { setFile(null); return; }
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
    if (!isPdf) { setFile(null); setErr("Only PDF files are accepted."); return; }
    if (f.size > MAX_MB * 1024 * 1024) {
      setFile(null); setErr(`That file is ${(f.size / 1048576).toFixed(1)} MiB — the limit is ${MAX_MB} MiB.`);
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file || saving) return;
    setSaving(true); setErr(null);
    try {
      await icDocumentsApi.upload(nativeOf(app), app.id, file);
      onDone();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Upload failed. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="os-modal-backdrop" onClick={onClose} style={backdropStyle}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={panelStyle(520)}>
        <div className="os-modal-head" style={headStyle}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>Memo Upload</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="os-text-sm os-text-soft">
            Upload the Investment Committee memo (MOM) for <strong>{app.name}</strong>. PDF only, up to {MAX_MB} MiB.
          </div>
          {existing && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", background: "var(--bg-soft)", padding: "8px 12px", borderRadius: 4 }}>
              Replacing <strong>{existing.file_name}</strong>
              {existing.signed ? " — its signature will be archived with it." : "."}
              {" "}The previous version is kept for audit.
            </div>
          )}
          <input
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Memo PDF"
            onChange={(e) => pick(e.target.files?.[0] || null)}
          />
          {file && (
            <div className="os-mono os-text-sm">
              {file.name} · {(file.size / 1048576).toFixed(2)} MiB
            </div>
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
              disabled={!file || saving}
            >
              {saving ? "Uploading…" : "Upload"}
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

// ── Approve (sign memo) modal ──────────────────────────────────────────────────────

function IcSignModal({ app, doc, defaultName, signerEmail, onClose, onDone }) {
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

  const submit = async () => {
    if (!canSign) return;
    setBusy(true); setErr(null);
    try {
      // 1. Pull the original PDF through a short-lived signed URL.
      const { url } = await icDocumentsApi.fileUrl(nativeOf(app), app.id, "original");
      const res = await fetch(url);
      if (!res.ok) throw new Error("Couldn't download the IC document to sign.");
      const original = await res.arrayBuffer();

      // 2. Stamp it in the browser.
      const signatureDataUrl = hasDrawing && canvasRef.current
        ? canvasRef.current.toDataURL("image/png")
        : null;
      const blob = await stampSignature(original, {
        signatureDataUrl,
        signerName: name.trim(),
        signerEmail,
        signedAtIso: new Date().toISOString(),
      });

      // 3. Store the signed copy; the backend stamps the real signer identity.
      const base = (doc?.file_name || "ic.pdf").replace(/\.pdf$/i, "");
      await icDocumentsApi.sign(nativeOf(app), app.id, blob, name.trim(), `${base}-signed.pdf`);
      onDone();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Signing failed. Try again.");
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
              {app.name} · {doc?.file_name}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {doc?.signed && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", background: "var(--bg-soft)", padding: "8px 12px", borderRadius: 4 }}>
              Already approved by <strong>{doc.signer_name}</strong> on {formatSignedAt(doc.signed_at)}. Approving again replaces that signature.
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
export function AdminSelectedApplications({ goDetail } = {}) {
  const { user } = useAuth();
  const pipeline = useAdminData("pipeline", { status: "jury_review" });
  const docs = useAdminData("icDocuments");

  const [search, setSearch] = useStickyState("admin.selected", "search", "");
  // Both tracks share the list; this narrows it. Filtering happens on the
  // EFFECTIVE track (what the row claims to be) — the server's `track` filter
  // keys off the NATIVE track, so a moved app would land in the wrong bucket.
  const [track, setTrack] = useStickyState("admin.selected", "track", "all");
  const [uploadFor, setUploadFor] = useState(null);
  const [signFor, setSignFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [linkErr, setLinkErr] = useState(null);

  const byKey = docs.data?.byKey || {};

  const all = pipeline.data?.startups ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((s) => track === "all" || s.track === track)
      .filter((s) => !q || `${s.name || ""} ${s.domain || ""} ${(s.founders || []).join(" ")}`
        .toLowerCase().includes(q));
  }, [all, search, track]);

  const reload = () => { docs.reload(); pipeline.reload(); };

  const view = async (app, variant) => {
    setLinkErr(null);
    try {
      const { url } = await icDocumentsApi.fileUrl(nativeOf(app), app.id, variant);
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
        sub="Shortlisted TIR and VIP applications. Upload the Investment Committee memo and approve it."
      />

      <div className="os-row gap-sm" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input
          className="os-input"
          aria-label="Search selected applications"
          placeholder="Search project, founder or industry…"
          style={{ minWidth: 240, fontSize: 13 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="lp-track-group" style={{ display: "flex", background: "var(--bg-soft)", padding: 3, borderRadius: 2, border: "1px solid var(--line)" }}>
          {[["all", "All tracks"], ["tir", "TIR"], ["sip", "VIP"]].map(([v, label]) => (
            <button
              key={v}
              className={`lp-track-btn${track === v ? " active" : ""}`}
              aria-pressed={track === v}
              onClick={() => setTrack(v)}
              style={{
                background: track === v ? "#fff" : "transparent",
                border: "none", height: 30, padding: "0 14px", cursor: "pointer",
                fontFamily: "var(--font-sans)", fontSize: 13,
                fontWeight: track === v ? 600 : 500,
                color: track === v ? "var(--ink)" : "var(--ink-soft)",
                borderRadius: 4,
                boxShadow: track === v ? "0 1px 3px rgba(36,36,36,0.08)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="os-mono os-text-sm os-text-dim" style={{ marginLeft: "auto" }}>
          {rows.length}{pipeline.data ? ` of ${all.length}` : ""}
        </span>
      </div>

      {notice && <div className="os-text-sm os-text-soft os-mb-lg">{notice}</div>}
      {linkErr && (
        <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4, marginBottom: 12 }}>{linkErr}</div>
      )}

      {pipeline.loading ? (
        <LoadingState label="Loading selected applications…" />
      ) : pipeline.error ? (
        <ErrorState error={pipeline.error} onRetry={pipeline.reload} />
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
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const doc = byKey[keyOf(nativeOf(s), s.id)];
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="startup">
                        {goDetail ? (
                          <a
                            className="nm"
                            style={{ cursor: "pointer" }}
                            onClick={() => goDetail(s.id, s.track, "jury_selected")}
                          >
                            {s.name}
                          </a>
                        ) : s.name}
                        <small>
                          {relabelDisplayId(s.applicationId || "") || s.founders?.[0] || "—"}
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
                      ) : !doc ? (
                        <span className="os-text-soft os-text-sm">Not uploaded</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <a
                            className="nm"
                            style={{ cursor: "pointer", fontSize: 12.5 }}
                            onClick={() => view(s, "original")}
                          >
                            {doc.file_name || "Memo"}
                          </a>
                          {doc.signed ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span className="os-chip purple" style={{ fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
                                ✓ APPROVED
                              </span>
                              <span className="os-text-soft" style={{ fontSize: 11 }}>
                                {doc.signer_name} · {formatSignedAt(doc.signed_at)}
                              </span>
                              <a
                                className="nm"
                                style={{ cursor: "pointer", fontSize: 11 }}
                                onClick={() => view(s, "signed")}
                              >
                                view approved
                              </a>
                            </span>
                          ) : (
                            <span className="os-text-soft" style={{ fontSize: 11 }}>Not approved</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="os-btn sm secondary" onClick={() => setUploadFor(s)}>
                          {doc ? "Replace Memo" : "Memo Upload"}
                        </button>
                        <button
                          className="os-btn sm"
                          style={doc ? { background: "#3213b7", color: "#fff" } : undefined}
                          disabled={!doc}
                          title={doc ? "" : "Upload the memo first"}
                          onClick={() => setSignFor(s)}
                        >
                          {doc?.signed ? "Re-approve" : "Approve"}
                        </button>
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
          existing={byKey[keyOf(nativeOf(uploadFor), uploadFor.id)]}
          onClose={() => setUploadFor(null)}
          onDone={() => {
            setUploadFor(null);
            setNotice(`Memo uploaded for ${uploadFor.name}.`);
            reload();
          }}
        />
      )}

      {signFor && byKey[keyOf(nativeOf(signFor), signFor.id)] && (
        <IcSignModal
          app={signFor}
          doc={byKey[keyOf(nativeOf(signFor), signFor.id)]}
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
    </div>
  );
}

export default AdminSelectedApplications;
