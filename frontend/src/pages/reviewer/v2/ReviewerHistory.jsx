// Reviewer history — ported from REVIEWER-UI/os/reviewer.jsx ReviewerHistory.
// Rows come from reviewerApi.getHistory() → { stats, rows }. Each row carries
// (track, appId) so "✎ Edit" routes to the same eval screen as the queue.
// Edit is always available — the backend no longer locks evaluations after 60 min.

import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import { LoadingState, ErrorState, EmptyState, Chip } from "./ui.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

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
  const recoTone = (r) => (r === "yes" ? "green" : r === "no" ? "red" : "amber");
  return (
    <div>
      <div className="lp-section-head">
        <div>
          <span className="lp-section-eyebrow">R-3 · MY HISTORY</span>
          <h2 className="lp-section-title">Review history</h2>
          <div className="lp-section-sub">
            Every evaluation you’ve submitted, the recommendation you made, and the admin’s final decision.
          </div>
        </div>
      </div>
      {history.length === 0 ? (
        <EmptyState label="You haven’t submitted any reviews yet." />
      ) : (
        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th>Date</th>
              <th>My score</th>
              <th>My reco</th>
              <th>Admin decision</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => {
              const adminDec = h.adminDecision || "pending";
              return (
                <tr key={h.reviewId || i}>
                  <td>
                    <b>{h.name}</b>
                  </td>
                  <td className="os-text-sm" style={{ color: "var(--ink-soft)" }}>
                    {fmtDate(h.date)}
                  </td>
                  <td className="num">
                    <b>{typeof h.myScore === "number" ? h.myScore.toFixed(1) : "—"}</b>
                  </td>
                  <td>
                    <Chip tone={recoTone(h.reco)}>{(h.reco || "—").toUpperCase()}</Chip>
                  </td>
                  <td>
                    <Chip tone={adminDec === "approved" ? "green" : adminDec === "rejected" ? "red" : "slate"}>
                      {adminDec.toUpperCase()}
                    </Chip>
                  </td>
                  <td>
                    <button
                      className="os-btn sm ghost"
                      title="Edit this evaluation"
                      onClick={() => onOpenEval(h.track, h.appId)}
                    >
                      ✎ Edit
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
