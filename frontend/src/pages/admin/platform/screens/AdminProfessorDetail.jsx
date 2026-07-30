// AdminProfessorDetail — full-page profile for one academic-roster professor.
//
// Replaces the old right-hand drawer: this takes over the whole tab content and
// follows the same chrome as AdminDetail (lp-section-head → breadcrumb, eyebrow,
// title, sub, back/prev/next actions, then os-card blocks).
//
// Everything shown comes from the scraped roster row (public/iisc_professors.json).
// The `subdomains` and `notable_work` fields arrive as one semicolon-joined
// string each; they are split into real lists here, which is most of the reason
// this reads better than the drawer did.

import React, { useCallback, useEffect, useState } from "react";

import { academicProfilesApi } from "../../../../lib/academicProfilesApi";
import { TOKEN_TO_LABEL } from "../../../../lib/artparkDomains";
import { Stat } from "../shell/osAtoms";

const MATCH_TONE = { Yes: "purple", Partial: "amber", No: "" };
const MATCH_BLURB = {
  Yes: "Direct fit with ARTPARK's domains",
  Partial: "Adjacent fit — some overlap with ARTPARK's domains",
  No: "No meaningful overlap with ARTPARK's domains",
};

/** ARTPARK domain tokens off a "a; b; c" string. */
export const tokensOf = (md) =>
  String(md || "").split(";").map((t) => t.trim()).filter((t) => t && t !== "—");

/**
 * Split a semicolon-joined scrape field into list items, ignoring semicolons
 * inside brackets — several `notable_work` entries carry citation clusters like
 * "(Nat Rev Immunol 2022; Circ Res 2022)" that must not be torn in half.
 */
export function splitList(value) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(value || "")) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s && s !== "—");
}

// ── Live enrichment from the professor's own faculty page ──────────────────
//
// Cached server-side per URL, so this fetches once per professor ever. It is
// NOT auto-triggered: 809 professors × (page fetch + LLM) is real money and real
// outbound traffic, so an admin asks for it on the one profile they care about.
function ProfilePageDetails({ prof }) {
  const url = prof.profile_url;
  const [state, setState] = useState({ loading: true, row: null, enrichable: true, err: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!url) { setState({ loading: false, row: null, enrichable: false, err: null }); return; }
    setState((s) => ({ ...s, loading: true, err: null }));
    try {
      const r = await academicProfilesApi.get(url);
      setState({ loading: false, row: r?.profile || null, enrichable: r?.enrichable !== false, err: null });
    } catch (e) {
      setState({ loading: false, row: null, enrichable: true, err: e?.message || "Couldn't load." });
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const run = async (force) => {
    setBusy(true);
    try {
      const r = await academicProfilesApi.enrich(url, prof.name, force);
      setState((s) => ({ ...s, row: r?.profile || null, err: null }));
    } catch (e) {
      setState((s) => ({ ...s, err: e?.details?.message || e?.message || "Enrichment failed." }));
    } finally { setBusy(false); }
  };

  const row = state.row;
  const ex = row?.status === "done" ? (row.extracted || {}) : null;
  const nothingFound = ex && !hasAnything(ex);

  return (
    <Section label="From their profile page">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="os-row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {row?.status === "done" && (
            <span className="os-chip purple" style={{ fontSize: 10.5, fontWeight: 700 }}>FETCHED</span>
          )}
          {row?.status === "failed" && (
            <span className="os-chip red" style={{ fontSize: 10.5, fontWeight: 700 }}>FAILED</span>
          )}
          <span className="os-text-xs os-text-dim">
            {!state.enrichable
              ? "This professor's page isn't in the roster allow-list, so it can't be fetched."
              : row?.fetched_at
                ? `Read from ${new URL(url).hostname} · ${String(row.fetched_at).slice(0, 10)}`
                : "Not fetched yet — reads their faculty page and extracts the details."}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {state.enrichable && (
              <button
                className="os-btn sm"
                style={row ? undefined : { background: "#3213b7", color: "#fff" }}
                disabled={busy || state.loading}
                onClick={() => run(Boolean(row))}
              >
                {busy ? "Reading page…" : row ? "Re-fetch" : "Fetch details"}
              </button>
            )}
          </div>
        </div>

        {state.loading && <span className="os-text-soft os-text-sm">Checking…</span>}

        {state.err && (
          <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>
            {state.err}
          </div>
        )}

        {row?.status === "failed" && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)", padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 4 }}>
            {row.error || "Couldn't read that page."}
            {row.http_status ? ` (HTTP ${row.http_status})` : ""}
          </div>
        )}

        {nothingFound && (
          <div className="os-text-soft os-text-sm">
            That page had no extractable details — it may be a stub or an image-only page.
          </div>
        )}

        {ex && !nothingFound && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {ex.summary && (
              <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)" }}>{ex.summary}</div>
            )}

            {(ex.emails?.length || ex.phone || ex.position || ex.lab?.name) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                {ex.position && <KV label="Position">{ex.position}</KV>}
                {ex.emails?.length > 0 && (
                  <KV label={ex.emails.length > 1 ? "Emails" : "Email"}>
                    {ex.emails.map((e) => (
                      <div key={e}><a href={`mailto:${e}`} className="os-mono" style={{ fontSize: 12.5 }}>{e}</a></div>
                    ))}
                  </KV>
                )}
                {ex.phone && <KV label="Phone"><span className="os-mono" style={{ fontSize: 12.5 }}>{ex.phone}</span></KV>}
                {ex.lab?.name && (
                  <KV label="Lab">
                    {ex.lab.url
                      ? <a href={ex.lab.url} target="_blank" rel="noopener noreferrer">{ex.lab.name} ↗</a>
                      : ex.lab.name}
                  </KV>
                )}
              </div>
            )}

            {ex.research_interests?.length > 0 && (
              <KV label={`Research interests (${ex.research_interests.length})`}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                  {ex.research_interests.map((t, i) => (
                    <span key={i} className="os-chip" style={{ fontSize: 11.5, padding: "3px 9px" }}>{t}</span>
                  ))}
                </div>
              </KV>
            )}

            {ex.education?.length > 0 && (
              <KV label="Education"><BulletList items={ex.education} /></KV>
            )}

            {ex.publications?.length > 0 && (
              <KV label={`Selected publications (${ex.publications.length})`}>
                <table className="os-table" style={{ marginTop: 4 }}>
                  <thead>
                    <tr><th>Title</th><th style={{ width: "28%" }}>Venue</th><th className="num" style={{ width: 70 }}>Year</th></tr>
                  </thead>
                  <tbody>
                    {ex.publications.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{p.title}</td>
                        <td className="os-text-soft">{p.venue || "—"}</td>
                        <td className="num os-mono">{p.year || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </KV>
            )}

            {ex.awards?.length > 0 && (
              <KV label={`Awards & honours (${ex.awards.length})`}><BulletList items={ex.awards} /></KV>
            )}

            {ex.links?.length > 0 && (
              <KV label="Links">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                  {ex.links.map((l) => (
                    <a key={l.url} className="os-btn ghost sm" href={l.url} target="_blank"
                      rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                      {l.label} ↗
                    </a>
                  ))}
                </div>
              </KV>
            )}

            <div className="os-text-xs os-text-dim">
              Extracted from the page text by {row.model || "AI"} — treat as a reading aid, not a verified record.
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function KV({ label, children }) {
  return (
    <div>
      <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

/** Mirror of the backend's is_empty — an all-empty extraction is not data. */
export function hasAnything(ex) {
  if (!ex) return false;
  return Boolean(
    ex.emails?.length || ex.phone || ex.position || ex.lab?.name ||
    ex.education?.length || ex.research_interests?.length ||
    ex.publications?.length || ex.awards?.length || ex.links?.length || ex.summary,
  );
}

function Section({ label, children, count }) {
  return (
    <div className="os-card">
      <div className="os-card-head">
        <div className="os-card-title">{label}</div>
        {count != null && <span className="os-text-xs os-text-dim">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items, empty = "—" }) {
  if (!items.length) return <span className="os-text-soft os-text-sm">{empty}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((t, i) => (
        <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{t}</li>
      ))}
    </ul>
  );
}

export function AdminProfessorDetail({
  prof, recommended = [], invited = false, onBack, onInvite,
  onPrev, onNext, position,
}) {
  if (!prof) return null;

  const tokens = tokensOf(prof.matched_domains);
  const subdomains = splitList(prof.subdomains);
  const work = splitList(prof.notable_work);
  const tone = MATCH_TONE[prof.artpark_match] || "";

  // Recommended applications bucketed by the domain that matched them, so the
  // fit is explainable rather than just a count.
  const byToken = new Map(tokens.map((t) => [t, []]));
  for (const app of recommended) {
    for (const t of tokens) {
      if (TOKEN_TO_LABEL[t] && app.domain === TOKEN_TO_LABEL[t]) byToken.get(t).push(app);
    }
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onBack(); }}
              style={{ color: "#6f6f78", textDecoration: "none" }}
            >
              Academic jury roster
            </a>
            <span style={{ margin: "0 8px", color: "#c8c8d0" }}>/</span>
            <span style={{ color: "#8a8a92" }}>{prof.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>
            ACADEMIC JURY ROSTER · PROFESSOR
          </span>
          <h2 className="lp-section-title">
            {prof.name}
            {prof.duplicate_joint_appointment === "Yes" && (
              <span
                className="os-chip"
                title="Holds a joint appointment across departments"
                style={{ marginLeft: 12, fontSize: 10, fontWeight: 700, verticalAlign: "middle" }}
              >
                JOINT APPOINTMENT
              </span>
            )}
          </h2>
          <div className="lp-section-sub">
            {[prof.title, prof.department, prof.division].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="lp-section-actions">
          <div className="os-row gap-sm">
            {onPrev && <button className="os-btn ghost sm" onClick={onPrev}>← Prev professor</button>}
            {onNext && <button className="os-btn ghost sm" onClick={onNext}>Next professor →</button>}
          </div>
          <div className="os-row gap-sm">
            <button className="os-btn secondary" onClick={onBack}>← Back to roster</button>
            <button
              className="os-btn"
              style={invited ? undefined : { background: "#3213b7", color: "#fff" }}
              disabled={invited}
              onClick={onInvite}
            >
              {invited ? "Already invited" : "Invite to jury"}
            </button>
          </div>
        </div>
      </div>

      {position && (
        <div className="os-text-xs os-text-dim os-mono" style={{ marginBottom: 12 }}>
          {position}
        </div>
      )}

      {/* ── Stat row ───────────────────────────────────────────────────────── */}
      <div className="os-grid-3 os-mb-lg">
        <Stat
          tone={tone === "purple" ? "l1" : "l3"}
          num={prof.artpark_match || "—"}
          label="ARTPARK match"
          meta={MATCH_BLURB[prof.artpark_match] || ""}
        />
        <Stat
          tone="l2"
          num={String(tokens.length)}
          label="Matched domains"
          meta={tokens.length ? tokens.map((t) => TOKEN_TO_LABEL[t] || t).join(", ") : "None matched"}
        />
        <Stat
          tone="l3"
          num={String(recommended.length)}
          label="Recommended apps"
          meta="Jury-selected applications in their domains"
        />
      </div>

      <div className="os-stack gap-lg">
        {/* ── Research profile ───────────────────────────────────────────── */}
        <Section label="Research profile">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 5 }}>
                Research domain
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.45, color: "var(--ink)", fontWeight: 500 }}>
                {prof.research_domain || "—"}
              </div>
            </div>

            <div>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 7 }}>
                Subdomains{subdomains.length ? ` (${subdomains.length})` : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {subdomains.length
                  ? subdomains.map((s, i) => (
                      <span key={i} className="os-chip" style={{ fontSize: 11.5, padding: "3px 9px" }}>{s}</span>
                    ))
                  : <span className="os-text-soft os-text-sm">—</span>}
              </div>
            </div>

            <div>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 7 }}>
                Notable work{work.length ? ` (${work.length})` : ""}
              </div>
              <BulletList items={work} />
            </div>

            {prof.profile_url && (
              <div>
                <a
                  className="os-btn ghost sm"
                  href={prof.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none" }}
                >
                  View IISc profile ↗
                </a>
                <div className="os-text-xs os-text-dim os-mono" style={{ marginTop: 6, wordBreak: "break-all" }}>
                  {prof.profile_url}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ── Live detail read off their own faculty page ─────────────────── */}
        <ProfilePageDetails prof={prof} />

        {/* ── ARTPARK domain fit ─────────────────────────────────────────── */}
        <Section label="ARTPARK domain fit">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="os-row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <span className={"os-chip " + tone} style={{ fontWeight: 700 }}>
                {prof.artpark_match || "—"}
              </span>
              <span className="os-text-sm os-text-soft">{MATCH_BLURB[prof.artpark_match] || ""}</span>
            </div>

            {prof.reasoning && (
              <div
                style={{
                  borderLeft: "3px solid var(--line-strong, #c8c8d0)",
                  paddingLeft: 14, fontSize: 13.5, lineHeight: 1.55,
                  color: "var(--ink-soft)", fontStyle: "italic",
                }}
              >
                {prof.reasoning}
              </div>
            )}

            {tokens.length > 0 ? (
              <table className="os-table">
                <thead>
                  <tr>
                    <th style={{ width: "18%" }}>Domain</th>
                    <th>ARTPARK industry</th>
                    <th className="num" style={{ width: "18%" }}>Jury-selected apps</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t}>
                      <td>
                        <span className="os-chip" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{t}</span>
                      </td>
                      <td className="os-text-soft">{TOKEN_TO_LABEL[t] || "—"}</td>
                      <td className="num os-mono">{(byToken.get(t) || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="os-text-soft os-text-sm">
                No ARTPARK domain was matched for this professor.
              </span>
            )}
          </div>
        </Section>

        {/* ── Recommended applications ───────────────────────────────────── */}
        <Section
          label="Recommended jury-selected applications"
          count={recommended.length ? `${recommended.length} matched by domain` : null}
        >
          {recommended.length === 0 ? (
            <div
              style={{
                padding: "28px 20px", textAlign: "center", color: "var(--ink-soft)",
                border: "1px dashed var(--line)", borderRadius: 4, fontSize: 13,
              }}
            >
              No jury-selected applications match this professor's domains yet.
            </div>
          ) : (
            <table className="os-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Industry</th>
                  <th>Track</th>
                  <th className="num">AI score</th>
                </tr>
              </thead>
              <tbody>
                {recommended.map((a) => (
                  <tr key={a.track + a.id}>
                    <td>
                      <div className="startup">
                        {a.name}
                        <small>{a.founders?.[0] || "—"}</small>
                      </div>
                    </td>
                    <td className="os-text-soft">{a.domain || "—"}</td>
                    <td>
                      <span className="os-chip" style={{ fontSize: 11 }}>
                        {a.track === "tir" ? "TIR" : "VIP"}
                      </span>
                    </td>
                    <td className="num">
                      {a.ai?.overall != null
                        ? <b>{Number(a.ai.overall).toFixed(1)}</b>
                        : <span className="os-text-soft">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

export default AdminProfessorDetail;
