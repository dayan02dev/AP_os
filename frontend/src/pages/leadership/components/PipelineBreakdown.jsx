// PipelineBreakdown — gate-aware status breakdown for the Dashboard tab.
//
// Reads GET /leadership/stats → pipeline_breakdown (contract C1): mutually
// exclusive stages that sum to `total`. Labels come from pipelineStages.js so
// they match the Status chips, the list rows and the admin dashboard. Clicking
// a stage filters the Applications tab to it.

import { STAGE_BY_ID } from "../pipelineStages.js";

function Cell({ id, label, n, stage, activeStage, onFilter, sub = false }) {
  const isActive = id && activeStage === id;
  const dot = stage?.color
    ? <span className="lp-status-dot" style={{ background: stage.color }} />
    : <span className={`lp-status-dot lp-status-${stage?.dot || "open"}`} />;
  const body = (
    <>
      {dot}
      <span className="lp-status-cell-label">{label}</span>
      <span className="eir-mono lp-status-cell-n">{n ?? 0}</span>
    </>
  );
  const style = sub ? { marginLeft: 16 } : undefined;
  if (!id || !onFilter) {
    return <div className="lp-status-cell" style={{ ...style, cursor: "default" }}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`lp-status-cell${isActive ? " is-on" : ""}`}
      style={style}
      onClick={() => onFilter(id)}
      aria-pressed={!!isActive}
    >
      {body}
    </button>
  );
}

export default function PipelineBreakdown({ breakdown, activeStage, onFilter }) {
  const st = breakdown?.stages || {};
  const stage = (id) => ({
    id, label: STAGE_BY_ID[id].label, n: st[id], stage: STAGE_BY_ID[id],
  });
  const common = { activeStage, onFilter };
  const holdN = (st.on_hold ?? 0) + (st.waitlisted ?? 0);
  return (
    <div className="lp-card lp-card-wide" style={{ marginTop: "var(--s-5)" }} data-testid="lp-breakdown">
      <div className="lp-card-head">
        <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
          § Status breakdown
        </span>
        <h2 className="lp-card-title">
          Where all {breakdown?.total ?? 0} applications stand
        </h2>
        <p className="lp-card-blurb">
          Every submitted application sits in exactly one bucket. Click one to open the
          Applications tab filtered to it.
        </p>
      </div>
      <div className="lp-status-grid">
        <Cell {...stage("submitted")} {...common} />
        <Cell {...stage("under_review")} {...common} />
        <Cell {...stage("reviewed")} {...common} />
        <Cell {...stage("gate1_rejected")} {...common} />
      </div>
      <div className="lp-status-grid" style={{ marginTop: "var(--s-3)" }}>
        <Cell label="1st-gate selected" n={breakdown?.gate1_selected} stage={{ dot: "advance" }} />
        <Cell {...stage("final_pending")} {...common} sub />
        <Cell {...stage("final_rejected")} {...common} sub />
        <Cell {...stage("final_selected")} {...common} sub />
        <Cell {...stage("offered")} {...common} sub />
        <Cell {...stage("onboarded")} {...common} sub />
      </div>
      <div className="lp-status-grid" style={{ marginTop: "var(--s-3)" }}>
        <Cell label="On hold / Waitlisted" n={holdN} stage={{ dot: "decision" }} />
        <Cell {...stage("withdrawn")} {...common} />
      </div>
      {breakdown?.rejected_total != null && (
        <p style={{ margin: "var(--s-3) 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
          Rejected in total: {breakdown.rejected_total} ({st.gate1_rejected ?? 0} at the 1st gate
          {" · "}{st.final_rejected ?? 0} in the final round)
        </p>
      )}
    </div>
  );
}
