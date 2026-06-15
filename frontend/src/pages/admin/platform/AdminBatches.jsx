// AdminBatches — Batches CRUD (Task 20)
//
// Manage cohort batches. Fetches GET /admin/platform/batches
// (adminPlatformApi.getBatches → { batches: [{ id, name, phase, created_at,
// updated_at }] }) and supports:
//   • New batch  → createBatch({ name, phase }), then reload.
//   • Rename inline (name + phase) → renameBatch(id, { name, phase }), reload.
//
// Assigning applications to a batch is driven from the Pipeline screen's bulk
// action — this surface only CRUDs the batch records. If the payload ever
// carries an app count per batch we surface it; otherwise that column is
// omitted rather than faked.
//
// Every field access is guarded. Reload (via a `rev` bump) after every
// mutation so the list stays in sync.

import { useCallback, useState } from "react";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "./ui.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 10);
}

// Some payloads carry an application count under one of a few likely keys.
function batchCount(b) {
  const c = b?.application_count ?? b?.app_count ?? b?.count;
  return typeof c === "number" ? c : null;
}

export default function AdminBatches() {
  const [rev, setRev] = useState(0);
  const { data, loading, error } = useAsync(
    () => adminPlatformApi.getBatches(),
    [rev],
  );
  const reload = useCallback(() => setRev((n) => n + 1), []);

  const batches = Array.isArray(data) ? data : data?.batches ?? [];
  const anyCount = batches.some((b) => batchCount(b) !== null);

  // ── New-batch form ────────────────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newPhase, setNewPhase] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Inline rename ─────────────────────────────────────────────────────────
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPhase, setEditPhase] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [note, setNote] = useState(null); // {kind, text}

  const createNew = async () => {
    if (creating || !newName.trim()) return;
    setCreating(true);
    setNote(null);
    try {
      await adminPlatformApi.createBatch({
        name: newName.trim(),
        phase: newPhase.trim() || undefined,
      });
      setNewName("");
      setNewPhase("");
      setNote({ kind: "ok", text: "Batch created." });
      reload();
    } catch (e) {
      setNote({ kind: "error", text: `Create failed: ${e?.message || e}` });
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (b) => {
    setEditId(b?.id);
    setEditName(b?.name ?? "");
    setEditPhase(b?.phase ?? "");
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditPhase("");
  };

  const saveEdit = async (id) => {
    if (savingEdit || !editName.trim()) return;
    setSavingEdit(true);
    setNote(null);
    try {
      await adminPlatformApi.renameBatch(id, {
        name: editName.trim(),
        phase: editPhase.trim() || undefined,
      });
      cancelEdit();
      setNote({ kind: "ok", text: "Batch updated." });
      reload();
    } catch (e) {
      setNote({ kind: "error", text: `Rename failed: ${e?.message || e}` });
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="dash-scroll">
      <style>{BATCHES_CSS}</style>

      <div className="pl-head">
        <div>
          <div className="dash-section-tag">A · BATCHES</div>
          <div className="dash-card-title">Cohort batches</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            Group applications into batches. Assign apps from the Pipeline
            screen.
          </div>
        </div>
      </div>

      {/* New batch */}
      <div className="bat-newbar">
        <input
          className="os-input"
          placeholder="New batch name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createNew();
          }}
          style={{ minWidth: 200 }}
        />
        <input
          className="os-input"
          placeholder="Phase (optional)"
          value={newPhase}
          onChange={(e) => setNewPhase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createNew();
          }}
          style={{ minWidth: 160 }}
        />
        <button
          className="os-btn"
          style={{ background: "var(--accent)", color: "#fff" }}
          onClick={createNew}
          disabled={creating || !newName.trim()}
        >
          {creating ? "Creating…" : "New batch"}
        </button>
      </div>

      {note && (
        <div className={"pl-note " + (note.kind === "error" ? "is-error" : "is-ok")}>
          <span>{note.text}</span>
          <button
            className="pl-note-x"
            onClick={() => setNote(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading batches…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : batches.length === 0 ? (
        <EmptyState label="No batches yet. Create one above." />
      ) : (
        <div className="pl-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phase</th>
                {anyCount && <th className="num">Apps</th>}
                <th>Created</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const editing = editId === b?.id;
                const count = batchCount(b);
                return (
                  <tr key={b?.id}>
                    <td>
                      {editing ? (
                        <input
                          className="os-input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                          {b?.name ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="os-text-soft">
                      {editing ? (
                        <input
                          className="os-input"
                          value={editPhase}
                          onChange={(e) => setEditPhase(e.target.value)}
                          placeholder="Phase"
                          style={{ width: "100%" }}
                        />
                      ) : (
                        b?.phase ?? "—"
                      )}
                    </td>
                    {anyCount && (
                      <td className="num">
                        {count !== null ? count : "—"}
                      </td>
                    )}
                    <td className="os-mono os-text-sm os-text-soft">
                      {fmtDate(b?.created_at)}
                    </td>
                    <td>
                      {editing ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="os-btn sm"
                            style={{ background: "var(--accent)", color: "#fff" }}
                            onClick={() => saveEdit(b.id)}
                            disabled={savingEdit || !editName.trim()}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            className="os-btn sm ghost"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="os-btn sm secondary"
                          onClick={() => startEdit(b)}
                        >
                          Rename
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const BATCHES_CSS = `
.adm-portal .pl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.adm-portal .pl-table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; }
.adm-portal .bat-newbar {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding:12px 14px; border:1px solid var(--line); border-radius:4px;
  background:var(--bg-soft, #f7f7f7); margin-bottom:12px;
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
