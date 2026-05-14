// LeadershipDashboard — /leadership
//
// Visual contract: ARTPARK design system §6.5 (Dashboard tab) + §6.6 (Applications tab).
// Owns:
//   - GET /leadership/stats on mount (powers Dashboard tab)
//   - GET /leadership/applications keyed off filter state (powers Applications tab)
//   - Filter state (industry, status, track, search) with debounced search
//   - Drawer open/close state
//
// Tabs strip per §5.7. Dashboard tab: 5-metric strip + 60/40 split rows (funnel/status,
// histogram/components, industry full-width). Applications tab: filter bar + .tbl + row click → drawer.
//
// Charts are hand-rolled per §5.9 — no chart library. Mono --artblue with --paper-soft tracks.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { hasCapability } from "../../lib/rbac.js";
import { leadershipApi } from "../../lib/leadershipApi.js";
import AppDrawer from "./components/AppDrawer.jsx";
import "../../styles/admin.css";

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

// Status → dot color mapping. The one place in the system where semantic
// colors are legitimate per design-system §1 rule 16.
const STATUS_DOT_COLOR = {
  submitted:        "blue",
  ai_screening:     "amber",
  screening_failed: "coral",
  under_review:     "blue",
  evaluated:        "blue",
  shortlisted:      "green",
  interview:        "green",
  offered:          "green",
  onboarded:        "green",
  rejected:         "coral",
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
  // Bin [0,10] into binCount equal buckets, return [{from,to,count}].
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
  // Median bin = the bucket where the cumulative count crosses 50%.
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
    leadershipApi.listApplications({ limit: 200, offset: 0 })
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

  const funnel = stats?.funnel || {};
  const funnelOrder = [
    { id: "profiles",  label: "Signed up" },
    { id: "submitted", label: "Submitted" },
    { id: "in_review", label: "In review" },
    { id: "advanced",  label: "Advanced" },
    { id: "decided",   label: "Decided" },
  ];
  const funnelMax = Math.max(1, ...funnelOrder.map((f) => funnel[f.id] || 0));

  const componentAverages = useMemo(() => {
    // The bundled stats endpoint doesn't yet expose per-component averages —
    // when it does, this becomes a server projection. For now we render
    // placeholder labels at empty widths so the chart frame is there.
    return [
      { id: "problem",    label: "Problem impact",     value: null, weight: 22 },
      { id: "solution",   label: "Completeness & depth", value: null, weight: 30 },
      { id: "tech",       label: "Technical depth",    value: null, weight: 22 },
      { id: "founders",   label: "Behavioural signal", value: null, weight: 14 },
      { id: "commitment", label: "Commitment",         value: null, weight: 12 },
    ];
  }, []);

  const histogram = useMemo(() => buildHistogram(scoreSample || []), [scoreSample]);

  function clearAllFilters() {
    setIndustry(null);
    setStatusFilter(null);
    setTrackFilter(null);
    setSearchInput("");
    setSearch("");
    setOffset(0);
  }
  const filtersActive = !!(industry || statusFilter || trackFilter || search);

  return (
    <div className="app-shell">
      <div className="app-betabar">
        <span>ARTPARK / OS</span>
        <span className="pill">Staging</span>
        <span style={{ opacity: 0.6 }}>Programs leadership</span>
      </div>

      <header className="app-header">
        <div className="logos">
          <img src="/assets/iisc-logo.png" alt="IISc" className="iisc" />
          <span className="rule" aria-hidden="true" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
        </div>
        <span className="role-tag">Leadership</span>
        <div className="spacer" />
        {showSwitchToAdmin && (
          <button
            type="button"
            className="switch-role"
            onClick={() => navigate("/admin/users")}
            aria-label="Switch to admin view"
          >
            Switch to admin <span className="arrow">→</span>
          </button>
        )}
        <div className="user-chip">
          <span className="avatar" aria-hidden="true">{initialsFor(user)}</span>
          <span>
            <span className="name">{user?.full_name || user?.email}</span>
            {user?.full_name && <span className="email">{user.email}</span>}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={logout}
          style={{ marginLeft: 8 }}
        >
          Sign out
        </button>
      </header>

      <main className="app-main" style={{ margin: "0 auto" }}>
        <header className="page-head">
          <div>
            <span className="eyebrow eyebrow-rule">Programs · leadership</span>
            <h1>{view === "dashboard" ? "Funnel." : "Applications."}</h1>
            <p className="page-sub">
              {view === "dashboard"
                ? "Live view of TIR and SIP applications, scoring, and reviewer load."
                : "Filter, search, and open any application to assign reviewers or change status."}
            </p>
          </div>
        </header>

        <nav className="tabs" aria-label="Leadership views">
          <button
            type="button"
            className={view === "dashboard" ? "active" : ""}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={view === "applications" ? "active" : ""}
            onClick={() => setView("applications")}
          >
            Applications {submitted > 0 && <span style={{ color: "var(--ink-dim)", marginLeft: 4 }}>{submitted}</span>}
          </button>
        </nav>

        {statsError && <div className="inline-error">Stats failed to load: {statsError}</div>}

        {view === "dashboard" && (
          <>
            {/* ── 5-card metric strip ── */}
            <div className="metrics" style={{ marginBottom: "var(--s-7)" }}>
              <div className="metric is-feature">
                <span className="label">Profiles</span>
                <span className="num">{statsLoading ? "…" : (totals.profiles_signed_up ?? 0)}</span>
                <span className="delta">Users on platform</span>
              </div>
              <div className="metric">
                <span className="label">Applications</span>
                <span className="num">{statsLoading ? "…" : submitted}</span>
                <span className="delta">
                  {submitted ? `TIR ${tirCount} · SIP ${sipCount}` : "None yet"}
                </span>
              </div>
              <div className="metric">
                <span className="label">Advanced</span>
                <span className="num">{statsLoading ? "…" : (totals.advanced_past_review ?? 0)}</span>
                <span className="delta">
                  {submitted
                    ? `${Math.round(((totals.advanced_past_review ?? 0) / submitted) * 100)}% of submissions`
                    : "—"}
                </span>
              </div>
              <div className="metric">
                <span className="label">Onboarded</span>
                <span className="num">{statsLoading ? "…" : (totals.onboarded ?? 0)}</span>
                <span className="delta">From offered → ready</span>
              </div>
              <div className="metric">
                <span className="label">Avg AI score</span>
                <span className="num">{statsLoading ? "…" : avgAi}</span>
                <span className="delta">
                  {submitted > 0 ? `Across ${submitted} apps` : "No apps yet"}
                </span>
              </div>
            </div>

            {/* ── Funnel + Status grid ── */}
            <div className="split-60-40" style={{ marginBottom: "var(--s-7)" }}>
              <section>
                <div className="section-head">
                  <span className="eyebrow eyebrow-rule">Pipeline</span>
                  <h2>Funnel.</h2>
                  <p>From signup to onboarded, across both tracks.</p>
                </div>
                {statsLoading ? (
                  <div className="inline-loading">Loading funnel…</div>
                ) : (
                  <div className="funnel">
                    {funnelOrder.map((f) => {
                      const n = funnel[f.id] ?? 0;
                      const pct = Math.round((n / funnelMax) * 100);
                      return (
                        <div key={f.id} className="funnel-row">
                          <span className="f-label">{f.label}</span>
                          <div className="f-track"><div className="f-fill" style={{ width: `${pct}%` }} /></div>
                          <span className="f-n">{n}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="section-head">
                  <span className="eyebrow eyebrow-rule">Status today</span>
                  <h2>Where every app sits.</h2>
                  <p>Click a status to filter the Applications tab.</p>
                </div>
                <div className="metrics metrics-status">
                  {(stats?.status_counts || []).slice(0, 6).map((s) => {
                    const dotCls = STATUS_DOT_COLOR[s.id] || "";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`metric clickable${statusFilter === s.id ? " is-feature" : ""}`}
                        onClick={() => filterAndShow(setStatusFilter)(statusFilter === s.id ? null : s.id)}
                        style={{ textAlign: "left", cursor: "pointer" }}
                      >
                        <span className="label">
                          <span className={`dot ${dotCls}`} />
                          {s.label}
                        </span>
                        <span className="num">{s.n}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* ── AI score histogram + components ── */}
            <div className="split-60-40" style={{ marginBottom: "var(--s-7)" }}>
              <section>
                <div className="section-head">
                  <span className="eyebrow eyebrow-rule">AI score distribution</span>
                  <h2>Where the cohort lands.</h2>
                  <p>
                    {histogram.total > 0
                      ? `${histogram.total} scored applications. The darker bar marks the median bucket.`
                      : "No scored applications yet."}
                  </p>
                </div>
                {scoreSample === null ? (
                  <div className="inline-loading">Loading score sample…</div>
                ) : (
                  <>
                    <div className="histogram">
                      {histogram.bins.map((b, i) => {
                        const maxCount = Math.max(1, ...histogram.bins.map((x) => x.count));
                        const heightPct = (b.count / maxCount) * 100;
                        return (
                          <div
                            key={i}
                            className={`h-bar${i === histogram.medianIdx ? " is-median" : ""}`}
                            style={{ height: `${heightPct}%` }}
                            title={`${b.from.toFixed(1)}–${b.to.toFixed(1)} · ${b.count}`}
                          />
                        );
                      })}
                    </div>
                    <div className="histogram-axis">
                      {histogram.bins.map((b, i) => (
                        <span key={i} className="axis-label">
                          {i === 0 ? "0" : i === histogram.bins.length - 1 ? "10" : b.from.toFixed(0)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section>
                <div className="section-head">
                  <span className="eyebrow eyebrow-rule">Score components</span>
                  <h2>What the AI is weighting.</h2>
                  <p>Five signals scored 0–10. Cohort averages arrive in a later session.</p>
                </div>
                <div>
                  {componentAverages.map((c) => (
                    <div key={c.id} className="bar-row">
                      <span className="bar-label">
                        {c.label}
                        <span style={{ color: "var(--ink-dim)", fontSize: 11, marginLeft: 6 }}>
                          {c.weight}%
                        </span>
                      </span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: c.value != null ? `${c.value * 10}%` : "0%" }}
                        />
                      </div>
                      <span className="bar-value">{c.value != null ? c.value.toFixed(1) : "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* ── Industry bars ── */}
            <section>
              <div className="section-head">
                <span className="eyebrow eyebrow-rule">Industries</span>
                <h2>Where they come from.</h2>
                <p>Click a row to jump to the Applications tab pre-filtered to that industry.</p>
              </div>
              {statsLoading ? (
                <div className="inline-loading">Loading industries…</div>
              ) : (
                <div>
                  {industries.slice(0, 6).map((i) => {
                    const max = Math.max(1, ...industries.map((x) => x.n));
                    const pct = (i.n / max) * 100;
                    return (
                      <button
                        key={i.id}
                        type="button"
                        className="bar-row"
                        onClick={() => filterAndShow(setIndustry)(industry === i.id ? null : i.id)}
                        style={{
                          width: "100%",
                          background: industry === i.id ? "var(--paper-soft)" : "transparent",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          padding: "10px var(--s-3)",
                        }}
                      >
                        <span className="bar-label">{i.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="bar-value">{i.n} · {i.pct}%</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
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

            {/* Status chip row */}
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
