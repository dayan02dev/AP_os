// Concise reviewer-recommendation cell for the staff pipeline tables (leadership,
// admin) plus a single-value badge for the reviewer queue's "My Reco".
//   RecoCell  — a {yes,maybe,no} tally → one chip when unanimous, "2Y 1N" when mixed, "—" when empty.
//   RecoBadge — a single "yes"|"maybe"|"no" value → one chip, or "—" when null.
import React from "react";

export const RECO_ORDER = ["yes", "maybe", "no"];
export const RECO_LABEL = { yes: "YES", maybe: "MAYBE", no: "NO" };
export const RECO_LETTER = { yes: "Y", maybe: "M", no: "N" };
export const RECO_COLOR = { yes: "#1a7f4b", maybe: "#a86b00", no: "#b42318" };

// Mirrors backend admin_query.reco_verdict — keep the two in sync.
// Strict majority (> half of all submitted reviews) -> "yes"/"no";
// anything else with >=1 review -> "maybe"; no reviews -> null.
export function aggregateReco(reco) {
  const t = reco || {};
  const yes = Number(t.yes || 0);
  const maybe = Number(t.maybe || 0);
  const no = Number(t.no || 0);
  const total = yes + maybe + no;
  if (total === 0) return null;
  if (yes * 2 > total) return "yes";
  if (no * 2 > total) return "no";
  return "maybe";
}

// Tooltip text preserving the vote breakdown, e.g. "3 yes · 1 maybe · 1 no".
export function recoTitle(reco) {
  const t = reco || {};
  return RECO_ORDER.filter((k) => Number(t[k] || 0) > 0)
    .map((k) => `${Number(t[k])} ${k}`)
    .join(" · ");
}

const chipStyle = (color) => ({
  display: "inline-block", padding: "1px 7px", borderRadius: 999,
  fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
  color, background: `${color}1a`, border: `1px solid ${color}55`,
});
const Dash = () => <span style={{ color: "var(--ink-dim)" }}>—</span>;

export function RecoBadge({ value }) {
  if (!value || !RECO_LABEL[value]) return <Dash />;
  return <span style={chipStyle(RECO_COLOR[value])}>{RECO_LABEL[value]}</span>;
}

export function RecoCell({ reco }) {
  const t = reco || {};
  const parts = RECO_ORDER
    .map((k) => ({ key: k, n: Number(t[k] || 0) }))
    .filter((p) => p.n > 0);
  if (parts.length === 0) return <Dash />;
  if (parts.length === 1) return <RecoBadge value={parts[0].key} />;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {parts.map((p) => (
        <span key={p.key} style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: RECO_COLOR[p.key] }}>
          {p.n}{RECO_LETTER[p.key]}
        </span>
      ))}
    </span>
  );
}
