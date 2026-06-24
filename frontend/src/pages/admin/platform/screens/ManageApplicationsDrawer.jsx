// ManageApplicationsDrawer — admin Reviewer Roster "Manage" drawer.
// View a reviewer's assigned applications (project/industry/status/batch),
// assign a new application by search, and remove (unassign) individual apps.
// Reads:  GET /admin/platform/reviewers/{id}/applications  (useAdminData "reviewerApplications")
//         GET /admin/platform/applications                 (useAdminData "pipeline", assign picker)
// Writes: POST/DELETE /leadership/applications/{id}/reviewers (leadershipApi)
import React, { useState, useMemo } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../lib/leadershipApi";

export function ManageApplicationsDrawer({ reviewer, onClose, onChanged }) {
  const apps = useAdminData("reviewerApplications", { userId: reviewer.id });
  const pipeline = useAdminData("pipeline", {});
  const [sel, setSel] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const assigned = apps.data?.applications ?? [];
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned]);
  const reviewerBatches = Array.isArray(reviewer.batches)
    ? reviewer.batches.map(b => (typeof b === "string" ? b : b.name))
    : [];

  const candidates = useMemo(() => {
    const all = (pipeline.data?.startups ?? []).filter(s => !assignedIds.has(s.id));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      `${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q));
  }, [pipeline.data, assignedIds, search]);

  const reload = () => { apps.reload(); onChanged && onChanged(); };

  const handleAssign = async () => {
    const app = candidates.find(c => c.id === sel) ||
      (pipeline.data?.startups ?? []).find(c => c.id === sel);
    if (!app) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await leadershipApi.assignReviewers(app.id, app.track, {
        reviewer_user_ids: [reviewer.id],
      });
      const st = res?.results?.[0]?.status;
      if (st === "already_assigned") setNotice("Already assigned to this reviewer.");
      setSel(""); setSearch("");
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
    } finally { setBusy(false); }
  };

  const handleRemove = async (app) => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      await leadershipApi.unassignReviewer(app.id, app.track, reviewer.id);
      reload();
    } catch (e) {
      setErr(
        e?.details?.message ||
        (e?.status === 409
          ? "This reviewer already submitted a review; the assignment can't be revoked."
          : e?.message || "Remove failed."),
      );
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

          {/* Assign new application */}
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4, padding: 16 }}>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Assign New Application</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="os-select"
                aria-label="Application"
                style={{ flex: 1, fontSize: 14 }}
                value={sel}
                onChange={e => setSel(e.target.value)}
              >
                <option value="">Search by name or industry…</option>
                {candidates.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.domain || "—"}){c.batch && c.batch !== "Unassigned" ? ` · ${c.batch}` : " · Unassigned"}
                  </option>
                ))}
              </select>
              <button
                className="os-btn"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={handleAssign}
                disabled={!sel || busy}
              >
                Assign Application
              </button>
            </div>
          </div>

          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          {notice && (
            <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 4 }}>{notice}</div>
          )}

          {/* Assigned applications table */}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
              Assigned Applications ({assigned.length})
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
              <table className="os-table">
                <thead>
                  <tr><th>Project</th><th>Industry</th><th>Status</th><th>Batch</th><th></th></tr>
                </thead>
                <tbody>
                  {assigned.map(a => (
                    <tr key={a.id}>
                      <td><div className="startup">{a.project}</div></td>
                      <td className="os-text-soft">{a.industry}</td>
                      <td><span className="os-chip">{a.chip}</span></td>
                      <td>
                        {a.batch
                          ? <span className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)" }}>{a.batch}</span>
                          : <span className="os-chip purple">Random allotment</span>}
                      </td>
                      <td>
                        <button
                          className="os-btn sm ghost"
                          style={{ color: "#FF5A5F" }}
                          onClick={() => handleRemove(a)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
