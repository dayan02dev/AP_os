// ManageJurorsDrawer — admin Jury "Manage" drawer (jury v2).
//
// View a juror's assigned applications (project/industry/status + a ★ picked
// chip when the juror picked it), assign a new JURY REVIEW application, and
// remove (unassign) individual apps.
//
// Reads:  GET /admin/platform/jurors/{id}/applications  (useAdminData "jurorApplications")
//         GET /admin/platform/applications?recommended_for={id}
//             (useAdminData "pipeline" — candidate picker, recommended-first)
// Writes: POST/DELETE /leadership/applications/{id}/jurors (leadershipApi)
//
// v2 edits vs the port: candidates limited to JURY REVIEW; recommended-first
// ordering + score badge; remove-error code app_already_decided → Final-Gate
// frozen message; a green ★ picked chip on picked rows.
import React, { useState, useMemo, useEffect } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../lib/leadershipApi";

// jurorApplications rows are adapted without a chip; derive a display label
// from the raw status ("jury_review" → "JURY REVIEW").
function statusChip(a) {
  if (a.chip) return a.chip;
  return a.status ? String(a.status).replace(/_/g, " ").toUpperCase() : "—";
}

export function ManageJurorsDrawer({ juror, onClose, onChanged }) {
  const apps = useAdminData("jurorApplications", { userId: juror.id });
  // Load the pipeline recommendations for THIS juror so eligible candidates can
  // be ordered best-fit-first with a score badge.
  const pipeline = useAdminData("pipeline", { recommended_for: juror.id });
  const [sel, setSel] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const assigned = apps.data?.applications ?? [];
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned]);

  // Only JURY REVIEW apps are eligible for jury assignment in v2 (no
  // shortlisted→jury_review auto-flip). Recommended candidates sort first.
  const candidates = useMemo(() => {
    const all = (pipeline.data?.startups ?? []).filter(s => {
      if (assignedIds.has(s.id)) return false;
      return (s.chip || "").toUpperCase() === "JURY REVIEW";
    });
    const q = search.trim().toLowerCase();
    const filtered = q
      ? all.filter(s => `${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q))
      : all;
    return [...filtered].sort((a, b) => {
      const sa = a.recommendation?.score;
      const sb = b.recommendation?.score;
      if (sa != null && sb != null) return sb - sa;
      if (sa != null) return -1;
      if (sb != null) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [pipeline.data, assignedIds, search]);

  const suggestions = useMemo(
    () => candidates.filter(c => c.recommendation?.score != null),
    [candidates]);
  const [checked, setChecked] = useState(null);   // Set<id> | null (uninitialised)
  useEffect(() => {
    if (checked === null && suggestions.length)
      setChecked(new Set(suggestions.map(s => s.id)));
  }, [suggestions, checked]);
  const toggleCheck = (id) => setChecked(prev => {
    const next = new Set(prev || []);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectedCount = checked ? suggestions.filter(s => checked.has(s.id)).length : 0;

  const reload = () => { apps.reload(); onChanged && onChanged(); };

  const handleAssignSelected = async () => {
    const picks = suggestions.filter(s => checked?.has(s.id));
    if (!picks.length) return;
    setAutoBusy(true); setErr(null); setNotice(null);
    try {
      for (const appRow of picks) {
        await leadershipApi.assignJurors(appRow.id, appRow.track, { juror_user_ids: [juror.id] });
      }
      setChecked(null);
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
    } finally { setAutoBusy(false); }
  };

  const handleAssign = async () => {
    const app = candidates.find(c => c.id === sel) ||
      (pipeline.data?.startups ?? []).find(c => c.id === sel);
    if (!app) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await leadershipApi.assignJurors(app.id, app.track, {
        juror_user_ids: [juror.id],
      });
      const st = res?.results?.[0]?.status;
      if (st === "already_assigned") setNotice("Already assigned to this juror.");
      else if (st === "not_a_juror") setNotice("This user does not have the jury role.");
      setSel(""); setSearch("");
      reload();
    } catch (e) {
      const code = e?.code || e?.details?.code;
      if (code === "not_eligible_for_jury") {
        setErr("This application is not in Jury Review — it can't be assigned to a juror.");
      } else {
        setErr(e?.details?.message || e?.message || "Assign failed.");
      }
    } finally { setBusy(false); }
  };

  const handleRemove = async (app) => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      await leadershipApi.unassignJuror(app.id, app.track, juror.id);
      reload();
    } catch (e) {
      const code = e?.code || e?.details?.code;
      if (code === "app_already_decided") {
        setErr("This application already has a Final Gate decision — assignments are frozen.");
      } else {
        setErr(e?.details?.message || e?.message || "Remove failed.");
      }
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
              Jury Member: <strong>{juror.name}</strong>{juror.domain ? ` · ${juror.domain}` : ""}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Assign new application */}
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4, padding: 16 }}>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Assign New Application</div>
            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 8 }}>Only Jury Review applications are eligible. Recommended matches for this juror appear first.</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="os-select"
                aria-label="Application"
                style={{ flex: 1, fontSize: 14 }}
                value={sel}
                onChange={e => setSel(e.target.value)}
              >
                <option value="">Search by name or industry…</option>
                {candidates.map(c => {
                  const score = c.recommendation?.score;
                  const badge = score != null ? ` · ★${Math.round(score)}` : "";
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.domain || "—"}){badge}
                    </option>
                  );
                })}
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
            {suggestions.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
                  Suggested matches (AI)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {suggestions.map(s => (
                    <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        aria-label={`Suggest ${s.name}`}
                        checked={!!checked?.has(s.id)}
                        onChange={() => toggleCheck(s.id)}
                      />
                      <span style={{ flex: 1 }}>{s.name} <span className="os-text-soft">({s.domain || "—"})</span></span>
                      <span className="os-chip purple" style={{ fontSize: 11, padding: "1px 6px", fontWeight: 700 }}>★{Math.round(s.recommendation.score)}</span>
                    </label>
                  ))}
                </div>
                <button
                  className="os-btn secondary sm"
                  style={{ marginTop: 10 }}
                  onClick={handleAssignSelected}
                  disabled={autoBusy || selectedCount === 0}
                >
                  {autoBusy ? "Assigning…" : `Assign selected (${selectedCount})`}
                </button>
              </div>
            )}
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
                  <tr><th>Project</th><th>Industry</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {assigned.map(a => (
                    <tr key={a.id}>
                      <td><div className="startup">{a.project}</div></td>
                      <td className="os-text-soft">{a.industry}</td>
                      <td>
                        <span className="os-chip">{statusChip(a)}</span>
                        {a.picked && (
                          <span className="os-chip purple" style={{ marginLeft: 4, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>★ picked</span>
                        )}
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

export default ManageJurorsDrawer;
