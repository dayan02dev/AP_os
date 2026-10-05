// Reviewer history — ported from REVIEWER-UI/os/reviewer.jsx ReviewerHistory.
// Rows come from reviewerApi.getHistory() → { stats, rows }. Each row carries
// (track, appId) so the action button routes to the same eval screen as the
// queue. "✎ Edit" only while the row's `canEdit` is true (still assigned and
// not yet decided); otherwise "View" opens the evaluation read-only.

import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import { displayIdText } from "../../../lib/trackLabel.js";
import { LoadingState, ErrorState, EmptyState, Chip } from "./ui.jsx";

// Admin-decision buckets (backend reviewer_query._admin_decision, contract C5).
export const DECISION_LABEL = {
  pending: "Awaiting admin",
  gate1_selected: "1st-gate selected",
  gate1_rejected: "1st-gate rejected",
  final_selected: "Final selected",
  final_rejected: "Final-gate rejected",
  offered: "Offered",
  onboarded: "Onboarded",
};
const DECISION_TONE = {
  pending: "slate",
  gate1_selected: "amber",
  gate1_rejected: "red",
  final_selected: "green",
  final_rejected: "red",
  offered: "green",
  onboarded: "green",
};
export const decisionLabel = (d) => DECISION_LABEL[d] || DECISION_LABEL.pending;

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const fmtNum = (v, dp = 1) => (typeof v === "number" ? v.toFixed(dp) : "—");

export default function ReviewerHistory({ onOpenEval }) {
  const { data, loading, error, reload } = useAsync(() => reviewerApi.getHistory(), []);

  if (loading)
    return (
      <div style={{ padding: "48px 0" }}>
        <LoadingState label="Loading your history…" />
      </div>
    );
  if (error)
    return (
      <div style={{ padding: "48px 0" }}>
        <ErrorState error={error} onRetry={reload} />
      </div>
    );

  const history = (data && data.rows) || [];
  const stats = (data && data.stats) || {};
  const recoTone = (r) => (r === "yes" ? "green" : r === "no" ? "red" : "amber");
  const decisionCounts = history.reduce((m, h) => {
    const k = DECISION_LABEL[h.adminDecision] ? h.adminDecision : "pending";
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  return (
    <div>
      <div className="lp-section-head">
        <div>
          <span className="lp-section-eyebrow">R-3 · MY HISTORY</span>
          <h2 className="lp-section-title">Review history</h2>
          <div className="lp-section-sub">
            Every evaluation you’ve submitted, the recommendation you made, and the admin’s final decision.
          </div>
          {history.length > 0 && (
            <div className="lp-section-sub" style={{ marginTop: 6 }}>
              {history.length} evaluations
              {typeof stats.avgVariance === "number" ? ` · avg variance vs AI ${stats.avgVariance.toFixed(2)}` : ""}
            </div>
          )}
        </div>
      </div>
      {history.length > 0 && (
        <div className="os-row gap-sm" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          {Object.keys(DECISION_LABEL)
            .filter((k) => decisionCounts[k])
            .map((k) => (
              <Chip key={k} tone={DECISION_TONE[k]}>
                {DECISION_LABEL[k]} · {decisionCounts[k]}
              </Chip>
            ))}
        </div>
      )}
      {history.length === 0 ? (
        <EmptyState label="You haven’t submitted any reviews yet." />
      ) : (
        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th>Date</th>
              <th>My score</th>
              <th>AI</th>
              <th>Δ</th>
              <th>My reco</th>
              <th>Admin decision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => {
              const adminDec = DECISION_LABEL[h.adminDecision] ? h.adminDecision : "pending";
              const canEdit = h.canEdit !== false;
              return (
                <tr key={h.reviewId || i}>
                  <td>
                    <b>{h.name}</b>
                    {(h.applicationId || h.org) && (
                      <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3, fontFamily: "var(--font-code)" }}>
                        {[displayIdText(h.applicationId, h.movedToTrack), h.org].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="os-text-sm" style={{ color: "var(--ink-soft)" }}>
                    {fmtDate(h.date)}
                  </td>
                  <td className="num">
                    <b>{fmtNum(h.myScore)}</b>
                  </td>
                  <td className="num">{fmtNum(h.aiScore)}</td>
                  <td className="num">{fmtNum(h.variance)}</td>
                  <td>
                    <Chip tone={recoTone(h.reco)}>{(h.reco || "—").toUpperCase()}</Chip>
                  </td>
                  <td>
                    <Chip tone={DECISION_TONE[adminDec]}>{DECISION_LABEL[adminDec]}</Chip>
                  </td>
                  <td>
                    <button
                      className="os-btn sm ghost"
                      title={canEdit ? "Edit this evaluation" : "View this evaluation (read-only)"}
                      onClick={() => onOpenEval(h.track, h.appId)}
                    >
                      {canEdit ? "✎ Edit" : "View"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
