// AdminJury — A-6 · JURY MANAGEMENT (jury v2 real screen).
//
// Two tabs — Applications / Jury Roster — plus a header "Invite member" button
// that opens the JuryInviteModal. NO scoring, NO Random Allotment anywhere:
// jurors PICK apps to mentor.
//
// Roster tab      → useAdminData("jurors") → { jurors, pendingInvites }.
//   Columns: Member / Domains / Enrichment status / Picks / Weight / Last / Manage.
//   Auto-queues enrichment for any juror still "pending" on mount.
// Applications tab → useAdminData("pipeline", {recommended_for?}). JURY REVIEW
//   rows only. Filter bar: search / track / Recommended-for (reloads pipeline
//   with the param) + Recompute / Picked-by (client-side). READ-ONLY: it
//   identifies which jurors an application sits with; changing that is done
//   from the Jury Roster tab, which owns a juror end-to-end.

import React, { useEffect, useMemo, useState } from "react";

import { useAdminData } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { PageHead } from "../shell/osAtoms";
import { ManageJurorsDrawer } from "./ManageJurorsDrawer";
import { RemoveMemberDialog, removalSummary } from "./RemoveMemberDialog";
import { LoadingState, ErrorState } from "../ui.jsx";

const DRAWER_STYLES = `
  @keyframes osDrawerFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes osDrawerSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
`;

// enrichment_status → chip label + tone.
const ENRICHMENT_META = {
  pending: { label: "Queued", tone: "amber" },
  running: { label: "Enriching…", tone: "amber" },
  done:    { label: "Enriched", tone: "purple" },
  failed:  { label: "Failed", tone: "red" },
};

// ── Jury invite modal ─────────────────────────────────────────────────────────
// Dynamic {name,email} rows; submit → adminPlatformApi.createJuryInvites(rows);
// per-row result chips. No password — credentials are emailed on accept.

const RESULT_META = {
  invited:         { label: "Invited", tone: "purple" },
  already_invited: { label: "Already invited", tone: "amber" },
  error:           { label: "Error", tone: "red" },
};

function JuryInviteModal({ onClose, onInvited }) {
  const [rows, setRows] = useState([{ name: "", email: "" }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [results, setResults] = useState(null);

  const setRow = (i, patch) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(prev => [...prev, { name: "", email: "" }]);
  const removeRow = (i) => setRows(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const handleSubmit = async () => {
    const payload = rows
      .map(r => ({ name: r.name.trim(), email: r.email.trim() }))
      .filter(r => r.name && r.email);
    if (payload.length === 0) { setErr("Add at least one name and email."); return; }
    setSaving(true); setErr(null);
    try {
      const res = await adminPlatformApi.createJuryInvites(payload);
      setResults(res?.results || []);
    } catch (e) {
      setErr(e?.message || "Invite failed.");
      setSaving(false);
    }
  };

  return (
    <div
      className="os-modal-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="os-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 520, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4, boxShadow: "0 20px 60px rgba(36,36,36,0.18)" }}
      >
        <div className="os-modal-head" style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>Invite jury members</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>

        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {results ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {results.map((r, i) => {
                  const meta = RESULT_META[r.status] || { label: r.status, tone: "" };
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                      <span className="os-mono">{r.email}</span>
                      <span className={"os-chip " + meta.tone}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
              <button className="os-btn" style={{ marginTop: 8, width: "100%" }} onClick={() => { onInvited && onInvited(); onClose(); }}>Done</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                Each person receives a tokenised link to accept and set their expertise. Login credentials are emailed automatically once they accept.
              </div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Full name</label>
                    <input
                      type="text"
                      className="os-input os-w-100"
                      aria-label="Invite name"
                      placeholder="e.g. Dr. R. Iyer"
                      value={r.name}
                      onChange={e => setRow(i, { name: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: 1.4 }}>
                    <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Email</label>
                    <input
                      type="email"
                      className="os-input os-w-100"
                      aria-label="Invite email"
                      placeholder="name@example.in"
                      value={r.email}
                      onChange={e => setRow(i, { email: e.target.value })}
                    />
                  </div>
                  <button
                    className="os-btn sm ghost"
                    style={{ padding: "6px 8px", color: rows.length > 1 ? "#FF5A5F" : "var(--ink-dim)" }}
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                    aria-label="Remove row"
                  >
                    &times;
                  </button>
                </div>
              ))}

              <button className="os-btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={addRow}>Add another</button>

              {err && (
                <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
              )}

              <div className="os-modal-foot" style={{ display: "flex", justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
                <button className="os-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button
                  className="os-btn"
                  style={{ background: "#3213b7", color: "#fff" }}
                  onClick={handleSubmit}
                  disabled={saving}
                >
                  {saving ? "Sending…" : "Send invites"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Roster table ────────────────────────────────────────────────────────────

function RosterTable({ jurors, pendingInvites, onManage, onDelete, onReload }) {
  const [sortCol, setSortCol] = useStickyState("admin.jury.roster", "sortCol", null);
  const [sortAsc, setSortAsc] = useStickyState("admin.jury.roster", "sortAsc", true);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  };
  const renderHeader = (label, colKey, isNum = false) => (
    <th className={isNum ? "num" : ""} onClick={() => handleSort(colKey)} style={{ cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: isNum ? "flex-end" : "flex-start", width: "100%" }}>
        {label}{sortCol === colKey ? (sortAsc ? " ▲" : " ▼") : ""}
      </span>
    </th>
  );

  const sorted = useMemo(() => {
    if (!sortCol) return jurors;
    return [...jurors].sort((a, b) => {
      let va, vb;
      if (sortCol === "name") { va = a.name || ""; vb = b.name || ""; }
      else if (sortCol === "domain") { va = a.domain || ""; vb = b.domain || ""; }
      else if (sortCol === "picks") { va = a.picksSubmitted ?? 0; vb = b.picksSubmitted ?? 0; }
      else if (sortCol === "weight") { va = a.weight || 1.0; vb = b.weight || 1.0; }
      else if (sortCol === "last") { va = a.last || ""; vb = b.last || ""; }
      else { va = ""; vb = ""; }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [jurors, sortCol, sortAsc]);

  if (jurors.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-soft)", border: "1px dashed var(--line)", borderRadius: 4, marginTop: 16 }}>
        No jury members yet — use Invite member.
      </div>
    );
  }

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="os-table">
          <thead>
            <tr>
              {renderHeader("Member", "name")}
              <th>Domains</th>
              <th>Enrichment</th>
              {renderHeader("Picks", "picks")}
              {renderHeader("Weight", "weight", true)}
              {renderHeader("Last activity", "last")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(j => {
              const meta = ENRICHMENT_META[j.enrichmentStatus] || ENRICHMENT_META.pending;
              const submitted = j.picksSubmitted ?? 0;
              const pct = Math.min(100, Math.max(0, (submitted / 3) * 100));
              const domains = Array.isArray(j.domains) ? j.domains : (j.domain ? [j.domain] : []);
              return (
                <tr key={j.id}>
                  <td>
                    <div className="startup">
                      {j.name || "—"}
                      <small>{j.email || "Jury Member"}</small>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {domains.length
                        ? domains.map(d => (
                            <span key={d} className="os-chip" style={{ fontSize: 11, padding: "2px 6px" }}>{d}</span>
                          ))
                        : <span className="os-text-soft">—</span>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={"os-chip " + meta.tone} style={{ fontSize: 11, padding: "2px 7px", fontWeight: 600 }}>{meta.label}</span>
                      {j.enrichmentStatus === "failed" && (
                        <button
                          className="os-btn sm ghost"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => adminPlatformApi.enrichJuror(j.id).then(onReload).catch(() => {})}
                        >
                          Re-run
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="os-row gap-sm">
                      <div className="os-scorebar-track" style={{ width: 70 }}>
                        <div className="os-scorebar-fill" style={{ width: pct + "%", background: submitted >= 3 ? "var(--ok)" : "var(--ink)" }} />
                      </div>
                      <span className="os-mono os-text-sm">{j.picks || `${submitted} / 3`}</span>
                    </div>
                  </td>
                  <td className="num">
                    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {typeof j.weight === "number" ? j.weight.toFixed(1) : "1.0"}
                      </span>
                      {j.weight > 1.0 && (
                        <span className="os-chip purple" style={{ fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>PRIMARY</span>
                      )}
                    </div>
                  </td>
                  <td className="os-mono os-text-sm os-text-soft">{j.last || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="os-btn sm secondary" onClick={() => onManage(j)}>Manage</button>
                      <button
                        className="os-btn sm ghost"
                        style={{ color: "#d23b40", borderColor: "#f3c2c4" }}
                        aria-label={`Delete ${j.name || j.email || "jury member"}`}
                        onClick={() => onDelete(j)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pendingInvites.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
            Pending invites ({pendingInvites.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="os-table" style={{ opacity: 0.62 }}>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Sent</th></tr>
              </thead>
              <tbody>
                {pendingInvites.map((p, i) => (
                  <tr key={p.email || i}>
                    <td>{p.name || "—"}</td>
                    <td className="os-mono os-text-sm">{p.email}</td>
                    <td className="os-mono os-text-sm os-text-soft">
                      {p.sent_at ? String(p.sent_at).slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Applications table ────────────────────────────────────────────────────────

function ApplicationsTable({
  rows, jurors, search, setSearch, track, setTrack,
  recommendedFor, setRecommendedFor, pickedBy, setPickedBy,
  onRecompute, recomputeMsg,
}) {
  const showReco = !!recommendedFor;

  // Picked-by options = distinct juror names present across the loaded rows.
  const pickerNames = useMemo(() => {
    const s = new Set();
    for (const r of rows) for (const p of (r.picked_by || [])) if (p.name) s.add(p.name);
    return Array.from(s).sort();
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(s => {
      if ((s.chip || "").toUpperCase() !== "JURY REVIEW") return false;
      if (track && s.track !== track) return false;
      if (q && !`${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q)) return false;
      if (pickedBy && !(s.picked_by || []).some(p => p.name === pickedBy)) return false;
      return true;
    });
  }, [rows, search, track, pickedBy]);

  return (
    <>
      {/* Filter bar */}
      <div className="os-row gap-sm" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <input
          className="os-input"
          aria-label="Search applications"
          placeholder="Search project or industry…"
          style={{ minWidth: 200, fontSize: 13 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="os-select" aria-label="Track" style={{ fontSize: 13 }} value={track} onChange={e => setTrack(e.target.value)}>
          <option value="">All tracks</option>
          <option value="tir">TIR</option>
          <option value="sip">VIP</option>
        </select>
        <select className="os-select" aria-label="Recommended for" style={{ fontSize: 13 }} value={recommendedFor} onChange={e => setRecommendedFor(e.target.value)}>
          <option value="">Recommended for…</option>
          {jurors.map(j => (
            <option key={j.id} value={j.id}>{j.name || j.email || j.id}</option>
          ))}
        </select>
        <button className="os-btn ghost sm" onClick={onRecompute} disabled={!recommendedFor}>Recompute</button>
        <select className="os-select" aria-label="Picked by" style={{ fontSize: 13 }} value={pickedBy} onChange={e => setPickedBy(e.target.value)}>
          <option value="">Picked by…</option>
          {pickerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {recomputeMsg && (
        <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 4, marginBottom: 12 }}>{recomputeMsg}</div>
      )}

      {visible.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-soft)", border: "1px dashed var(--line)", borderRadius: 4 }}>
          No applications in Jury Review.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="os-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Industry</th>
                <th className="num">AI score</th>
                {showReco && <th className="num">Fit</th>}
                <th>Assigned jurors</th>
                <th>Picked by</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className="startup">
                      {s.name}
                      <small>{s.founders?.[0] || "—"}</small>
                    </div>
                  </td>
                  <td className="os-text-soft">{s.domain}</td>
                  <td className="num">
                    {s.ai?.overall != null
                      ? <span style={{ fontWeight: 700 }}>{Number(s.ai.overall).toFixed(1)}</span>
                      : <span className="os-text-soft">—</span>}
                  </td>
                  {showReco && (
                    <td className="num">
                      {s.recommendation?.score != null
                        ? <span className="os-chip purple" title={s.recommendation.reason || ""} style={{ fontWeight: 700 }}>★{Math.round(s.recommendation.score)}</span>
                        : <span className="os-text-soft">—</span>}
                    </td>
                  )}
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(s.jury_assigned_names || []).length
                        ? s.jury_assigned_names.map((n, i) => (
                            <span key={n + i} className="os-chip" style={{ fontSize: 11, padding: "2px 6px" }}>{n}</span>
                          ))
                        : <span className="os-text-soft">Unassigned</span>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(s.picked_by || []).length
                        ? s.picked_by.map((p, i) => (
                            <span key={(p.juror_user_id || p.name) + i} className="os-chip purple" title={p.note || ""} style={{ fontSize: 11, padding: "2px 6px", fontWeight: 600 }}>★ {p.name}</span>
                          ))
                        : <span className="os-text-soft">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// No `go` prop: the tab strip above already carries a Dashboard tab, so the
// in-page "← Dashboard" button was redundant and has been removed.
export function AdminJury() {
  const [tab, setTab] = useState("applications");
  const [showInvite, setShowInvite] = useState(false);

  // Applications filter state (recommendedFor drives the pipeline load params).
  const [search, setSearch] = useStickyState("admin.jury.applications", "search", "");
  const [track, setTrack] = useStickyState("admin.jury.applications", "track", "");
  const [recommendedFor, setRecommendedFor] = useStickyState("admin.jury.applications", "recommendedFor", "");
  const [pickedBy, setPickedBy] = useStickyState("admin.jury.applications", "pickedBy", "");
  const [recomputeMsg, setRecomputeMsg] = useState(null);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoMsg, setAutoMsg] = useState(null);

  // Roster drawer + delete state. (The Applications tab is read-only, so there
  // is no per-application juror picker any more.)
  const [manageJuror, setManageJuror] = useState(null);   // juror object → drawer
  const [deleteJuror, setDeleteJuror] = useState(null);   // juror object → confirm
  const [removedNote, setRemovedNote] = useState(null);

  const jurorsData = useAdminData("jurors");
  const pipeline = useAdminData(
    "pipeline",
    recommendedFor ? { recommended_for: recommendedFor } : {},
  );

  const jurors = jurorsData.data?.jurors ?? [];
  const pendingInvites = jurorsData.data?.pendingInvites ?? [];
  const startups = pipeline.data?.startups ?? [];

  const reloadAll = () => { jurorsData.reload(); pipeline.reload(); };

  // Auto-queue enrichment once for any juror still pending on this mount.
  useEffect(() => {
    (jurorsData.data?.jurors || [])
      .filter(j => j.enrichmentStatus === "pending")
      .forEach(j => adminPlatformApi.enrichJuror(j.id).catch(() => {}));
  }, [jurorsData.data]);

  const handleRecompute = async () => {
    if (!recommendedFor) return;
    setRecomputeMsg(null);
    try {
      await adminPlatformApi.recomputeRecommendations(recommendedFor);
      setRecomputeMsg("Recomputing — refresh shortly.");
    } catch (e) {
      setRecomputeMsg(e?.message || "Recompute failed.");
    }
  };

  const handleRefreshSuggestions = async () => {
    setAutoAssigning(true); setAutoMsg(null);
    try {
      const r = await adminPlatformApi.recomputeRecommendations();   // no id → all jurors
      const n = Array.isArray(r?.queued) ? r.queued.length : 0;
      setAutoMsg(`Refreshing AI suggestions for ${n} juror(s) — open a juror to review & assign.`);
    } catch (e) {
      setAutoMsg(e?.message || "Couldn't refresh suggestions.");
    } finally {
      setAutoAssigning(false);
    }
  };

  const confirmDelete = async () => {
    const res = await adminPlatformApi.deleteJuror(deleteJuror.id);
    setRemovedNote(removalSummary("jury", deleteJuror.name || deleteJuror.email, res));
    setDeleteJuror(null);
    setManageJuror(null);
    reloadAll();
  };

  return (
    <div className="dash-scroll">
      <style dangerouslySetInnerHTML={{ __html: DRAWER_STYLES }} />

      <PageHead
        eyebrow="A-6 · JURY MANAGEMENT"
        title="Jury <em>selection</em>"
        sub="Invite jury members, track background enrichment, and see who each juror picked to mentor."
        actions={[
          <button key="auto" className="os-btn secondary" onClick={handleRefreshSuggestions}
            disabled={autoAssigning}>
            {autoAssigning ? "Refreshing…" : "Refresh AI suggestions"}
          </button>,
          <button key="inv" className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={() => setShowInvite(true)}>Invite member</button>,
        ]}
      />

      <div className="os-row gap-sm os-mb-lg">
        <div className={"os-tab " + (tab === "applications" ? "active" : "")} onClick={() => setTab("applications")}>Applications</div>
        <div className={"os-tab " + (tab === "roster" ? "active" : "")} onClick={() => setTab("roster")}>Jury Roster</div>
      </div>

      {autoMsg && <div className="os-text-sm os-text-soft os-mb-lg">{autoMsg}</div>}
      {removedNote && (
        <div style={{ color: "#1d6b45", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "#e9f6ef", border: "1px solid #b7ddc8", borderRadius: 4, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{removedNote}</span>
          <button className="os-btn sm ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setRemovedNote(null)}>Dismiss</button>
        </div>
      )}

      {tab === "applications" && (
        pipeline.loading ? <LoadingState label="Loading applications…" />
        : pipeline.error ? <ErrorState error={pipeline.error} onRetry={pipeline.reload} />
        : <ApplicationsTable
            rows={startups}
            jurors={jurors}
            search={search} setSearch={setSearch}
            track={track} setTrack={setTrack}
            recommendedFor={recommendedFor} setRecommendedFor={setRecommendedFor}
            pickedBy={pickedBy} setPickedBy={setPickedBy}
            onRecompute={handleRecompute} recomputeMsg={recomputeMsg}
          />
      )}

      {tab === "roster" && (
        jurorsData.loading ? <LoadingState label="Loading jury roster…" />
        : jurorsData.error ? <ErrorState error={jurorsData.error} onRetry={jurorsData.reload} />
        : <RosterTable
            jurors={jurors}
            pendingInvites={pendingInvites}
            onManage={(j) => setManageJuror(j)}
            onDelete={(j) => setDeleteJuror(j)}
            onReload={reloadAll}
          />
      )}

      {/* Invite modal */}
      {showInvite && (
        <JuryInviteModal
          onClose={() => setShowInvite(false)}
          onInvited={reloadAll}
        />
      )}

      {/* Manage drawer (juror already known) */}
      {manageJuror && (
        <ManageJurorsDrawer
          juror={manageJuror}
          onClose={() => setManageJuror(null)}
          onChanged={reloadAll}
          onRequestDelete={(j) => setDeleteJuror(j)}
        />
      )}

      {/* Delete confirmation */}
      {deleteJuror && (
        <RemoveMemberDialog
          kind="jury"
          member={deleteJuror}
          onClose={() => setDeleteJuror(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

export default AdminJury;
