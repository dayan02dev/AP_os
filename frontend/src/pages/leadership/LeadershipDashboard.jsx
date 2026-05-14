// LeadershipDashboard — top-level page for /leadership.
//
// Owns:
//   - GET /leadership/stats fetch on mount (powers all dashboard charts)
//   - GET /leadership/applications fetch keyed off filter state
//   - Filter state (industry, status, track, search) + debounced search
//   - Drawer open/close state
//
// The Dashboard tab renders summary cards from `stats`. The Applications tab
// renders the paginated list + filter chips. Clicking a chart/pill in the
// Dashboard tab flips to the Applications tab with that filter pre-applied.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../hooks/useAuth.jsx";
import { leadershipApi } from "../../lib/leadershipApi.js";
import "../../styles/leadership.css";

import MetricCard from "./components/MetricCard.jsx";
import FunnelStrip from "./components/FunnelStrip.jsx";
import ScoreHistogram from "./components/ScoreHistogram.jsx";
import ComponentBars from "./components/ComponentBars.jsx";
import IndustryBars from "./components/IndustryBars.jsx";
import StatusGrid from "./components/StatusGrid.jsx";
import ApplicationsTable from "./components/ApplicationsTable.jsx";
import AppDrawer from "./components/AppDrawer.jsx";

const PAGE_SIZE = 50;
const HISTOGRAM_FETCH_LIMIT = 200;

export default function LeadershipDashboard() {
  const { user, logout } = useAuth();

  // Tabs
  const [view, setView] = useState("dashboard");

  // Dashboard data
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Histogram source — list of {ai_score_overall} sampled via the list endpoint.
  const [scoreSample, setScoreSample] = useState(null);

  // Filters
  const [industry, setIndustry] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [trackFilter, setTrackFilter] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(["submitted_at", "desc"]);
  const [offset, setOffset] = useState(0);

  // Applications data
  const [apps, setApps] = useState([]);
  const [appsTotal, setAppsTotal] = useState(0);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState(null);

  // Drawer
  const [openRow, setOpenRow] = useState(null);

  // ----- Initial stats + score sample fetch -----
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
    // Score sample — best-effort; failure is non-fatal (histogram falls back
    // to a placeholder).
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

  // ----- Debounce the search input -----
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ----- Refetch app list when filters change. Reset offset whenever a
  //       filter or search changes (but not when only offset changes). -----
  const lastFiltersKey = useRef(null);
  const filtersKey = `${industry || ""}|${statusFilter || ""}|${trackFilter || ""}|${search}`;
  useEffect(() => {
    if (lastFiltersKey.current !== filtersKey) {
      lastFiltersKey.current = filtersKey;
      setOffset(0);
    }
  }, [filtersKey]);

  useEffect(() => {
    // Only fire when stats has resolved — avoids a duplicate flash on first
    // paint where both stats + list fire simultaneously.
    let cancelled = false;
    setAppsLoading(true);
    setAppsError(null);
    const params = {
      industry: industry || undefined,
      status: statusFilter || undefined,
      track: trackFilter ? trackFilter.toLowerCase() : undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    leadershipApi
      .listApplications(params)
      .then((page) => {
        if (cancelled) return;
        setApps(page?.applications || []);
        setAppsTotal(page?.total ?? 0);
        setAppsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setAppsError(err?.message || "Failed to load applications.");
        setAppsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [industry, statusFilter, trackFilter, search, offset]);

  // ----- Filter-and-jump (Dashboard → Applications) -----
  const filterAndShow = useCallback(
    (setter) => (val) => {
      setter(val);
      if (val) setView("applications");
    },
    []
  );

  // Lookup so the table + drawer can translate status id → label without
  // re-deriving it. Build once stats has loaded.
  const statusLabelById = useMemo(() => {
    const out = {};
    (stats?.status_counts || []).forEach((s) => {
      out[s.id] = s.label;
    });
    return out;
  }, [stats]);

  const industries = stats?.industry?.industries || [];

  // Derived metric values (totals from /leadership/stats)
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

  const activeIndustryLabel =
    industries.find((i) => i.id === industry)?.label || null;
  const activeStatusLabel = statusLabelById[statusFilter] || null;

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
            Signed in as {user?.email || "—"} · {(user?.roles || []).join(", ") || "no roles"}
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
                  appear in the application drawer; cohort-wide averages will
                  arrive in a later session.
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
                <p className="lp-card-blurb">
                  Click an industry to jump into the Applications tab
                  pre-filtered.
                </p>
              </div>
              {statsLoading ? (
                <div className="lp-loading">loading industries…</div>
              ) : (
                <IndustryBars
                  industries={industries}
                  total={stats?.industry?.total ?? 0}
                  activeIndustry={industry}
                  onFilter={filterAndShow(setIndustry)}
                />
              )}
              <div className="lp-ind-filter-row">
                <span className="eir-mono eir-dim">filter:</span>
                <button
                  type="button"
                  className={`lp-pill ${!industry ? "is-on" : ""}`}
                  onClick={() => setIndustry(null)}
                >
                  all
                </button>
                {industries.map((i) => (
                  <button
                    type="button"
                    key={i.id}
                    className={`lp-pill ${industry === i.id ? "is-on" : ""}`}
                    onClick={() =>
                      filterAndShow(setIndustry)(industry === i.id ? null : i.id)
                    }
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="lp-card lp-card-wide">
              <div className="lp-card-head">
                <div className="eir-mono eir-dim">§ Status breakdown</div>
                <h2 className="lp-card-title">
                  Where every application sits right now
                </h2>
                <p className="lp-card-blurb">
                  Click a status to open the Applications tab filtered to it.
                </p>
              </div>
              {statsLoading ? (
                <div className="lp-loading">loading status grid…</div>
              ) : (
                <StatusGrid
                  statusCounts={stats?.status_counts || []}
                  activeStatus={statusFilter}
                  onFilter={filterAndShow(setStatusFilter)}
                />
              )}
            </section>
          </div>
        </>
      )}

      {view === "applications" && (
        <div className="lp-grid">
          <section className="lp-card lp-card-wide">
            <div className="lp-card-head lp-card-head-row">
              <div>
                <div className="eir-mono eir-dim">§ Applications database</div>
                <h2 className="lp-card-title">
                  {appsLoading ? "…" : `${apps.length} of ${appsTotal}`}
                  {activeIndustryLabel && <> · {activeIndustryLabel}</>}
                  {activeStatusLabel && <> · {activeStatusLabel}</>}
                  {trackFilter && <> · {trackFilter}</>}
                </h2>
              </div>
              <div className="lp-toolbar">
                <input
                  className="lp-search eir-mono"
                  placeholder="search name / email / org…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <div className="lp-seg">
                  {["TIR", "SIP"].map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={`lp-seg-btn eir-mono ${trackFilter === t ? "is-on" : ""}`}
                      onClick={() =>
                        setTrackFilter(trackFilter === t ? null : t)
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {(industry || statusFilter || trackFilter || search) && (
                  <button
                    type="button"
                    className="eir-chip-btn eir-mono"
                    onClick={() => {
                      setIndustry(null);
                      setStatusFilter(null);
                      setTrackFilter(null);
                      setSearchInput("");
                      setSearch("");
                    }}
                  >
                    clear ×
                  </button>
                )}
              </div>
            </div>

            <div className="lp-ind-filter-row" style={{ marginTop: 0 }}>
              <span className="eir-mono eir-dim">industry:</span>
              <button
                type="button"
                className={`lp-pill ${!industry ? "is-on" : ""}`}
                onClick={() => setIndustry(null)}
              >
                all
              </button>
              {industries.map((i) => (
                <button
                  type="button"
                  key={i.id}
                  className={`lp-pill ${industry === i.id ? "is-on" : ""}`}
                  onClick={() =>
                    setIndustry(industry === i.id ? null : i.id)
                  }
                >
                  {i.label}
                </button>
              ))}
            </div>

            <div className="lp-ind-filter-row">
              <span className="eir-mono eir-dim">status:</span>
              <button
                type="button"
                className={`lp-pill ${!statusFilter ? "is-on" : ""}`}
                onClick={() => setStatusFilter(null)}
              >
                all
              </button>
              {(stats?.status_counts || []).map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`lp-pill ${statusFilter === s.id ? "is-on" : ""}`}
                  onClick={() =>
                    setStatusFilter(statusFilter === s.id ? null : s.id)
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>

            {appsError && <div className="lp-error">Error: {appsError}</div>}
            {appsLoading ? (
              <div className="lp-loading">loading applications…</div>
            ) : (
              <ApplicationsTable
                applications={apps}
                total={appsTotal}
                statusLabelById={statusLabelById}
                sort={sort}
                setSort={setSort}
                limit={PAGE_SIZE}
                offset={offset}
                setOffset={setOffset}
                onOpen={setOpenRow}
              />
            )}
          </section>
        </div>
      )}

      {openRow && (
        <AppDrawer
          row={openRow}
          statusLabelById={statusLabelById}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}
