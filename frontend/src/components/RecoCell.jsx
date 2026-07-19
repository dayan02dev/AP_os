// Concise reviewer-recommendation cell for the staff pipeline tables (leadership,
// admin) plus a single-value badge for the reviewer queue's "My Reco".
//   RecoCell  — a {yes,maybe,no} tally → ONE aggregate verdict chip (majority wins;
//               "—" when no reviews); optional onSelect turns it into a filter button.
//   RecoBadge — a single "yes"|"maybe"|"no" value → one chip, or "—" when null.
import React from "react";

export const RECO_ORDER = ["yes", "maybe", "no"];
export const RECO_LABEL = { yes: "YES", maybe: "MAYBE", no: "NO" };
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

export function RecoCell({ reco, onSelect }) {
  const verdict = aggregateReco(reco);
  const title = recoTitle(reco) || undefined;
  const content = verdict
    ? <span title={title} style={chipStyle(RECO_COLOR[verdict])}>{RECO_LABEL[verdict]}</span>
    : <Dash />;
  if (!onSelect) return content;
  return (
    <button
      type="button"
      aria-label={`Filter by reco: ${verdict || "none"}`}
      onClick={(e) => { e.stopPropagation(); onSelect(verdict || "none"); }}
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
    >
      {content}
    </button>
  );
}
