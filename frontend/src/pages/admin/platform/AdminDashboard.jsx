// AdminDashboard — A-0 (Task 15)
//
// The admin portal's home surface. Reads the bundled stats payload from
// GET /admin/platform/stats (adminPlatformApi.getStats) which is the
// leadership stats shape — totals / funnel / status_counts / ai_score_overalls
// — PLUS an extra `decisions` dict counting admin_decisions rows by their
// decision value (shortlisted / on_hold / rejected / waitlisted).
//
// Visuals reuse the `dash-*` classes scoped under `.adm-portal` in
// admin-portal.css (ported from the A-0 prototype). The number-crunching
// (AI-score histogram binning, funnel max, KPI derivations) mirrors
// LeadershipDashboard so the two screens compute identical figures from the
// same data.
//
// Every field access is guarded with `?.`/defaults — the payload's keys can
// be missing (e.g. `decisions` is empty when no gate-1 decisions exist yet, or
// drops entirely if the admin_decisions fetch failed backend-side), so a
// missing key renders an empty/zero tile instead of crashing.

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { useAsync, LoadingState, ErrorState } from "./ui.jsx";

const HISTOGRAM_BIN_COUNT = 10;

// 10 bins over 0..10 — identical bucketing to LeadershipDashboard.buildHistogram
// (floor((s/10)*10), clamping 10.0 into the top bin). Exported for the trivial
// unit test; pure, no React.
export function buildHistogram(scores, binCount = HISTOGRAM_BIN_COUNT) {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: (10 / binCount) * i,
    to: (10 / binCount) * (i + 1),
    count: 0,
  }));
  for (const s of scores || []) {
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    let idx = Math.floor((s / 10) * binCount);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  const total = bins.reduce((acc, b) => acc + b.count, 0);
  let medianIdx = -1;
  if (total > 0) {
    let cum = 0;
    for (let i = 0; i < bins.length; i += 1) {
      cum += bins[i].count;
      if (cum >= total / 2) { medianIdx = i; break; }
    }
  }
  return { bins, medianIdx, total };
}

function meanOf(arr) {
  const xs = (arr || []).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function medianOf(arr) {
  const xs = (arr || [])
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Coarse status → dot colour, matching the prototype's StatusBreakdown tones.
const STATUS_DOT = {
  submitted:    "#b7a06a",
  ai_screening: "#3213b7",
  under_review: "#3213b7",
  evaluated:    "#3213b7",
  shortlisted:  "#2a8f5a",
  interview:    "#2a8f5a",
  offered:      "#242424",
  onboarded:    "#242424",
  rejected:     "#242424",
  waitlisted:   "#242424",
  withdrawn:    "#242424",
};

// Admin gate-1 decision tiles — fixed order/labels so a missing key in the
// backend `decisions` dict still renders its tile (as 0) rather than dropping.
const DECISION_TILES = [
  { id: "shortlisted", label: "Shortlisted" },
  { id: "on_hold",     label: "On hold" },
  { id: "rejected",    label: "Rejected" },
  { id: "waitlisted",  label: "Waitlisted" },
];

const FUNNEL_ORDER = [
  { id: "submitted", label: "SUBMITTED", sub: "complete" },
  { id: "in_review", label: "IN REVIEW", sub: "AI + human eval" },
  { id: "advanced",  label: "SHORTLISTED", sub: "advanced past review" },
  { id: "decided",   label: "DECIDED", sub: "offered + onboarded" },
];

export default function AdminDashboard() {
  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getStats(),
    [],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const totals = data?.totals || {};
  const funnel = data?.funnel || {};
  const statusCounts = data?.status_counts || [];
  const scores = (data?.ai_score_overalls || []).filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  const decisions = data?.decisions || {};

  const submitted = totals.apps_submitted ?? 0;
  const tirCount = totals.tir_count ?? 0;
  const sipCount = totals.sip_count ?? 0;
  const advanced = totals.advanced_past_review ?? 0;
  const onboarded = totals.onboarded ?? 0;
  const avgAi =
    totals.avg_ai_score === null || totals.avg_ai_score === undefined
      ? "—"
      : Number(totals.avg_ai_score).toFixed(1);

  const histogram = buildHistogram(scores);
  const histMax = Math.max(1, ...histogram.bins.map((b) => b.count));
  const scoreMean = meanOf(scores);
  const scoreMedian = medianOf(scores);

  const funnelMax = Math.max(1, ...FUNNEL_ORDER.map((f) => funnel[f.id] ?? 0));
  const statusMax = Math.max(1, ...statusCounts.map((s) => s?.n ?? 0));

  return (
    <div className="dash-scroll">
      {/* ── KPI tiles ── */}
      <div className="dash-stat-grid">
        <div className="dash-stat-tile">
          <div className="dash-stat-label">Applications submitted</div>
          <div className="dash-stat-num">{submitted}</div>
          {submitted > 0 ? (
            <div className="dash-track-bars">
              <div className="dash-track-row">
                <span className="dash-track-label">TIR</span>
                <div className="dash-track-bar-wrap">
                  <div
                    className="dash-track-bar-fill"
                    style={{ width: `${(tirCount / submitted) * 100}%`, background: "#1f0a8a" }}
                  />
                </div>
                <span className="dash-track-count">{tirCount}</span>
              </div>
              <div className="dash-track-row">
                <span className="dash-track-label">SIP</span>
                <div className="dash-track-bar-wrap">
                  <div
                    className="dash-track-bar-fill"
                    style={{ width: `${(sipCount / submitted) * 100}%`, background: "#3213b7" }}
                  />
                </div>
                <span className="dash-track-count">{sipCount}</span>
              </div>
            </div>
          ) : (
            <div className="dash-stat-sub">no apps yet</div>
          )}
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">Advanced past review</div>
          <div className="dash-stat-num">{advanced}</div>
          <div className="dash-stat-sub">
            {submitted ? `${Math.round((advanced / submitted) * 100)}% of submissions` : "—"}
          </div>
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">Onboarded</div>
          <div className="dash-stat-num">{onboarded}</div>
          <div className="dash-stat-sub">from offered → ready</div>
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">Profiles signed up</div>
          <div className="dash-stat-num">{totals.profiles_signed_up ?? 0}</div>
          <div className="dash-stat-sub">on platform</div>
        </div>

        <div className="dash-stat-tile dash-tile-teal">
          <div className="dash-stat-label">Average AI score</div>
          <div className="dash-stat-num">{avgAi}</div>
          <div className="dash-stat-sub">
            {submitted ? `across ${submitted} apps` : "no apps yet"}
          </div>
        </div>
      </div>

      {/* ── Pipeline funnel ── */}
      <div className="dash-card">
        <div className="dash-section-tag">§ Pipeline funnel</div>
        <div className="dash-card-title">From submission to onboarded</div>
        <div className="dash-pipe">
          {FUNNEL_ORDER.map((f, idx) => {
            const n = funnel[f.id] ?? 0;
            const pct = funnelMax > 0 ? (n / funnelMax) * 100 : 0;
            return (
              <div key={f.id}>
                <div className="dash-pipe-row">
                  <div className="dash-pipe-track">
                    <div className="dash-pipe-fill" style={{ width: `${pct}%` }} />
                    <span className="dash-pipe-count">{n}</span>
                  </div>
                  <div className="dash-pipe-info">
                    <span className="dash-pipe-name">{f.label}</span>
                    <span className="dash-pipe-sub">{f.sub}</span>
                  </div>
                </div>
                {idx < FUNNEL_ORDER.length - 1 && (
                  <div className="dash-pipe-arrow" aria-hidden="true">
                    <span className="a-track">↓</span>
                    <span className="a-spacer" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── AI score distribution ── */}
      <div className="dash-card">
        <div className="dash-section-tag">§ AI score distribution</div>
        <div className="dash-card-title">
          Across {histogram.total || "—"} scored applications
        </div>
        {histogram.total === 0 ? (
          <div className="dash-stat-sub">No scored applications yet.</div>
        ) : (
          <>
            <div className="dash-histogram">
              {histogram.bins.map((b, i) => {
                const heightPct = (b.count / histMax) * 100;
                const isPeak = i === histogram.medianIdx;
                return (
                  <div key={i} className="dash-hist-col">
                    <span className="dash-hist-count">{b.count}</span>
                    <div className="dash-hist-bar-wrap">
                      <div
                        className="dash-hist-bar"
                        style={{
                          height: `${b.count === 0 ? 0 : Math.max(heightPct, 3)}%`,
                          background: isPeak ? "#3213b7" : "#1f0a8a",
                        }}
                      />
                    </div>
                    <span className="dash-hist-label">
                      {b.from.toFixed(0)}–{b.to.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="dash-hist-stats">
              MEAN <strong>{scoreMean != null ? scoreMean.toFixed(1) : "—"}</strong>
              {" · "}
              MEDIAN <strong>{scoreMedian != null ? scoreMedian.toFixed(1) : "—"}</strong>
              {" · "}
              N = {histogram.total}
            </div>
          </>
        )}
      </div>

      {/* ── Admin decisions ── */}
      <div className="dash-card">
        <div className="dash-section-tag">§ Admin decisions</div>
        <div className="dash-card-title">Gate-1 calls recorded so far</div>
        <div className="dash-stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {DECISION_TILES.map((d) => (
            <div key={d.id} className="dash-stat-tile">
              <div className="dash-stat-label">{d.label}</div>
              <div className="dash-stat-num">{decisions[d.id] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Status breakdown ── */}
      <div className="dash-card">
        <div className="dash-section-tag">§ Status breakdown</div>
        <div className="dash-card-title">Where every application sits right now</div>
        <div className="dash-ind-list">
          {statusCounts.length === 0 ? (
            <div className="dash-stat-sub">No status data yet.</div>
          ) : (
            statusCounts.map((s) => {
              const n = s?.n ?? 0;
              const pct = statusMax > 0 ? (n / statusMax) * 100 : 0;
              return (
                <div key={s?.id ?? s?.label} className="dash-ind-row">
                  <span className="dash-ind-name">
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        marginRight: 8,
                        background: STATUS_DOT[s?.id] || "#8a8a92",
                      }}
                    />
                    {s?.label ?? s?.id ?? "—"}
                  </span>
                  <div className="dash-ind-bar-wrap">
                    <div className="dash-ind-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="dash-ind-count">{n}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
