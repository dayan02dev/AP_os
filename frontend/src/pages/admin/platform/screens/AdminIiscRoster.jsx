// AdminIiscRoster — A-7 · ACADEMIC JURY ROSTER (jury-mode candidate pool).
// (Component/file name kept as AdminIiscRoster — the data source is still the
// scraped IISc faculty list; only the user-visible labels say "Academic".)
//
// Reads the static /iisc_professors.json (809 scraped IISc professors),
// renders a design-system table with filters + a detail drawer, recommends
// jury-selected (jury_review) applications to each professor by shared ARTPARK
// domain, and sends jury invites via the existing createJuryInvites flow.
import React, { useEffect, useMemo, useState } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { LABEL_TO_TOKEN, TOKEN_TO_LABEL, DOMAIN_TOKENS } from "../../../../lib/artparkDomains";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState } from "../ui.jsx";

const DRAWER_STYLES = `
  @keyframes osDrawerFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes osDrawerSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
`;
const MATCH_TONE = { Yes: "purple", Partial: "amber", No: "" };
const norm = (s) => (s || "").toLowerCase().replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
const tokensOf = (md) => (md || "").split(";").map(t => t.trim()).filter(t => t && t !== "—");

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
  const [detail, setDetail] = useState(null);
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
      const rank = { Yes: 0, Partial: 1, No: 2 };
      list = [...list].sort((a, b) => {
        if (sortCol === "match") return (rank[a.artpark_match] - rank[b.artpark_match]) * dir;
        if (sortCol === "reco") return (a.recommended.length - b.recommended.length) * dir;
        return String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * dir;
      });
    }
    return list;
  }, [profs, search, division, department, match, domain, uniqueOnly, sortCol, sortAsc, appsByToken]);

  const onSort = (col) => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };
  const hdr = (label, col, isNum = false) => (
    <th className={isNum ? "num" : ""} onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label}{sortCol === col ? (sortAsc ? " ▲" : " ▼") : ""}
    </th>
  );
  const isInvited = (p) => invitedNames.has(norm(p.name));

  if (loadErr) return <div className="dash-scroll"><ErrorState error={loadErr} onRetry={() => setReloadKey(k => k + 1)} /></div>;
  if (profs === null) return <div className="dash-scroll"><LoadingState label="Loading IISc roster…" /></div>;

  return (
    <div className="dash-scroll">
      <style dangerouslySetInnerHTML={{ __html: DRAWER_STYLES }} />
      {go && (
        <button className="os-btn ghost sm" style={{ marginBottom: 12 }} onClick={() => go("dashboard")}>← Dashboard</button>
      )}
      <PageHead
        eyebrow="A-7 · ACADEMIC JURY ROSTER"
        title="Academic jury <em>roster</em>"
        sub="All IISc professors we scraped, scored against ARTPARK's domains. Open a professor for detail, see the jury-selected applications that match their expertise, and send an invite."
      />

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
        <span className="os-mono os-text-sm os-text-dim" style={{ marginLeft: "auto" }}>{rows.length} of {profs.length}</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="os-table">
          <thead><tr>
            {hdr("Professor", "name")}
            {hdr("Department", "department")}
            {hdr("ARTPARK match", "match")}
            <th>Matched domains</th>
            {hdr("Recommended apps", "reco", true)}
            <th></th>
          </tr></thead>
          <tbody>
            {rows.map((p, i) => {
              const invited = isInvited(p);
              return (
                <tr key={(p.name || "") + i}>
                  <td>
                    <a className="nm" onClick={() => setDetail(p)} style={{ cursor: "pointer" }}>{p.name || "—"}</a>
                    {p.duplicate_joint_appointment === "Yes" && <span className="os-chip" style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px" }}>joint</span>}
                    <div className="os-text-soft" style={{ fontSize: 11.5 }}>{p.title || "—"}</div>
                  </td>
                  <td><span className="os-chip" style={{ fontSize: 11, padding: "2px 6px" }}>{p.department}</span>
                    <div className="os-text-soft" style={{ fontSize: 10, marginTop: 3 }}>{p.division}</div></td>
                  <td><span className={"os-chip " + (MATCH_TONE[p.artpark_match] || "")} style={{ fontWeight: 700 }}>{p.artpark_match}</span></td>
                  <td><div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 200 }}>
                    {tokensOf(p.matched_domains).length
                      ? tokensOf(p.matched_domains).map(t => <span key={t} className="dtag" style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 5 }}>{t}</span>)
                      : <span className="os-text-soft">—</span>}
                  </div></td>
                  <td className="num">
                    {" "}<a className="nm" style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => setDetail(p)}>{p.recommended.length}</a>{" apps"}
                  </td>
                  <td>
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

      {detail && <ProfDrawer prof={detail} onClose={() => setDetail(null)}
        onInvite={() => { setInvite(detail); }} invited={isInvited(detail)} />}
      {invite && <InviteModal prof={invite} onClose={() => setInvite(null)}
        onDone={() => { setInvite(null); jurorsData.reload(); }} />}
    </div>
  );
}

function ProfDrawer({ prof, onClose, onInvite, invited }) {
  const recs = prof.recommended || [];
  return (
    <div className="os-drawer-backdrop" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.4)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "flex-end", animation: "osDrawerFadeIn 0.2s ease-out" }}>
      <div className="os-drawer" onClick={e => e.stopPropagation()}
        style={{ width: 720, maxWidth: "92vw", height: "100%", background: "var(--bg-paper)", borderLeft: "1px solid var(--line-strong)", boxShadow: "-10px 0 40px rgba(36,36,36,0.15)", display: "flex", flexDirection: "column", animation: "osDrawerSlideIn 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{prof.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>{prof.title} · {prof.department} · {prof.division}</div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="Research domain">{prof.research_domain || "—"}</Field>
          <Field label="Subdomains">{prof.subdomains || "—"}</Field>
          <Field label="Notable work">{prof.notable_work || "—"}</Field>
          <Field label="ARTPARK match">
            <span className={"os-chip " + (MATCH_TONE[prof.artpark_match] || "")} style={{ fontWeight: 700 }}>{prof.artpark_match}</span>
            {" "}<span className="os-text-soft">{tokensOf(prof.matched_domains).join(", ") || "—"}</span>
            <div className="os-text-soft" style={{ fontSize: 12.5, marginTop: 6, fontStyle: "italic" }}>{prof.reasoning}</div>
          </Field>
          {prof.profile_url && (
            <a className="os-btn ghost sm" href={prof.profile_url} target="_blank" rel="noopener" style={{ alignSelf: "flex-start" }}>View profile ↗</a>
          )}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
              Recommended jury-selected applications ({recs.length})
            </div>
            {recs.length === 0
              ? <div className="os-text-soft" style={{ fontSize: 13 }}>No jury-selected applications match this professor's domains.</div>
              : <table className="os-table"><thead><tr><th>Project</th><th>Industry</th><th className="num">AI</th></tr></thead>
                  <tbody>{recs.map(a => (
                    <tr key={a.track + a.id}><td><div className="startup">{a.name}<small>{a.founders?.[0] || "—"}</small></div></td>
                      <td className="os-text-soft">{a.domain}</td>
                      <td className="num">{a.ai?.overall != null ? Number(a.ai.overall).toFixed(1) : "—"}</td></tr>
                  ))}</tbody></table>}
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 12, background: "var(--bg-soft)" }}>
          <button className="os-btn secondary" disabled={invited} onClick={onInvite}>{invited ? "Invited" : "Invite"}</button>
          <button className="os-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (<div><div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{children}</div></div>);
}

function InviteModal({ prof, onClose, onDone }) {
  const [email, setEmail] = useState("");
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
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
