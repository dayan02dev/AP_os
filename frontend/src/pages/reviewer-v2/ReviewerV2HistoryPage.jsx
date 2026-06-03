import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApiV2 } from "../../lib/reviewerApiV2.js";
import { useAsync } from "./components/useAsync.js";
import { LoadingState, ErrorState, Chip } from "./components/atoms.jsx";
// Q4: use the existing EditWindowCountdown from the production reviewer module
import EditWindowCountdown from "../reviewer/scoring/EditWindowCountdown.jsx";
import { ReviewerCohortHeader, ReviewerTabBar } from "./ReviewerV2AppShell.jsx";

function recoTone(r) {
  return r === "yes" ? "green" : r === "no" ? "red" : "amber";
}

// Q4: "Re-open to edit" only within the 60-min window.
// Past-cohort history rows have editWindowExpiresAt: null → button hidden.
// Current-cohort submitted rows: editWindowExpiresAt = locked_at from the DB
// (mock sets it to null for history rows, so they show as locked).
function isEditable(row) {
  if (!row.editWindowExpiresAt) return false;
  return new Date(row.editWindowExpiresAt).getTime() > Date.now();
}

export default function ReviewerV2HistoryPage() {
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsync(() => reviewerApiV2.getHistory(), []);

  const history = data ? data.rows : [];
  const stats   = data ? data.stats : null;

  const handleTab = (t) => {
    if (t === "queue" || t === "dashboard") navigate("/reviewer-v2/inbox");
    // "history" stays here
  };

  // Navigate back to eval page for a row
  const openEval = (row) => {
    const idx = parseInt(String(row.appId).replace("s", ""), 10) - 1;
    navigate(`/reviewer-v2/eval/${idx}`);
  };

  return (
    <>
      <ReviewerCohortHeader onExportCsv={() => {}} />
      <ReviewerTabBar tab="history" setTab={handleTab} />

      <div className="lp-tab-content">
        <div className="lp-section-head">
          <div>
            <span className="lp-section-eyebrow">R-3 · MY HISTORY</span>
            <h2 className="lp-section-title">Review history</h2>
            <div className="lp-section-sub">
              Every evaluation you've submitted, your recommendation, and the admin's final decision.
            </div>
          </div>
        </div>

        {/* Stats tiles — Phase 1 §3 gap: aggregate stats not yet from the real API */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", border: "1px solid #e3e3e8", borderRadius: 6, overflow: "hidden", background: "#fff", marginBottom: 28 }}>
            {[
              { label: "TOTAL REVIEWS",   num: stats.total },
              { label: "CONSISTENCY",     num: typeof stats.consistencyPct === "number" ? stats.consistencyPct + "%" : "—" },
              { label: "AVG VARIANCE",    num: stats.avgVariance },
              { label: "AVG TIME (MIN)",  num: stats.avgMinutes },
            ].map((t) => (
              <div key={t.label} className="dash-stat-tile" style={{ padding: "22px 24px" }}>
                <div className="dash-stat-label">{t.label}</div>
                <div className="dash-stat-num">{t.num}</div>
              </div>
            ))}
          </div>
        )}

        {loading && <LoadingState label="Loading your history…" />}
        {!loading && error && <ErrorState error={error} onRetry={reload} />}

        {!loading && !error && history.length === 0 && (
          <div className="os-text-dim" style={{ textAlign: "center", padding: "64px 0" }}>
            No submitted reviews yet.
          </div>
        )}

        {history.length > 0 && (
          <table className="os-table">
            <thead>
              <tr>
                <th>Startup</th>
                <th>Date</th>
                <th>My score</th>
                <th>My reco</th>
                <th>AI score</th>
                <th>Variance</th>
                <th>Admin decision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td><b>{h.name}</b></td>
                  <td className="os-text-sm" style={{ color: "var(--ink-soft)" }}>{h.date}</td>
                  <td className="os-mono"><b>{typeof h.myScore === "number" ? h.myScore.toFixed(1) : "—"}</b></td>
                  <td>
                    {h.reco && h.reco !== "—"
                      ? <Chip tone={recoTone(h.reco)}>{h.reco.toUpperCase()}</Chip>
                      : <span className="os-text-dim">—</span>}
                  </td>
                  <td className="os-text-dim">{h.aiScore}</td>
                  <td className="os-text-dim">{h.variance}</td>
                  <td>
                    {h.adminDec && h.adminDec !== "—"
                      ? <Chip tone={h.adminDec === "approved" ? "green" : h.adminDec === "rejected" ? "red" : "slate"}>
                          {h.adminDec.toUpperCase()}
                        </Chip>
                      : <span className="os-text-dim">—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {isEditable(h) ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                          Edit window: <EditWindowCountdown lockedAt={h.editWindowExpiresAt} onExpire={() => reload()} />
                        </span>
                        <button className="os-btn sm ghost" onClick={() => openEval(h)}>✎ Edit</button>
                      </div>
                    ) : (
                      <Chip tone="slate">Locked</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
