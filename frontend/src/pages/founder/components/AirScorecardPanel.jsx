// The VIP process dashboard's centrepiece — the current AIR round at a
// glance, replacing TIR's Experiments panel in the dashboard's two-column
// row (Task 7). Presentational only, same discipline as AirBar.jsx /
// LeverPanel.jsx: no founderApi import, no fetching. Renders all six AIR
// states 1-5 from the plan's "failure mode" table — every state has its own
// copy, never a shared fallback.
import AirBar from "./AirBar.jsx";
import { Tile } from "../ui.jsx";

// Copied, not imported — same small-guard-duplication precedent
// FounderTlr.jsx already follows for this exact constant (see
// founder_mis.py's require_vip docstring, cited there for the same reason).
const FAMILY_LABEL = { technology: "Technology / R&D", commercial: "Product / Engineering" };
const FAMILY_COLOR = { technology: "var(--artblue)", commercial: "var(--accent-violet)" };

// States 2-5 (the plan's table). `round.status !== "draft"` always means
// "submitted" today (there is no third status), so it is treated as state 5
// unconditionally rather than gated on the literal string, matching
// LeverPanel.jsx's own precedent of trusting the shape rather than an exact
// enum match. States 2-4 are told apart purely by how many levers carry a
// claimed_level — never re-derived from rollups, which can legitimately be
// null mid-way through a family (state 3) while individual levers already
// carry answers.
function statusCopy(round, levers) {
  if (round.status !== "draft") {
    const date = round.submitted_at ? new Date(round.submitted_at).toLocaleDateString() : null;
    return date
      ? `Submitted ${date} — awaiting ARTPARK verification.`
      : "Submitted — awaiting ARTPARK verification.";
  }
  const answered = levers.filter((l) => l.claimed_level != null).length;
  if (answered === 0) return "You haven't started this quarter's AIR self-assessment yet.";
  if (answered < levers.length) {
    return "Technology / Commercial / Overall AIR appear once every lever in that group has an answer.";
  }
  return "Draft — submit your scorecard from TLR evaluation to send it for ARTPARK review.";
}

// The rollup Tile for one family (or Overall): claimed is always the
// primary number, "—" when null; a verified figure is only ever shown
// inline when it exists AND differs from claimed (verified is null for
// every lever of every venture today — no admin surface yet, Phase 7 — so
// this branch does not render anywhere in the app currently, but must not
// be hardcoded away).
function RollupTile({ label, claimedVal, verifiedVal }) {
  const showVerified = verifiedVal != null && verifiedVal !== claimedVal;
  return (
    <Tile k={label} v={claimedVal ?? "—"}>
      {showVerified && <span className="fj-air-bar-verified-val"> (verified {verifiedVal})</span>}
    </Tile>
  );
}

// The overall-rule marker: a vertical line across a family's bar list at
// the position `rollups.claimed.overall` would sit on the 1-9 scale,
// rendered only when there IS an overall value to mark (state 3 — a
// half-complete round has no overall yet, so nothing is drawn). Divides by
// 9, the ladder's own max (AirBar's default `max` prop) — NOT 10, which
// would silently misplace every marker (see this task's mutation check).
function RuleMarker({ overall }) {
  if (overall == null) return null;
  const left = `${((overall / 9) * 100).toFixed(2)}%`;
  return <div className="vipd-air-rule" style={{ left }} aria-hidden="true" />;
}

function FamilyGroup({ family, levers, overallClaimed }) {
  const familyLevers = levers.filter((l) => l.family === family);
  return (
    <div className="fj-air-scorecard-group">
      <span className="eyebrow" style={{ color: FAMILY_COLOR[family] }}>{FAMILY_LABEL[family] || family}</span>
      <div className="vipd-air-family-wrap">
        <RuleMarker overall={overallClaimed} />
        {familyLevers.map((l) => (
          <AirBar key={l.lever} name={l.name} claimed={l.claimed_level} verified={l.verified_level} />
        ))}
      </div>
    </div>
  );
}

export default function AirScorecardPanel({ round, levers, rollups }) {
  const claimed = rollups.claimed || {};
  const verified = rollups.verified || {};
  // State 1: verified is structurally null (no admin verification surface
  // exists yet) — but the badge only means something once there is a
  // claimed overall to await verification ON; before that, "Not started"
  // (state 2) or the partial-round copy (state 3) already explains the
  // empty verified figure, so showing "Awaiting ARTPARK verification" too
  // would be a second, redundant explanation for the same blank.
  const showVerifyBadge = claimed.overall != null && verified.overall == null;

  return (
    <div className="card fj-dash-card">
      <div className="fj-dash-card-title">AIR Scorecard</div>
      <p className="vipd-air-status">{statusCopy(round, levers)}</p>

      <div className="fj-air-rollups">
        <RollupTile label="Technology AIR" claimedVal={claimed.technology} verifiedVal={verified.technology} />
        <RollupTile label="Commercial AIR" claimedVal={claimed.commercial} verifiedVal={verified.commercial} />
        <RollupTile label="Overall AIR" claimedVal={claimed.overall} verifiedVal={verified.overall} />
      </div>

      {showVerifyBadge && (
        <div className="vipd-verify-badge" role="status">Awaiting ARTPARK verification</div>
      )}

      <FamilyGroup family="technology" levers={levers} overallClaimed={claimed.overall} />
      <FamilyGroup family="commercial" levers={levers} overallClaimed={claimed.overall} />
    </div>
  );
}
