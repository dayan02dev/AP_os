// ManageApplicationsDrawer — admin Reviewer Roster "Manage" drawer.
// View a reviewer's assigned applications grouped by batch, bulk-assign new
// applications (multi-select), and bulk-remove assigned ones (select-all and
// select-all-in-batch). Already-reviewed apps are reported skipped, never
// silently orphaned.
//
// Reads:  GET /admin/platform/reviewers/{id}/applications (useAdminData "reviewerApplications")
//         GET /admin/platform/applications               (useAdminData "pipeline", assign picker)
// Writes: POST /admin/platform/reviewers/{id}/applications        (bulk assign)
//         POST /admin/platform/reviewers/{id}/applications/remove (bulk remove)
import React, { useState, useMemo } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";

const RANDOM = "Random allotment";

export function ManageApplicationsDrawer({ reviewer, onClose, onChanged }) {
  const apps = useAdminData("reviewerApplications", { userId: reviewer.id });
  const pipeline = useAdminData("pipeline", {});
  const [selRemove, setSelRemove] = useState(() => new Set());
  const [selAssign, setSelAssign] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const assigned = apps.data?.applications ?? [];
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned]);
  const reviewerBatches = Array.isArray(reviewer.batches)
    ? reviewer.batches.map(b => (typeof b === "string" ? b : b.name))
    : [];

  // Group assigned apps by batch (null → "Random allotment").
  const groups = useMemo(() => {
    const m = new Map();
    for (const a of assigned) {
      const key = a.batch || RANDOM;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
    return Array.from(m.entries()).sort((x, y) => {
      if (x[0] === RANDOM) return 1;
      if (y[0] === RANDOM) return -1;
      return x[0].localeCompare(y[0]);
    });
  }, [assigned]);

  // Candidate apps for assignment (not already assigned), filtered by search.
  const candidates = useMemo(() => {
    const all = (pipeline.data?.startups ?? []).filter(s => !assignedIds.has(s.id));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      `${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q));
  }, [pipeline.data, assignedIds, search]);

  const assignCount = useMemo(
    () => candidates.filter(c => selAssign.has(c.id)).length,
    [candidates, selAssign]);

  const reload = () => { apps.reload(); onChanged && onChanged(); };

  const toggle = (set, setSet, id) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setSet(next);
  };
  const allSelected = assigned.length > 0 && assigned.every(a => selRemove.has(a.id));
  const toggleSelectAll = () =>
    setSelRemove(allSelected ? new Set() : new Set(assigned.map(a => a.id)));
  const toggleBatch = (rows) => {
    const ids = rows.map(r => r.id);
    const allOn = ids.every(id => selRemove.has(id));
    const next = new Set(selRemove);
    ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
    setSelRemove(next);
  };

  const summarize = (results, kind) => {
    const c = {};
    for (const r of results || []) c[r.status] = (c[r.status] || 0) + 1;
    if (kind === "remove") {
      const parts = [];
      if (c.removed) parts.push(`removed ${c.removed}`);
      if (c.skipped_submitted) parts.push(`skipped ${c.skipped_submitted} (already reviewed)`);
      if (c.not_found) parts.push(`${c.not_found} not found`);
      return parts.join(", ") || "no changes";
    }
    const parts = [];
    if (c.created) parts.push(`assigned ${c.created}`);
    if (c.already_assigned) parts.push(`${c.already_assigned} already assigned`);
    if (c.not_a_reviewer) parts.push("not a reviewer");
    if (c.invalid_track) parts.push(`${c.invalid_track} invalid`);
    return parts.join(", ") || "no changes";
  };

  const handleRemoveSelected = async () => {
    const items = assigned
      .filter(a => selRemove.has(a.id))
      .map(a => ({ application_id: a.id, track: a.track }));
    if (!items.length) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await adminPlatformApi.bulkRemoveReviewerApps(reviewer.id, items);
      const skipped = (res?.results || []).filter(r => r.status === "skipped_submitted").length;
      const msg = `Remove: ${summarize(res?.results, "remove")}.`;
      setNotice(skipped > 0 ? { kind: "warn", text: msg } : { kind: "ok", text: msg });
      setSelRemove(new Set());
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Remove failed.");
    } finally { setBusy(false); }
  };

  const handleAssignSelected = async () => {
    const items = candidates
      .filter(c => selAssign.has(c.id))
      .map(c => ({ application_id: c.id, track: c.track }));
    if (!items.length) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await adminPlatformApi.bulkAssignReviewerApps(reviewer.id, items);
      setNotice({ kind: "ok", text: `Assign: ${summarize(res?.results, "assign")}.` });
      setSelAssign(new Set());
      setSearch("");
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
    } finally { setBusy(false); }
  };

  const handleRemoveSingle = async (a) => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await adminPlatformApi.bulkRemoveReviewerApps(
        reviewer.id, [{ application_id: a.id, track: a.track }]);
      const skipped = (res?.results || []).filter(r => r.status === "skipped_submitted").length;
      const msg = `Remove: ${summarize(res?.results, "remove")}.`;
      setNotice(skipped > 0 ? { kind: "warn", text: msg } : { kind: "ok", text: msg });
      setSelRemove(prev => { const n = new Set(prev); n.delete(a.id); return n; });
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Remove failed.");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="os-drawer-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.4)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "flex-end", animation: "osDrawerFadeIn 0.2s ease-out" }}
    >
      <div
        className="os-drawer"
        onClick={e => e.stopPropagation()}
        style={{ width: 760, maxWidth: "92vw", height: "100%", background: "var(--bg-paper)", borderLeft: "1px solid var(--line-strong)", boxShadow: "-10px 0 40px rgba(36,36,36,0.15)", display: "flex", flexDirection: "column", animation: "osDrawerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Manage Applications</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
              Reviewer: <strong>{reviewer.name}</strong>{reviewer.domain ? ` · ${reviewer.domain}` : ""}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Assigned batches (read-only) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600 }}>Assigned Batches:</span>
            {reviewerBatches.length ? reviewerBatches.map(b => (
              <span key={b} className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", fontWeight: 600, padding: "3px 8px" }}>{b}</span>
            )) : <span className="os-text-soft" style={{ fontSize: 13 }}>None</span>}
          </div>

          {/* Assign new applications (multi-select) */}
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600 }}>Assign New Applications</div>
              <button
                className="os-btn"
                style={{ background: "var(--accent)", color: "#fff", flexShrink: 0, whiteSpace: "nowrap" }}
                onClick={handleAssignSelected}
                disabled={busy || assignCount === 0}
              >
                Assign selected ({assignCount})
              </button>
            </div>
            <input
              className="os-input"
              aria-label="Search applications to assign"
              placeholder="Search by name or industry…"
              style={{ width: "100%", minWidth: 0, fontSize: 14, marginBottom: 8 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 4, background: "var(--bg-paper)" }}>
              {candidates.length === 0 ? (
                <div className="os-text-soft" style={{ fontSize: 13, padding: 12 }}>No applications to assign.</div>
              ) : candidates.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    aria-label={`Assign candidate ${c.name}`}
                    checked={selAssign.has(c.id)}
                    onChange={() => toggle(selAssign, setSelAssign, c.id)}
                  />
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="os-text-soft">({c.domain || "—"})</span>
                  <span className="os-text-dim" style={{ marginLeft: "auto" }}>
                    {c.batch && c.batch !== "Unassigned" ? c.batch : "Unassigned"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          {notice && (
            <div style={{
              color: notice.kind === "warn" ? "#92560b" : "var(--ink-soft)",
              fontSize: 13, padding: "8px 12px", borderRadius: 4,
              background: notice.kind === "warn" ? "#fff7e6" : "var(--bg-soft)",
              border: notice.kind === "warn" ? "1px solid #f0c96e" : "none",
            }}>
              {notice.text || notice}
            </div>
          )}

          {/* Assigned applications — bulk remove */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }} className="os-text-xs os-text-dim os-uppercase">
                <input
                  type="checkbox"
                  aria-label="Select all applications"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={assigned.length === 0}
                />
                <span style={{ fontWeight: 600 }}>Assigned Applications ({assigned.length})</span>
              </label>
              <button
                className="os-btn sm"
                style={{ background: "#FF5A5F", borderColor: "#FF5A5F", color: "#fff", flexShrink: 0, whiteSpace: "nowrap" }}
                onClick={handleRemoveSelected}
                disabled={busy || selRemove.size === 0}
              >
                Remove selected ({selRemove.size})
              </button>
            </div>

            {apps.loading ? (
              <div className="os-text-soft" style={{ fontSize: 13, padding: 12 }}>Loading…</div>
            ) : apps.error ? (
              <div style={{ color: "var(--bad)", fontSize: 13, padding: 12 }}>
                Failed to load. <button className="os-btn sm ghost" onClick={apps.reload}>Retry</button>
              </div>
            ) : assigned.length === 0 ? (
              <div className="os-text-soft" style={{ fontSize: 13, padding: 12, border: "1px dashed var(--line)", borderRadius: 4 }}>No applications assigned.</div>
            ) : (
              groups.map(([batchName, rows]) => {
                const ids = rows.map(r => r.id);
                const batchAllOn = ids.every(id => selRemove.has(id));
                return (
                  <div key={batchName} style={{ marginBottom: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        aria-label={`Select all in ${batchName}`}
                        checked={batchAllOn}
                        onChange={() => toggleBatch(rows)}
                      />
                      {batchName === RANDOM
                        ? <span className="os-chip purple">{RANDOM}</span>
                        : <span className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)" }}>{batchName}</span>}
                      <span className="os-text-dim">({rows.length})</span>
                    </label>
                    <table className="os-table">
                      <thead>
                        <tr><th style={{ width: 32 }}></th><th>Project</th><th>Industry</th><th>Status</th><th></th></tr>
                      </thead>
                      <tbody>
                        {rows.map(a => (
                          <tr key={a.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${a.project}`}
                                checked={selRemove.has(a.id)}
                                onChange={() => toggle(selRemove, setSelRemove, a.id)}
                              />
                            </td>
                            <td><div className="startup">{a.project}</div></td>
                            <td className="os-text-soft">{a.industry}</td>
                            <td><span className="os-chip">{a.chip}</span></td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="os-btn sm ghost"
                                style={{ color: "#FF5A5F" }}
                                onClick={() => handleRemoveSingle(a)}
                                disabled={busy}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 12, background: "var(--bg-soft)" }}>
          <button className="os-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default ManageApplicationsDrawer;
