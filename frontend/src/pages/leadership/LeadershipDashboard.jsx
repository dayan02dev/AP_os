// LeadershipDashboard — top-level page for /leadership.
//
// Task 17 (this commit) wires the Dashboard tab to real
// GET /leadership/stats. The Applications tab + drawer + filter chips land
// in Task 19 — for now the tab toggles to a placeholder.

import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth.jsx";
import { leadershipApi } from "../../lib/leadershipApi.js";
import "../../styles/leadership.css";

import MetricCard from "./components/MetricCard.jsx";
import FunnelStrip from "./components/FunnelStrip.jsx";
import ScoreHistogram from "./components/ScoreHistogram.jsx";
import ComponentBars from "./components/ComponentBars.jsx";
import IndustryBars from "./components/IndustryBars.jsx";
import StatusGrid from "./components/StatusGrid.jsx";

const HISTOGRAM_FETCH_LIMIT = 200;

export default function LeadershipDashboard() {
  const { user, logout } = useAuth();

  const [view, setView] = useState("dashboard");

  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Histogram source — sampled overall scores via the list endpoint.
  const [scoreSample, setScoreSample] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    leadershipApi
      .getStats()
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setStatsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatsError(err?.message || "Failed to load stats.");
          setStatsLoading(false);
        }
      });
    leadershipApi
      .listApplications({ limit: HISTOGRAM_FETCH_LIMIT, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        const scores = (page?.applications || [])
          .map((a) => a.ai_score_overall)
          .filter((v) => typeof v === "number" && Number.isFinite(v));
        setScoreSample(scores);
      })
      .catch(() => {
        if (!cancelled) setScoreSample([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const industries = stats?.industry?.industries || [];
  const totals = stats?.totals || {};
  const submitted = totals.apps_submitted ?? 0;
  const tirCount = totals.tir_count ?? 0;
  const sipCount = totals.sip_count ?? 0;
  const tirPct = submitted ? Math.round((tirCount / submitted) * 100) : 0;
  const sipPct = submitted ? Math.round((sipCount / submitted) * 100) : 0;
  const avgScoreDisplay =
    totals.avg_ai_score === null || totals.avg_ai_score === undefined
      ? "—"
      : Number(totals.avg_ai_score).toFixed(1);

  return (
    <div className="eir-screen lp-screen">
      <div className="lp-head">
        <div className="lp-head-l">
          <div className="eir-mono eir-dim">
            ARTPARK / OS · Leadership Panel
          </div>
          <h1 className="lp-head-title">
            TIR + SIP cohort <em>2026</em>
          </h1>
          <div className="eir-mono eir-dim">
            Signed in as {user?.email || "—"} ·{" "}
            {(user?.roles || []).join(", ") || "no roles"}
          </div>
        </div>
        <div className="lp-head-r">
          <button
            type="button"
            className="eir-chip-btn eir-mono"
            onClick={() => alert("Export ships in a later session.")}
          >
            Export CSV ↓
          </button>
          <button
            type="button"
            className="eir-chip-btn eir-mono"
            onClick={logout}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="lp-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "dashboard"}
          className={`lp-tab ${view === "dashboard" ? "is-on" : ""}`}
          onClick={() => setView("dashboard")}
        >
          <span className="lp-tab-label">Dashboard</span>
          <span className="eir-mono eir-dim lp-tab-sub">
            overview · charts · funnel
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "applications"}
          className={`lp-tab ${view === "applications" ? "is-on" : ""}`}
          onClick={() => setView("applications")}
        >
          <span className="lp-tab-label">
            Applications{" "}
            <span className="eir-mono lp-tab-count">{submitted}</span>
          </span>
          <span className="eir-mono eir-dim lp-tab-sub">
            individual submissions
          </span>
        </button>
      </div>

      {statsError && (
        <div className="lp-error">Stats failed to load: {statsError}</div>
      )}

      {view === "dashboard" && (
        <>
          <div className="lp-metric-row">
            <MetricCard
              kicker="Profiles signed up"
              value={statsLoading ? "…" : totals.profiles_signed_up ?? 0}
              sub="users on platform"
            />
            <MetricCard
              kicker="Applications submitted"
              value={statsLoading ? "…" : submitted}
              split={
                submitted > 0
                  ? [
                      { label: "TIR", n: tirCount, pct: tirPct },
                      { label: "SIP", n: sipCount, pct: sipPct },
                    ]
                  : undefined
              }
              sub={submitted === 0 ? "none yet" : undefined}
            />
            <MetricCard
              kicker="Advanced past review"
              value={statsLoading ? "…" : totals.advanced_past_review ?? 0}
              sub={
                submitted > 0
                  ? `${Math.round(((totals.advanced_past_review ?? 0) / submitted) * 100)}% of submissions`
                  : "—"
              }
            />
            <MetricCard
              kicker="Onboarded"
              value={statsLoading ? "…" : totals.onboarded ?? 0}
              sub="from offered → ready"
            />
            <MetricCard
              kicker="Average AI score"
              value={statsLoading ? "…" : avgScoreDisplay}
              sub={
                submitted > 0
                  ? `across ${submitted} apps`
                  : "no apps yet"
              }
              accent
            />
          </div>

          <div className="lp-grid">
            <section className="lp-card lp-card-wide">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">§ Pipeline funnel</div>
                <h2 className="lp-card-title">From signup to onboarded</h2>
              </div>
              {statsLoading ? (
                <div className="lp-loading">loading funnel…</div>
              ) : (
                <FunnelStrip funnel={stats?.funnel} />
              )}
            </section>

            <section className="lp-card">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">§ AI score distribution</div>
                <h2 className="lp-card-title">
                  Across submitted applications
                </h2>
              </div>
              {scoreSample === null ? (
                <div className="lp-loading">loading score sample…</div>
              ) : (
                <ScoreHistogram scores={scoreSample} />
              )}
            </section>

            <section className="lp-card">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">
                  § AI score · components
                </div>
                <h2 className="lp-card-title">What the score is made of</h2>
                <p className="lp-card-blurb">
                  Five weighted signals scored 0–10. Per-application breakdowns
                  appear in the application drawer (Task 19); cohort-wide
                  averages will arrive in a later session.
                </p>
              </div>
              <ComponentBars placeholder />
            </section>

            <section className="lp-card lp-card-wide">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">
                  § Applications by industry
                </div>
                <h2 className="lp-card-title">
                  Where the cohort is concentrated
                </h2>
              </div>
              {statsLoading ? (
                <div className="lp-loading">loading industries…</div>
              ) : (
                <IndustryBars
                  industries={industries}
                  total={stats?.industry?.total ?? 0}
                />
              )}
            </section>

            <section className="lp-card lp-card-wide">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">§ Status breakdown</div>
                <h2 className="lp-card-title">
                  Where every application sits right now
                </h2>
              </div>
              {statsLoading ? (
                <div className="lp-loading">loading status grid…</div>
              ) : (
                <StatusGrid
                  statusCounts={stats?.status_counts || []}
                  onFilter={() => {
                    /* Task 19 wires the click-through to the apps tab. */
                  }}
                  activeStatus={null}
                />
              )}
            </section>
          </div>
        </>
      )}

      {view === "applications" && (
        <div className="lp-grid">
          <section className="lp-card lp-card-wide">
            <div className="lp-card-head">
              <div className="eir-mono eir-dim">§ Applications database</div>
              <h2 className="lp-card-title">Coming in Task 19</h2>
              <p className="lp-card-blurb">
                The applications table, filter chips, search, and detail drawer
                are part of Task 19 (next commit). The dashboard tab is fully
                wired against real /leadership/stats data.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
