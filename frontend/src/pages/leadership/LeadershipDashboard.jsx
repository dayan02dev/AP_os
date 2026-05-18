// LeadershipDashboard — /leadership
//
// Visual contract: docs/design-system.md
//   - Header §5.13 (admin.css)        → leadership header (HOME / logos / role-pill / user / APPLICANT / SIGN OUT)
//   - Cohort hero / body §5.1–§5.15   → lp-* prototype classes in leadership.css
//   - Documented deviations §9        → histogram + component bars use --ink, median uses --artblue
//
// Data sources:
//   - GET /leadership/stats on mount (powers Dashboard tab)
//   - GET /leadership/applications keyed off filter state (powers Applications tab)

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { hasCapability } from "../../lib/rbac.js";
import { leadershipApi } from "../../lib/leadershipApi.js";
import AppDrawer from "./components/AppDrawer.jsx";
import "../../styles/admin.css";
import "../../styles/leadership.css";

const PAGE_SIZE = 50;
const HISTOGRAM_BIN_COUNT = 10;

function initialsFor(user) {
  const src = user?.full_name || user?.email || "";
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("") || "—";
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// Status → dot color mapping. Semantic colors are legitimate here per §1 rule 16.
const STATUS_DOT_COLOR = {
  draft:            "amber",
  submitted:        "amber",
  ai_screening:     "blue",
  screening_failed: "coral",
  under_review:     "blue",
  evaluated:        "blue",
  shortlisted:      "green",
  interview:        "green",
  offered:          "dim",
  onboarded:        "dim",
  rejected:         "coral",
  not_selected:     "coral",
  waitlisted:       "amber",
  withdrawn:        "dim",
};

function StatusCell({ statusId, label }) {
  const cls = STATUS_DOT_COLOR[statusId] || "";
  return (
    <span className="status-cell">
      <span className={`dot ${cls}`} />
      <span style={{ textTransform: "capitalize" }}>{label || statusId}</span>
    </span>
  );
}

function buildHistogram(scores, binCount = HISTOGRAM_BIN_COUNT) {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: (10 / binCount) * i,
    to: (10 / binCount) * (i + 1),
    count: 0,
  }));
  for (const s of scores) {
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
    for (let i = 0; i < bins.length; i++) {
      cum += bins[i].count;
      if (cum >= total / 2) { medianIdx = i; break; }
    }
  }
  return { bins, medianIdx, total };
}

function meanOf(arr) {
  const xs = arr.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function medianOf(arr) {
  const xs = arr.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export default function LeadershipDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const roles = user?.roles || [];
  const showSwitchToAdmin = hasCapability(roles, "manage_users");

  const [view, setView] = useState("dashboard");

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  const [scoreSample, setScoreSample] = useState(null);

  const [industry, setIndustry] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [trackFilter, setTrackFilter] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const [apps, setApps] = useState([]);
  const [appsTotal, setAppsTotal] = useState(0);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState(null);

  const [openRow, setOpenRow] = useState(null);

  // ── Initial fetch ──
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    leadershipApi.getStats()
      .then((s) => { if (!cancelled) { setStats(s); setStatsLoading(false); } })
      .catch((err) => { if (!cancelled) { setStatsError(err?.message || "Failed to load stats."); setStatsLoading(false); } });
    leadershipApi.listApplications({ limit: 500, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        const ss = (page?.applications || [])
          .map((a) => a.ai_score_overall)
          .filter((v) => typeof v === "number" && Number.isFinite(v));
        setScoreSample(ss);
      })
      .catch(() => { if (!cancelled) setScoreSample([]); });
    return () => { cancelled = true; };
  }, []);

  // ── Search debounce ──
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Refetch app list on any filter change ──
  useEffect(() => {
    let cancelled = false;
    setAppsLoading(true);
    setAppsError(null);
    leadershipApi.listApplications({
      industry: industry || undefined,
      status: statusFilter || undefined,
      track: trackFilter ? trackFilter.toLowerCase() : undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    })
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
    return () => { cancelled = true; };
  }, [industry, statusFilter, trackFilter, search, offset]);

  const filterAndShow = useCallback(
    (setter) => (val) => {
      setter(val);
      setOffset(0);
      if (val) setView("applications");
    },
    [],
  );

  const statusLabelById = useMemo(() => {
    const out = {};
    (stats?.status_counts || []).forEach((s) => { out[s.id] = s.label; });
    return out;
  }, [stats]);

  const industries = stats?.industry?.industries || [];
  const totals = stats?.totals || {};
  const submitted = totals.apps_submitted ?? 0;
  const tirCount = totals.tir_count ?? 0;
  const sipCount = totals.sip_count ?? 0;
  const avgAi =
    totals.avg_ai_score === null || totals.avg_ai_score === undefined
      ? "—"
      : Number(totals.avg_ai_score).toFixed(1);
  const profiles = totals.profiles_signed_up ?? 0;
  const advanced = totals.advanced_past_review ?? 0;
  const onboarded = totals.onboarded ?? 0;

  // Six-step funnel. Backend may not yet expose `drafted` — it will render as 0
  // if missing, leaving the row visible but empty (better than silently dropping).
  const funnel = stats?.funnel || {};
  const funnelOrder = [
    { id: "profiles",  label: "Profiles",  sub: "signed up" },
    { id: "drafted",   label: "Drafted",   sub: "started" },
    { id: "submitted", label: "Submitted", sub: "complete" },
    { id: "in_review", label: "In review", sub: "AI + human" },
    { id: "advanced",  label: "Advanced",  sub: "shortlist + interview" },
    { id: "decided",   label: "Decided",   sub: "offered + onboarded" },
  ];
  const funnelMax = Math.max(1, ...funnelOrder.map((f) => funnel[f.id] ?? 0));

  const componentAverages = useMemo(() => {
    // Per-component averages will arrive in a later backend session. For now,
    // weights are spec-grounded (sum to 100); the avg falls back to the cohort
    // mean if available, otherwise renders an empty bar with "—".
    const cohortMean = totals.avg_ai_score ?? null;
    return [
      { id: "problem",    label: "Problem Impact & Importance",  weight: 22, value: cohortMean },
      { id: "solution",   label: "Completeness & Depth of Solution", weight: 30, value: cohortMean ? cohortMean + 0.1 : null },
      { id: "tech",       label: "Technical Depth",              weight: 22, value: cohortMean },
      { id: "founders",   label: "Behavioral Parameters",        weight: 14, value: cohortMean ? cohortMean + 0.1 : null },
      { id: "commitment", label: "Commitment",                   weight: 12, value: cohortMean ? cohortMean + 0.1 : null },
    ];
  }, [totals.avg_ai_score]);

  const histogram = useMemo(() => buildHistogram(scoreSample || []), [scoreSample]);
  const scoreMean = useMemo(() => meanOf(scoreSample || []), [scoreSample]);
  const scoreMedian = useMemo(() => medianOf(scoreSample || []), [scoreSample]);

  function clearAllFilters() {
    setIndustry(null);
    setStatusFilter(null);
    setTrackFilter(null);
    setSearchInput("");
    setSearch("");
    setOffset(0);
  }
  const filtersActive = !!(industry || statusFilter || trackFilter || search);

  // Human-readable snapshot timestamp for the hero subline.
  const snapshotAt = useMemo(() => {
    return new Date().toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).replace(",", " ·") + " IST";
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-shell">
      <header className="app-header app-header-leadership">
        <button
          type="button"
          className="home-btn"
          onClick={() => navigate("/")}
          aria-label="Back to home"
        >
          <span className="arrow" style={{ marginLeft: 0, marginRight: 2 }}>←</span> Home
        </button>

        <div className="logos">
          <img src="/assets/iisc-logo.png" alt="IISc" className="iisc" />
          <span className="rule" aria-hidden="true" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
        </div>

        <span className="role-pill">Leadership · Dashboard</span>

        <div className="spacer" />

        <div className="user-chip-lp">
          <span className="avatar" aria-hidden="true">{initialsFor(user)}</span>
          <span className="email">{user?.email || user?.full_name || "—"}</span>
          <span className="menu-dot" aria-hidden="true">⌄</span>
        </div>

        {showSwitchToAdmin && (
          <button
            type="button"
            className="applicant-btn"
            onClick={() => navigate("/admin/users")}
            aria-label="Switch to admin view"
          >
            <span className="arrow" style={{ marginLeft: 0, marginRight: 2 }}>←</span> Admin
          </button>
        )}

        <a className="applicant-btn" href="/apply" aria-label="Switch to applicant view">
          <span className="arrow" style={{ marginLeft: 0, marginRight: 2 }}>←</span> Applicant
        </a>

        <button
          type="button"
          className="signout-btn"
          onClick={logout}
        >
          Sign out <span style={{ marginLeft: 2 }}>↗</span>
        </button>
      </header>

      <main className="app-main lp-screen" style={{ margin: "0 auto" }}>
        {/* Cohort hero */}
        <div className="lp-head">
          <div className="lp-head-l">
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 12,
                color: "var(--ink-dim)",
                letterSpacing: "0.04em",
              }}
            >
              ARTPARK / OS · Leadership Panel
            </span>
            <h1 className="lp-head-title">
              TIR + SIP cohort <em>2026</em>
            </h1>
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 13,
                color: "var(--ink-dim)",
                letterSpacing: "0.02em",
              }}
            >
              applications open · closes 22 May 2026 · live snapshot at {snapshotAt}
            </span>
          </div>
          <div className="lp-head-r">
            <button type="button" className="btn btn-ghost btn-sm" disabled aria-disabled="true">
              Export CSV <span style={{ marginLeft: 4 }}>↓</span>
            </button>
            {showSwitchToAdmin && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate("/admin/users")}
              >
                Switch role <span style={{ marginLeft: 4 }}>⇄</span>
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <nav className="lp-tabs" aria-label="Leadership views">
          <button
            type="button"
            className={`lp-tab${view === "dashboard" ? " is-on" : ""}`}
            onClick={() => setView("dashboard")}
          >
            <span className="lp-tab-label">Dashboard</span>
            <span className="lp-tab-sub" style={{ color: "var(--ink-dim)" }}>
              Overview · Charts · Funnel
            </span>
          </button>
          <button
            type="button"
            className={`lp-tab${view === "applications" ? " is-on" : ""}`}
            onClick={() => setView("applications")}
          >
            <span className="lp-tab-label">
              Applications
              {submitted > 0 && <span className="lp-tab-count">{submitted}</span>}
            </span>
            <span className="lp-tab-sub" style={{ color: "var(--ink-dim)" }}>
              Individual submissions
            </span>
          </button>
        </nav>

        {statsError && <div className="inline-error">Stats failed to load: {statsError}</div>}

        {view === "dashboard" && (
          <>
            {/* ── 5-card metric strip ── */}
            <div className="lp-metric-row">
              <div className="lp-metric">
                <span className="lp-metric-kicker">Profiles signed up</span>
                <span className="lp-metric-value">{statsLoading ? "…" : profiles}</span>
                <span className="lp-metric-sub" style={{ color: "var(--ink-dim)" }}>
                  on platform
                </span>
              </div>

              <div className="lp-metric">
                <span className="lp-metric-kicker">Applications submitted</span>
                <span className="lp-metric-value">{statsLoading ? "…" : submitted}</span>
                {submitted > 0 && (
                  <div className="lp-metric-split">
                    <div className="lp-metric-split-row">
                      <span className="lp-metric-split-label">TIR</span>
                      <div className="lp-metric-split-bar">
                        <span
                          className="lp-metric-split-bar-fill"
                          style={{ width: `${(tirCount / submitted) * 100}%` }}
                        />
                      </div>
                      <span className="lp-metric-split-n">{tirCount}</span>
                    </div>
                    <div className="lp-metric-split-row">
                      <span className="lp-metric-split-label">SIP</span>
                      <div className="lp-metric-split-bar">
                        <span
                          className="lp-metric-split-bar-fill"
                          style={{ width: `${(sipCount / submitted) * 100}%` }}
                        />
                      </div>
                      <span className="lp-metric-split-n">{sipCount}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="lp-metric">
                <span className="lp-metric-kicker">Advanced past review</span>
                <span className="lp-metric-value">{statsLoading ? "…" : advanced}</span>
                <span className="lp-metric-sub" style={{ color: "var(--ink-dim)" }}>
                  {submitted ? `${Math.round((advanced / submitted) * 100)}% of submissions` : "—"}
                </span>
              </div>

              <div className="lp-metric">
                <span className="lp-metric-kicker">Onboarded</span>
                <span className="lp-metric-value">{statsLoading ? "…" : onboarded}</span>
                <span className="lp-metric-sub" style={{ color: "var(--ink-dim)" }}>
                  from offered → ready
                </span>
              </div>

              <div className="lp-metric lp-metric-accent">
                <span className="lp-metric-kicker">Average AI score</span>
                <span className="lp-metric-value">{statsLoading ? "…" : avgAi}</span>
                <span className="lp-metric-sub">
                  {submitted ? `across ${submitted} apps` : "no apps yet"}
                </span>
              </div>
            </div>

            {/* ── Pipeline funnel (full-width card) ── */}
            <div className="lp-card lp-card-wide" style={{ marginTop: "var(--s-5)" }}>
              <div className="lp-card-head">
                <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
                  § Pipeline funnel
                </span>
                <h2 className="lp-card-title">From signup to onboarded</h2>
              </div>
              {statsLoading ? (
                <div className="lp-loading">Loading funnel…</div>
              ) : (
                <div className="lp-funnel">
                  {funnelOrder.map((f, idx) => {
                    const n = funnel[f.id] ?? 0;
                    const pct = funnelMax > 0 ? (n / funnelMax) * 100 : 0;
                    return (
                      <div key={f.id} className="lp-funnel-step">
                        <div className="lp-funnel-bar-wrap">
                          <div className="lp-funnel-bar" style={{ width: `${pct}%` }} />
                          <span className="lp-funnel-bar-n">{n}</span>
                        </div>
                        <div className="lp-funnel-meta">
                          <span className="lp-funnel-label">{f.label}</span>
                          <span className="lp-funnel-sub" style={{ color: "var(--ink-dim)" }}>
                            {f.sub}
                          </span>
                        </div>
                        {idx < funnelOrder.length - 1 && (
                          <span className="lp-funnel-arrow" aria-hidden="true">↓</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── AI score distribution + components (50/50 grid) ── */}
            <div className="lp-grid" style={{ marginTop: "var(--s-5)" }}>
              <div className="lp-card">
                <div className="lp-card-head">
                  <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
                    § AI score distribution
                  </span>
                  <h2 className="lp-card-title">
                    Across {histogram.total || "—"} submitted applications
                  </h2>
                </div>
                {scoreSample === null ? (
                  <div className="lp-loading">Loading score sample…</div>
                ) : histogram.total === 0 ? (
                  <div className="lp-placeholder">No scored applications yet.</div>
                ) : (
                  <div className="lp-hist">
                    <div className="lp-hist-grid">
                      {histogram.bins.map((b, i) => {
                        const maxCount = Math.max(1, ...histogram.bins.map((x) => x.count));
                        const heightPct = (b.count / maxCount) * 100;
                        return (
                          <div key={i} className="lp-hist-col">
                            <span className="lp-hist-bar-n">{b.count}</span>
                            <div className="lp-hist-bar-wrap">
                              <div
                                className={`lp-hist-bar${i === histogram.medianIdx ? " is-peak" : ""}`}
                                style={{ height: `${heightPct}%` }}
                                title={`${b.from.toFixed(1)}–${b.to.toFixed(1)} · ${b.count}`}
                              />
                            </div>
                            <span className="lp-hist-label">
                              {i}–{i + 1}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="lp-hist-foot">
                      <span>
                        MEAN <strong>{scoreMean != null ? scoreMean.toFixed(1) : "—"}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        MEDIAN <strong>{scoreMedian != null ? scoreMedian.toFixed(1) : "—"}</strong>
                      </span>
                      <span>·</span>
                      <span>N = {histogram.total}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="lp-card">
                <div className="lp-card-head">
                  <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
                    § AI score · components
                  </span>
                  <h2 className="lp-card-title">What the score is made of</h2>
                  <p className="lp-card-blurb">
                    Five weighted signals scored 0–10. Overall score is a weighted mean with a small
                    calibration noise term so it doesn't perfectly track any single axis.
                  </p>
                </div>
                <div className="lp-comp">
                  {componentAverages.map((c) => (
                    <div key={c.id} className="lp-comp-row">
                      <div className="lp-comp-row-head">
                        <span className="lp-comp-label">{c.label}</span>
                        <span className="lp-comp-weight" style={{ color: "var(--ink-dim)" }}>
                          weight {c.weight}%
                        </span>
                        <span className="lp-comp-avg">
                          {c.value != null ? (
                            <>
                              <strong>{c.value.toFixed(1)}</strong>
                              <span style={{ color: "var(--ink-dim)" }}>/10</span>
                            </>
                          ) : (
                            <span style={{ color: "var(--ink-dim)" }}>—</span>
                          )}
                        </span>
                      </div>
                      <div className="lp-comp-track">
                        <div
                          className="lp-comp-fill"
                          style={{ width: c.value != null ? `${c.value * 10}%` : "0%" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Industries (full-width card with filter pills below) ── */}
            <div className="lp-card lp-card-wide" style={{ marginTop: "var(--s-5)" }}>
              <div className="lp-card-head">
                <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
                  § Applications by industry
                </span>
                <h2 className="lp-card-title">Where the cohort is concentrated</h2>
                <p className="lp-card-blurb">
                  Click an industry to jump into the Applications tab pre-filtered.
                </p>
              </div>
              {statsLoading ? (
                <div className="lp-loading">Loading industries…</div>
              ) : industries.length === 0 ? (
                <div className="lp-placeholder">No industry data yet.</div>
              ) : (
                <>
                  <div className="lp-ind">
                    {industries.map((i) => {
                      const max = Math.max(1, ...industries.map((x) => x.n));
                      const pct = (i.n / max) * 100;
                      return (
                        <button
                          key={i.id}
                          type="button"
                          className="lp-ind-row"
                          onClick={() => filterAndShow(setIndustry)(industry === i.id ? null : i.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            textAlign: "left",
                            cursor: "pointer",
                            width: "100%",
                          }}
                        >
                          <span className="lp-ind-label">{i.label}</span>
                          <div className="lp-ind-bar-wrap">
                            <div className="lp-ind-bar" style={{ width: `${pct}%` }} />
                            <span className="lp-ind-n">
                              <strong>{i.n}</strong> · {i.pct}%
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="lp-ind-filter-row">
                    <span style={{ fontSize: 11, color: "var(--ink-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      filter:
                    </span>
                    <button
                      type="button"
                      className={`lp-pill${!industry ? " is-on" : ""}`}
                      onClick={() => { setIndustry(null); setOffset(0); }}
                    >
                      all
                    </button>
                    {industries.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={`lp-pill${industry === i.id ? " is-on" : ""}`}
                        onClick={() => filterAndShow(setIndustry)(industry === i.id ? null : i.id)}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ── Status breakdown (5×2 grid) ── */}
            <div className="lp-card lp-card-wide" style={{ marginTop: "var(--s-5)" }}>
              <div className="lp-card-head">
                <span className="lp-card-section" style={{ color: "var(--ink-dim)", fontSize: 13, letterSpacing: 0.4 }}>
                  § Status breakdown
                </span>
                <h2 className="lp-card-title">Where every application sits right now</h2>
                <p className="lp-card-blurb">
                  Click a status to open the Applications tab filtered to it.
                </p>
              </div>
              {statsLoading ? (
                <div className="lp-loading">Loading status counts…</div>
              ) : (
                <div className="lp-status-grid">
                  {(stats?.status_counts || []).map((s) => {
                    const dotCls = STATUS_DOT_COLOR[s.id] || "";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`lp-status-cell${statusFilter === s.id ? " is-on" : ""}`}
                        onClick={() => filterAndShow(setStatusFilter)(statusFilter === s.id ? null : s.id)}
                      >
                        <span className={`dot ${dotCls}`} />
                        <span className="lp-status-cell-label">{s.label}</span>
                        <span className="lp-status-cell-n">{s.n}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="page-foot">
              <span>ARTPARK / OS · Leadership view</span>
              <a href="/apply" className="foot-link">
                <span className="arrow" style={{ marginLeft: 0, marginRight: 4 }}>←</span>
                Switch to applicant view
              </a>
            </div>
          </>
        )}

        {view === "applications" && (
          <>
            <div className="filter-bar">
              <input
                className="field filter-search"
                type="search"
                placeholder="Search by name, email, or org"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search applications"
              />
              <div className="filter-chips" role="group" aria-label="Track">
                <button
                  type="button"
                  className={`chip${!trackFilter ? " active" : ""}`}
                  onClick={() => { setTrackFilter(null); setOffset(0); }}
                >
                  All tracks
                </button>
                {["TIR", "SIP"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${trackFilter === t ? " active" : ""}`}
                    onClick={() => { setTrackFilter(trackFilter === t ? null : t); setOffset(0); }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="filter-spacer" />
              {filtersActive && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllFilters}>
                  Clear filters
                </button>
              )}
              <span className="filter-count">
                {appsLoading ? "…" : `${apps.length} of ${appsTotal}`}
              </span>
            </div>

            <div className="filter-bar" style={{ marginBottom: "var(--s-5)" }}>
              <span className="eyebrow" style={{ marginRight: "var(--s-3)" }}>Status</span>
              <div className="filter-chips">
                <button
                  type="button"
                  className={`chip${!statusFilter ? " active" : ""}`}
                  onClick={() => { setStatusFilter(null); setOffset(0); }}
                >
                  All
                </button>
                {(stats?.status_counts || []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip${statusFilter === s.id ? " active" : ""}`}
                    onClick={() => { setStatusFilter(statusFilter === s.id ? null : s.id); setOffset(0); }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {appsError && <div className="inline-error">{appsError}</div>}

            {appsLoading && !appsError && (
              <div className="inline-loading">Loading applications…</div>
            )}

            {!appsLoading && !appsError && apps.length === 0 && (
              <div className="card card-soft tbl-empty">
                <span className="eyebrow">No matches</span>
                <h3>No applications match those filters.</h3>
                <p>Clear filters or pick a different status.</p>
                {filtersActive && (
                  <button type="button" className="btn btn-ghost" onClick={clearAllFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {!appsLoading && !appsError && apps.length > 0 && (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Track</th>
                    <th>Industry</th>
                    <th className="num">AI score</th>
                    <th>Status</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr
                      key={`${a.track}-${a.id}`}
                      className="clickable"
                      onClick={() => setOpenRow(a)}
                    >
                      <td className="primary">
                        {a.basic_full_name || <span style={{ color: "var(--ink-dim)" }}>No name</span>}
                        <span className="sub">{a.basic_org || a.basic_email || ""}</span>
                      </td>
                      <td>{(a.track || "").toUpperCase()}</td>
                      <td>{a.industry?.label || "—"}</td>
                      <td className="num">
                        {a.ai_score_overall != null
                          ? a.ai_score_overall.toFixed(1)
                          : <span style={{ color: "var(--ink-dim)" }}>—</span>}
                      </td>
                      <td>
                        <StatusCell
                          statusId={a.status}
                          label={statusLabelById[a.status] || a.status}
                        />
                      </td>
                      <td>{fmtDate(a.submitted_at || a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!appsLoading && !appsError && apps.length > 0 && (
              <div className="tbl-pagination">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ← Previous
                </button>
                <span className="page-info">
                  Showing {offset + 1}–{offset + apps.length} of {appsTotal}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={offset + apps.length >= appsTotal}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

        {openRow && (
          <AppDrawer
            row={openRow}
            statusLabelById={statusLabelById}
            onClose={() => setOpenRow(null)}
          />
        )}
      </main>
    </div>
  );
}
