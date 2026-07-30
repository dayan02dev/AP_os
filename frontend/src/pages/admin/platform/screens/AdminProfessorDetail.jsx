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

import React from "react";

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
