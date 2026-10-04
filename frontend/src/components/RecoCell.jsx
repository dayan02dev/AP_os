// Concise reviewer-recommendation cell for the staff pipeline tables (leadership,
// admin) plus a single-value badge for the reviewer queue's "My Reco".
//   RecoCell  — a {yes,maybe,no} tally → ONE aggregate verdict chip (majority wins;
//               "—" below 2 reviews); optional onSelect turns it into a filter button.
//               `splitSingle` (opt-in) tells "no reviews" ("—", filter "none") apart
//               from "1 review — needs 2" (chip, filter "single").
//   RecoBadge — a single "yes"|"maybe"|"no" value → one chip, or "—" when null.
import React from "react";

export const RECO_ORDER = ["yes", "maybe", "no"];
export const RECO_LABEL = { yes: "YES", maybe: "MAYBE", no: "NO" };
export const RECO_COLOR = { yes: "#1a7f4b", maybe: "#a86b00", no: "#b42318" };

// Mirrors backend admin_query.reco_verdict — keep the two in sync.
// Needs >= 2 submitted reviews; then >=2 yes (and <2 no) -> "yes",
// >=2 no (and <2 yes) -> "no", otherwise "maybe". <2 reviews -> null ("—").
export function aggregateReco(reco) {
  const t = reco || {};
  const yes = Number(t.yes || 0);
  const maybe = Number(t.maybe || 0);
  const no = Number(t.no || 0);
  const total = yes + maybe + no;
  if (total < 2) return null;
  if (yes >= 2 && no < 2) return "yes";
  if (no >= 2 && yes < 2) return "no";
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

const PENDING_COLOR = "#6b6b6b";

export function RecoCell({ reco, onSelect, splitSingle = false, reviewCount }) {
  const verdict = aggregateReco(reco);
  const title = recoTitle(reco) || undefined;
  const t = reco || {};
  const count = typeof reviewCount === "number"
    ? reviewCount
    : Number(t.yes || 0) + Number(t.maybe || 0) + Number(t.no || 0);
  // Below the 2-review threshold: "single" (exactly one review) or "none".
  const bucket = verdict || (splitSingle && count === 1 ? "single" : "none");
  let content;
  if (verdict) {
    content = <span title={title} style={chipStyle(RECO_COLOR[verdict])}>{RECO_LABEL[verdict]}</span>;
  } else if (bucket === "single") {
    content = (
      <span title={`${title ? `${title} · ` : ""}needs 2 reviews for a verdict`}
        style={{ ...chipStyle(PENDING_COLOR), fontWeight: 600 }}>1 review</span>
    );
  } else {
    content = splitSingle
      ? <span title="No reviews" style={{ color: "var(--ink-dim)" }}>—</span>
      : <Dash />;
  }
  if (!onSelect) return content;
  return (
    <button
      type="button"
      aria-label={`Filter by reco: ${bucket}`}
      onClick={(e) => { e.stopPropagation(); onSelect(bucket); }}
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
    >
      {content}
    </button>
  );
}
