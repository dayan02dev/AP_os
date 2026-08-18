// Open milestones by status, open risks — the VIP process dashboard's
// Milestones & Risks panel (Task 6, full-width card, sits between
// MetricTrendPanel and AirTrajectoryPanel). Presentational only: no
// founderApi import, no fetching. Consumes `data` (the exact shape
// `vipDashboardRollup.milestonesAndRisks()` returns) and `emptyReason` (the
// exact shape `vipDashboardRollup.misEmptyReason()` returns) — never
// re-derives either from a raw period bundle itself.

// Duplicated verbatim from MetricTrendPanel.jsx — see that file's header
// comment for why this is a literal duplicate rather than a shared import:
// both panels must render states 6/7 with byte-identical copy.
// A fixed, hardcoded whitelist of the three OPEN statuses — deliberately
// NOT `Object.keys(data.milestones_by_status)`. `milestonesAndRisks()`
// already excludes "Done" rows from every group it returns, so this
// whitelist is redundant against today's rollup output — but it is what
// stops a "Done" (or any other unexpected) key from ever rendering here if
// that upstream guarantee were ever weakened, without this render layer
// silently trusting whatever keys the input object happens to carry. See
// this task's mutation check.
import { misEmptyCopy } from "../../../lib/misEmptyState.js";
const MILESTONE_STATUSES = ["On Track", "At Risk", "Blocked"];

const MILESTONE_STATUS_COLOR = {
  "On Track": "var(--accent-green)",
  "At Risk": "var(--accent-amber)",
  Blocked: "var(--accent-coral)",
};

const RISK_BADGE_LABEL = { red: "Red", amber: "Amber" };

export default function MilestonesRisksPanel({ data, emptyReason }) {
  return (
    <div className="card fj-dash-card">
      <div className="fj-dash-card-title">Milestones &amp; Risks</div>

      {data === null ? (
        <p className="vipd-air-status">{misEmptyCopy(emptyReason)}</p>
      ) : (
        <MilestonesRisksBody data={data} />
      )}
    </div>
  );
}

function MilestonesRisksBody({ data }) {
  const groups = MILESTONE_STATUSES.map((status) => ({
    status,
    rows: data.milestones_by_status?.[status] || [],
  }));
  const hasMilestones = groups.some((g) => g.rows.length > 0);
  const risks = data.risks || [];

  return (
    <>
      <div className="vipd-milestones">
        {hasMilestones ? (
          groups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <div key={g.status}>
                <div className="vipd-milestone-group-label">{g.status}</div>
                {g.rows.map((r, i) => (
                  <div className="fj-dash-exp-row" key={i}>
                    <span
                      className="fj-dash-exp-dot"
                      style={{ background: MILESTONE_STATUS_COLOR[g.status] }}
                    />
                    <span className="fj-dash-exp-short">{r.data?.milestone}</span>
                    <span className="fj-dash-exp-status">{r.data?.owner || ""}</span>
                  </div>
                ))}
              </div>
            ))
        ) : (
          // State 12 — independent of the risks empty-copy below; a period
          // with milestones but no risks (or vice versa) must show real
          // rows on one side next to the empty-copy on the other, never
          // one blanket empty state for the whole panel.
          <p className="vipd-air-status">No open milestones this period.</p>
        )}
      </div>

      <div className="vipd-risks">
        {risks.length === 0 ? (
          <p className="vipd-air-status">No risks reported this period.</p>
        ) : (
          risks.map((r, i) => (
            <div className="vipd-risk-row" key={i}>
              <span className={`vipd-risk-badge vipd-risk-badge-${r.data?.severity}`}>
                {RISK_BADGE_LABEL[r.data?.severity] || r.data?.severity}
              </span>
              <div className="vipd-risk-body">
                <div className="vipd-risk-what">{r.data?.what_happened}</div>
                {r.data?.impact && <div className="vipd-risk-meta">Impact: {r.data.impact}</div>}
                {r.data?.mitigation && <div className="vipd-risk-meta">Mitigation: {r.data.mitigation}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
