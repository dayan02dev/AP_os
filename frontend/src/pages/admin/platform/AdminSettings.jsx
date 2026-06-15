// AdminSettings — Restore / housekeeping (Task 20)
//
// Three independent sections, each with its own fetch + states:
//
//   1. Hidden apps    — getPipeline({ include_hidden: true }) filtered to
//                        isHidden. "Unhide" → patchMeta(track, id,
//                        { is_hidden: false }), reload that section.
//   2. Archived apps  — getPipeline({ include_archived: true }) filtered to
//                        isArchived. "Unarchive" → patchMeta(track, id,
//                        { is_archived: false }), reload that section.
//   3. On-hold apps   — getPipeline({ status: "on_hold" }). Each row links to
//                        its detail screen /admin/application/{track}/{id},
//                        where the admin re-decides (shortlist / reject /
//                        waitlist). There is no dedicated "release hold"
//                        endpoint, so we deliberately route to the detail
//                        screen rather than invent one.
//
// Every field access is guarded. Each section reloads independently after a
// mutation via a per-section `rev` bump.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "./ui.jsx";

function rowsOf(data) {
  return data?.applications ?? [];
}

function trackLabel(t) {
  return t === "sip" ? "SIP" : t === "tir" ? "TIR" : t ?? "—";
}

// ─── Hidden apps ──────────────────────────────────────────────────────────
function HiddenSection() {
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev((n) => n + 1), []);
  const { data, loading, error } = useAsync(
    () => adminPlatformApi.getPipeline({ include_hidden: true }),
    [rev],
  );
  const rows = rowsOf(data).filter((r) => r?.isHidden);

  const [busyKey, setBusyKey] = useState(null);
  const [note, setNote] = useState(null);

  const unhide = async (r) => {
    const key = `${r?.track}:${r?.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setNote(null);
    try {
      await adminPlatformApi.patchMeta(r.track, r.id, { is_hidden: false });
      setNote({ kind: "ok", text: `Unhid ${r?.name || r?.applicationId || r?.id}.` });
      reload();
    } catch (e) {
      setNote({ kind: "error", text: `Unhide failed: ${e?.message || e}` });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Section
      tag="Hidden applications"
      sub="Apps hidden from the working pipeline. Unhide to bring them back."
      loading={loading}
      error={error}
      onRetry={reload}
      empty={rows.length === 0}
      emptyLabel="No hidden applications."
      note={note}
      onDismissNote={() => setNote(null)}
    >
      {rows.map((r) => (
        <RestoreRow
          key={`${r?.track}:${r?.id}`}
          row={r}
          actionLabel="Unhide"
          busy={busyKey === `${r?.track}:${r?.id}`}
          onAction={() => unhide(r)}
        />
      ))}
    </Section>
  );
}

// ─── Archived apps ──────────────────────────────────────────────────────────
function ArchivedSection() {
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev((n) => n + 1), []);
  const { data, loading, error } = useAsync(
    () => adminPlatformApi.getPipeline({ include_archived: true }),
    [rev],
  );
  const rows = rowsOf(data).filter((r) => r?.isArchived);

  const [busyKey, setBusyKey] = useState(null);
  const [note, setNote] = useState(null);

  const unarchive = async (r) => {
    const key = `${r?.track}:${r?.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setNote(null);
    try {
      await adminPlatformApi.patchMeta(r.track, r.id, { is_archived: false });
      setNote({ kind: "ok", text: `Unarchived ${r?.name || r?.applicationId || r?.id}.` });
      reload();
    } catch (e) {
      setNote({ kind: "error", text: `Unarchive failed: ${e?.message || e}` });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Section
      tag="Archived applications"
      sub="Apps moved out of the active set. Unarchive to restore them."
      loading={loading}
      error={error}
      onRetry={reload}
      empty={rows.length === 0}
      emptyLabel="No archived applications."
      note={note}
      onDismissNote={() => setNote(null)}
    >
      {rows.map((r) => (
        <RestoreRow
          key={`${r?.track}:${r?.id}`}
          row={r}
          actionLabel="Unarchive"
          busy={busyKey === `${r?.track}:${r?.id}`}
          onAction={() => unarchive(r)}
        />
      ))}
    </Section>
  );
}

// ─── On-hold apps ─────────────────────────────────────────────────────────
function OnHoldSection() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getPipeline({ status: "on_hold" }),
    [],
  );
  const rows = rowsOf(data);

  return (
    <Section
      tag="Applications on hold"
      sub="Held pending a re-decision. Open the detail screen to release the hold."
      loading={loading}
      error={error}
      onRetry={reload}
      empty={rows.length === 0}
      emptyLabel="No applications on hold."
    >
      {rows.map((r) => (
        <div key={`${r?.track}:${r?.id}`} className="set-row">
          <div className="set-row-main">
            <span className="set-row-name">
              {r?.name ?? r?.applicationId ?? r?.id ?? "—"}
            </span>
            <span className="set-row-meta">
              {trackLabel(r?.track)} · {r?.applicationId ?? "—"}
            </span>
          </div>
          <button
            className="os-btn sm secondary"
            disabled={!r?.track || r?.id == null}
            onClick={() => navigate(`/admin/application/${r.track}/${r.id}`)}
          >
            Review / release
          </button>
        </div>
      ))}
    </Section>
  );
}

// ─── Shared row + section shells ────────────────────────────────────────────
function RestoreRow({ row, actionLabel, busy, onAction }) {
  return (
    <div className="set-row">
      <div className="set-row-main">
        <span className="set-row-name">
          {row?.name ?? row?.applicationId ?? row?.id ?? "—"}
        </span>
        <span className="set-row-meta">
          {trackLabel(row?.track)} · {row?.applicationId ?? "—"}
        </span>
      </div>
      <button className="os-btn sm secondary" disabled={busy} onClick={onAction}>
        {busy ? "Working…" : actionLabel}
      </button>
    </div>
  );
}

function Section({
  tag,
  sub,
  loading,
  error,
  onRetry,
  empty,
  emptyLabel,
  note,
  onDismissNote,
  children,
}) {
  return (
    <div className="set-section">
      <div className="set-section-head">
        <div className="dash-card-title" style={{ fontSize: 16 }}>{tag}</div>
        <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>{sub}</div>
      </div>

      {note && (
        <div className={"pl-note " + (note.kind === "error" ? "is-error" : "is-ok")}>
          <span>{note.text}</span>
          <button className="pl-note-x" onClick={onDismissNote} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : empty ? (
        <EmptyState label={emptyLabel} />
      ) : (
        <div className="set-list">{children}</div>
      )}
    </div>
  );
}

export default function AdminSettings() {
  return (
    <div className="dash-scroll">
      <style>{SETTINGS_CSS}</style>

      <div className="pl-head" style={{ marginBottom: 8 }}>
        <div>
          <div className="dash-section-tag">A · SETTINGS</div>
          <div className="dash-card-title">Restore &amp; housekeeping</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            Bring back hidden or archived applications, and review apps on hold.
          </div>
        </div>
      </div>

      <HiddenSection />
      <ArchivedSection />
      <OnHoldSection />
    </div>
  );
}

const SETTINGS_CSS = `
.adm-portal .pl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.adm-portal .set-section {
  border:1px solid var(--line); border-radius:4px; padding:16px 18px;
  margin-top:16px; background:var(--bg-paper, #fff);
}
.adm-portal .set-section-head { margin-bottom:12px; }
.adm-portal .set-list { display:flex; flex-direction:column; }
.adm-portal .set-row {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:10px 0; border-bottom:1px dashed var(--line);
}
.adm-portal .set-row:last-child { border-bottom:none; }
.adm-portal .set-row-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.adm-portal .set-row-name { font-weight:600; color:var(--ink); }
.adm-portal .set-row-meta {
  font-family:var(--font-mono); font-size:11px; color:var(--ink-dim);
}
.adm-portal .pl-note {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans);
  margin-bottom:12px;
}
.adm-portal .pl-note.is-ok { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .pl-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .pl-note-x {
  background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px;
}
`;
