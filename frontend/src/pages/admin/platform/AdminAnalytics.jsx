// AdminAnalytics — A-9 Reviewer Calibration (Task 20)
//
// Read-only analytics surface. Fetches
// GET /admin/platform/analytics/reviewer-calibration
// (adminPlatformApi.getCalibration) once on mount and renders per-reviewer
// calibration metrics:
//
//   Response: { reviewers: [{ user_id, name, n_reviews, avg_score,
//                             avg_variance_vs_ai }] }
//
// avg_score and avg_variance_vs_ai may be null (reviewer with no scored
// reviews, or no overlapping AI baseline) and must render "—", never crash.
//
// Variance interpretation: LOW variance vs the AI baseline is GOOD (reviewer
// tracks the model closely); HIGH variance is worth a look. Each reviewer gets
// a small bar whose width scales with variance and whose colour encodes the
// band (green = low/good, amber = mid, red = high).

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "./ui.jsx";

// Variance is |weighted reviewer overall − AI overall| on a 0–10 scale, so it
// realistically sits in 0–~4. Scale the bar against a 3.0 ceiling for contrast.
const VARIANCE_CEILING = 3.0;

function varianceBand(v) {
  if (v === null || v === undefined) return "none";
  if (v < 1.0) return "good";
  if (v < 2.0) return "mid";
  return "high";
}

const BAND_COLOR = {
  good: "#2a8f5a",
  mid: "#c98a00",
  high: "#d23b40",
  none: "var(--line)",
};

export default function AdminAnalytics() {
  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getCalibration(),
    [],
  );

  const reviewers = data?.reviewers ?? [];

  return (
    <div className="dash-scroll">
      <style>{ANALYTICS_CSS}</style>

      <div className="pl-head">
        <div>
          <div className="dash-section-tag">A-9 · ANALYTICS</div>
          <div className="dash-card-title">Reviewer calibration</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            How closely each reviewer tracks the AI baseline. Lower variance is
            better.
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading calibration…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : reviewers.length === 0 ? (
        <EmptyState label="No reviewer calibration data yet." />
      ) : (
        <div className="pl-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th className="num"># reviews</th>
                <th className="num">Avg score</th>
                <th style={{ minWidth: 220 }}>Avg variance vs AI</th>
              </tr>
            </thead>
            <tbody>
              {reviewers.map((r) => {
                const variance = r?.avg_variance_vs_ai;
                const band = varianceBand(variance);
                const hasVariance =
                  variance !== null && variance !== undefined;
                const pct = hasVariance
                  ? Math.max(
                      4,
                      Math.min(100, (variance / VARIANCE_CEILING) * 100),
                    )
                  : 0;
                return (
                  <tr key={r?.user_id ?? r?.name}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>
                      {r?.name ?? "—"}
                    </td>
                    <td className="num">
                      {typeof r?.n_reviews === "number" ? r.n_reviews : "—"}
                    </td>
                    <td className="num">
                      {typeof r?.avg_score === "number"
                        ? r.avg_score.toFixed(1)
                        : "—"}
                    </td>
                    <td>
                      {hasVariance ? (
                        <div className="cal-var">
                          <div className="cal-var-track">
                            <div
                              className="cal-var-fill"
                              style={{
                                width: pct + "%",
                                background: BAND_COLOR[band],
                              }}
                            />
                          </div>
                          <span
                            className="cal-var-num"
                            style={{ color: BAND_COLOR[band] }}
                          >
                            {variance.toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ANALYTICS_CSS = `
.adm-portal .pl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.adm-portal .pl-table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; }
.adm-portal .cal-var { display:flex; align-items:center; gap:10px; }
.adm-portal .cal-var-track {
  flex:1; min-width:120px; height:8px; background:var(--bg-soft, #f1f1f1);
  border:1px solid var(--line); border-radius:4px; overflow:hidden;
}
.adm-portal .cal-var-fill { height:100%; border-radius:4px; }
.adm-portal .cal-var-num {
  font-family:var(--font-mono); font-size:12px; font-weight:600;
  min-width:34px; text-align:right; font-variant-numeric:tabular-nums;
}
`;
