// AdminIiscRoster — A-7 · ACADEMIC JURY ROSTER (jury-mode candidate pool).
// (Component/file name kept as AdminIiscRoster — the data source is still the
// scraped IISc faculty list; only the user-visible labels say "Academic".)
//
// Reads the static /iisc_professors.json (809 scraped IISc professors), renders
// them in the same table idiom as the admin pipeline / leadership lists, and
// recommends jury-selected (jury_review) applications to each professor by
// shared ARTPARK domain. Invites go through the existing createJuryInvites flow.
//
// Clicking a row opens AdminProfessorDetail as a FULL PAGE (it replaces this
// list, exactly as AdminDetail replaces the pipeline) — it used to be a
// right-hand drawer. The list keeps its filter/sort state while you're away,
// so "← Back to roster" returns you to the same view.
import React, { useEffect, useMemo, useState } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { LABEL_TO_TOKEN, TOKEN_TO_LABEL, DOMAIN_TOKENS } from "../../../../lib/artparkDomains";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState } from "../ui.jsx";
import { AdminProfessorDetail, tokensOf } from "./AdminProfessorDetail";

const MODAL_STYLES = `
  @keyframes osModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const MATCH_TONE = { Yes: "purple", Partial: "amber", No: "" };
const MATCH_RANK = { Yes: 0, Partial: 1, No: 2 };
const norm = (s) => (s || "").toLowerCase().replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();

export function AdminIiscRoster({ go } = {}) {
  const [profs, setProfs] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setProfs(null); setLoadErr(null);
    fetch("/iisc_professors.json")
      .then(r => { if (!r.ok) throw new Error("Failed to load roster"); return r.json(); })
      .then(d => { if (alive) setProfs(Array.isArray(d) ? d : []); })
      .catch(e => { if (alive) setLoadErr(e); });
    return () => { alive = false; };
  }, [reloadKey]);

  const pipeline = useAdminData("pipeline");
  const jurorsData = useAdminData("jurors");

  const appsByToken = useMemo(() => {
    const m = new Map();
    for (const s of (pipeline.data?.startups ?? [])) {
      if ((s.chip || "").toUpperCase() !== "JURY REVIEW") continue;
      const tok = LABEL_TO_TOKEN[s.domain];
      if (!tok) continue;
      if (!m.has(tok)) m.set(tok, []);
      m.get(tok).push(s);
    }
    return m;
  }, [pipeline.data]);

  const recommendFor = (md) => {
    const seen = new Set(); const out = [];
    for (const t of tokensOf(md)) for (const a of (appsByToken.get(t) || [])) {
      const k = `${a.track}:${a.id}`;
      if (!seen.has(k)) { seen.add(k); out.push(a); }
    }
    return out;
  };

  const invitedNames = useMemo(() => {
    const s = new Set();
    for (const j of (jurorsData.data?.jurors ?? [])) if (j.name) s.add(norm(j.name));
    for (const p of (jurorsData.data?.pendingInvites ?? [])) if (p.name) s.add(norm(p.name));
    return s;
  }, [jurorsData.data]);

  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("");
  const [department, setDepartment] = useState("");
  const [match, setMatch] = useState("");
  const [domain, setDomain] = useState("");
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  // Index into `rows` of the professor whose full page is open; null = list view.
  const [openIdx, setOpenIdx] = useState(null);
  const [invite, setInvite] = useState(null);

  const divisions = useMemo(() => Array.from(new Set((profs || []).map(p => p.division).filter(Boolean))).sort(), [profs]);
  const departments = useMemo(() => Array.from(new Set((profs || []).map(p => p.department).filter(Boolean))).sort(), [profs]);

  const rows = useMemo(() => {
    const q = norm(search);
    let list = (profs || [])
      .map(p => ({ ...p, recommended: recommendFor(p.matched_domains) }))
      .filter(p => {
        if (uniqueOnly && p.duplicate_joint_appointment === "Yes") return false;
        if (division && p.division !== division) return false;
        if (department && p.department !== department) return false;
        if (match && p.artpark_match !== match) return false;
        if (domain && !tokensOf(p.matched_domains).includes(domain)) return false;
        if (q && !norm(`${p.name} ${p.research_domain} ${p.subdomains} ${p.notable_work}`).includes(q)) return false;
        return true;
      });
    if (sortCol) {
      const dir = sortAsc ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (sortCol === "match") return ((MATCH_RANK[a.artpark_match] ?? 3) - (MATCH_RANK[b.artpark_match] ?? 3)) * dir;
        if (sortCol === "reco") return (a.recommended.length - b.recommended.length) * dir;
        return String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * dir;
      });
    }
    return list;
  }, [profs, search, division, department, match, domain, uniqueOnly, sortCol, sortAsc, appsByToken]);

  const onSort = (col) => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };
  // Sortable header, same idiom as AdminPipeline's renderHeader.
  const hdr = (label, col, isNum = false) => (
    <th
      className={isNum ? "num" : ""}
      onClick={() => onSort(col)}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}{sortCol === col ? (sortAsc ? " ▲" : " ▼") : ""}
      </span>
    </th>
  );
  const isInvited = (p) => invitedNames.has(norm(p.name));

  const hasFilters = search || division || department || match || domain || uniqueOnly;
  const clearAll = () => {
    setSearch(""); setDivision(""); setDepartment("");
    setMatch(""); setDomain(""); setUniqueOnly(false);
  };

  if (loadErr) return <div className="dash-scroll"><ErrorState error={loadErr} onRetry={() => setReloadKey(k => k + 1)} /></div>;
  if (profs === null) return <div className="dash-scroll"><LoadingState label="Loading academic roster…" /></div>;

  // ── Full-page professor detail ──────────────────────────────────────────
  const open = openIdx != null ? rows[openIdx] : null;
  if (open) {
    return (
      <div className="dash-scroll">
        <style dangerouslySetInnerHTML={{ __html: MODAL_STYLES }} />
        <AdminProfessorDetail
          prof={open}
          recommended={open.recommended}
          invited={isInvited(open)}
          onBack={() => setOpenIdx(null)}
          onInvite={() => setInvite(open)}
          onPrev={openIdx > 0 ? () => setOpenIdx(openIdx - 1) : null}
          onNext={openIdx < rows.length - 1 ? () => setOpenIdx(openIdx + 1) : null}
          position={`${openIdx + 1} of ${rows.length}${hasFilters ? " (filtered)" : ""}`}
        />
        {invite && (
          <InviteModal
            prof={invite}
            onClose={() => setInvite(null)}
            onDone={() => { setInvite(null); jurorsData.reload(); }}
          />
        )}
      </div>
    );
  }

  // ── List ────────────────────────────────────────────────────────────────
  return (
    <div className="dash-scroll">
      <style dangerouslySetInnerHTML={{ __html: MODAL_STYLES }} />
      {go && (
        <button className="os-btn ghost sm" style={{ marginBottom: 12 }} onClick={() => go("dashboard")}>← Dashboard</button>
      )}
      <PageHead
        eyebrow="A-7 · ACADEMIC JURY ROSTER"
        title="Academic jury <em>roster</em>"
        sub="Every professor we scraped, scored against ARTPARK's domains. Open one for the full profile, the jury-selected applications matching their expertise, and an invite."
      />

      {/* Filter bar — search + selects + clear, mirroring the pipeline list. */}
      <div className="os-row gap-sm" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input className="os-input" aria-label="Search" placeholder="Search name, research, work…"
          style={{ minWidth: 220, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="os-select" aria-label="Division" style={{ fontSize: 13 }} value={division} onChange={e => setDivision(e.target.value)}>
          <option value="">All divisions</option>
          {divisions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="os-select" aria-label="Department" style={{ fontSize: 13 }} value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="os-select" aria-label="Match" style={{ fontSize: 13 }} value={match} onChange={e => setMatch(e.target.value)}>
          <option value="">All matches</option><option>Yes</option><option>Partial</option><option>No</option>
        </select>
        <select className="os-select" aria-label="Domain" style={{ fontSize: 13 }} value={domain} onChange={e => setDomain(e.target.value)}>
          <option value="">All ARTPARK domains</option>
          {DOMAIN_TOKENS.map(t => <option key={t} value={t}>{TOKEN_TO_LABEL[t]}</option>)}
        </select>
        <label className="os-text-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={uniqueOnly} onChange={e => setUniqueOnly(e.target.checked)} aria-label="Unique only" />
          Unique only
        </label>
        {hasFilters && (
          <button className="os-btn ghost sm" onClick={clearAll}>Clear filters</button>
        )}
        <span className="os-mono os-text-sm os-text-dim" style={{ marginLeft: "auto" }}>{rows.length} of {profs.length}</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--ink-soft)", border: "1px dashed var(--line)", borderRadius: 4 }}>
          No professors match the current filters.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="os-table">
            <thead>
              <tr>
                {hdr("PROFESSOR", "name")}
                {hdr("DEPARTMENT", "department")}
                {hdr("DIVISION", "division")}
                {hdr("ARTPARK MATCH", "match")}
                <th>MATCHED DOMAINS</th>
                {hdr("RECOMMENDED APPS", "reco", true)}
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const invited = isInvited(p);
                const toks = tokensOf(p.matched_domains);
                return (
                  <tr
                    key={(p.name || "") + i}
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpenIdx(i)}
                  >
                    <td>
                      <div className="startup">
                        {p.name || "—"}
                        {p.duplicate_joint_appointment === "Yes" && (
                          <span className="os-chip" style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>JOINT</span>
                        )}
                        <small>{p.title || "—"}</small>
                      </div>
                    </td>
                    <td>
                      <span className="os-chip" style={{ fontSize: 11, padding: "2px 7px" }}>{p.department}</span>
                    </td>
                    <td className="os-text-soft">{p.division || "—"}</td>
                    <td>
                      <span className={"os-chip " + (MATCH_TONE[p.artpark_match] || "")} style={{ fontWeight: 700 }}>
                        {p.artpark_match}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 230 }}>
                        {toks.length
                          ? toks.map(t => (
                              <span
                                key={t}
                                className="os-chip"
                                title={TOKEN_TO_LABEL[t] || t}
                                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "2px 7px" }}
                              >
                                {t}
                              </span>
                            ))
                          : <span className="os-text-soft">—</span>}
                      </div>
                    </td>
                    <td className="num">
                      {p.recommended.length > 0
                        ? <b>{p.recommended.length}</b>
                        : <span className="os-text-soft">0</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="os-btn sm secondary" disabled={invited} onClick={() => setInvite(p)}>
                        {invited ? "Invited" : "Invite"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invite && (
        <InviteModal
          prof={invite}
          onClose={() => setInvite(null)}
          onDone={() => { setInvite(null); jurorsData.reload(); }}
        />
      )}
    </div>
  );
}

// TESTING DEFAULT — the scraped roster carries no email addresses, so the
// invite field is normally blank and the admin types one in. Pre-filling this
// lets us exercise the real send path (jury_invite template → Resend) end to
// end without mailing an actual professor. REMOVE THIS CONSTANT (and revert
// the useState below to "") before the roster goes live.
export const TEST_INVITE_EMAIL = "udayanpawar03@gmail.com";

function InviteModal({ prof, onClose, onDone }) {
  const [email, setEmail] = useState(TEST_INVITE_EMAIL);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const send = async () => {
    const e = email.trim();
    if (!e) { setErr("Enter an email."); return; }
    setSaving(true); setErr(null);
    try {
      const res = await adminPlatformApi.createJuryInvites([{ name: prof.name, email: e }]);
      setResult(res?.results?.[0] || { status: "invited" });
    } catch (ex) { setErr(ex?.message || "Invite failed."); setSaving(false); }
  };
  return (
    <div className="os-modal-backdrop" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", animation: "osModalFadeIn 0.2s ease-out" }}>
      <div className="os-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 460, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4, boxShadow: "0 20px 60px rgba(36,36,36,0.18)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Invite jury member</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {result ? (
            <>
              <div className="os-text-sm">Invite to <b>{prof.name}</b>: <span className={"os-chip " + (result.status === "invited" ? "purple" : result.status === "already_invited" ? "amber" : "")}>{result.status.replace(/_/g, " ")}</span></div>
              {result.status === "already_invited" && (
                <div className="os-text-xs os-text-dim">
                  This address was already invited, so <b>no new email was sent</b> — the
                  original invite link is still the valid one. To re-test delivery, use a
                  different address (Gmail <code>+tag</code> aliases work) or delete the
                  existing <code>jury_invites</code> row first.
                </div>
              )}
              <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={onDone}>Done</button>
            </>
          ) : (
            <>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Name</label>
                <input className="os-input os-w-100" aria-label="Invite name" value={prof.name} readOnly />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Email</label>
                <input className="os-input os-w-100" type="email" aria-label="Invite email" placeholder="name@iisc.ac.in" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              {err && <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <button className="os-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={send} disabled={saving}>{saving ? "Sending…" : "Send invite"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminIiscRoster;
