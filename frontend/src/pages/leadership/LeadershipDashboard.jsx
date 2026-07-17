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
import { leadershipApi } from "../../lib/leadershipApi.js";
import { fmtRelative } from "../../lib/timeFmt.js";
import { trackLabel, relabelDisplayId } from "../../lib/trackLabel.js";
import AppDrawer from "./components/AppDrawer.jsx";
import PortalSwitcher from "../../components/PortalSwitcher.jsx";
import { RecoCell } from "../../components/RecoCell.jsx";
import { bucketFor } from "./components/statusBuckets.js";
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

function StatusCell({ statusId, label }) {
  return (
    <span className="lp-chip">
      <span className={`lp-status-dot lp-status-${bucketFor(statusId)}`} />
      <span style={{ textTransform: "capitalize" }}>{label || statusId}</span>
    </span>
  );
}

// AI score 0–10 → bar + tier-coloured fill. Tier thresholds match the
// .lp-score-* classes in leadership.css (high ≥ 7, mid 5–7, low 3–5, weak < 3).
function ScorePill({ score }) {
  if (score == null || !Number.isFinite(score)) {
    return <span style={{ color: "var(--ink-dim)" }}>—</span>;
  }
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  const tier =
    score >= 7 ? "lp-score-high" :
    score >= 5 ? "lp-score-mid"  :
    score >= 3 ? "lp-score-low"  : "lp-score-weak";
  return (
    <span className={`lp-score ${tier}`}>
      <span className="lp-score-bar">
        <span className="lp-score-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="lp-score-n">{score.toFixed(1)}</span>
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

// ── CSV export ──────────────────────────────────────────────────────────
// Quote a cell if it contains a comma, quote, or newline; double embedded
// quotes (RFC 4180).
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildApplicationsCsv(rows, statusLabelById) {
  const header = [
    "Application ID", "Track", "Project", "Founder", "Organisation",
    "Industry", "Stage", "AI score", "Status", "Submitted",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const a of rows) {
    lines.push([
      relabelDisplayId(a.display_id),
      trackLabel(a.track),
      a.project_name || "",
      a.founder?.name || a.basic_full_name || "",
      a.founder?.affiliation || a.basic_org || "",
      a.industry?.label || "",
      a.stage?.label || a.stage_label || "",
      a.ai_score_overall != null ? a.ai_score_overall.toFixed(1) : "",
      statusLabelById?.[a.status] || a.status || "",
      a.submitted_at || a.created_at || "",
    ].map(csvCell).join(","));
  }
  // Lead with a BOM so Excel opens it as UTF-8.
  return "﻿" + lines.join("\r\n");
}

function triggerCsvDownload(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function LeadershipDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const roles = user?.roles || [];
  // Hide the "Switch to applicant" buttons for accounts whose /apply is
  // role-gated away (admin or leadership). Clicking the button for those
  // users would just bounce them back here via ApplyRoleGate.
  const showSwitchToApplicant =
    !roles.includes("leadership") && !roles.includes("admin");
  // Consolidated role-switch dropdown (mirrors AdminPortal / ReviewerPortal).
  // Lists the staff portals this account can reach; Leadership is the current
  // one and is shown as active. Only rendered when the user holds ≥2 of
  // {leadership, reviewer, admin} so there's somewhere to switch to.
  const otherPortals = [
    { key: "reviewer", label: "Reviewer", to: "/reviewer" },
    { key: "admin", label: "Admin", to: "/admin" },
  ].filter((p) => roles.includes(p.key));
  const showRoleSwitch = otherPortals.length > 0;
  const [roleMenu, setRoleMenu] = useState(false);
  const switchPortal = (p) => {
    setRoleMenu(false);
    navigate(p.to);
  };

  const [view, setView] = useState("dashboard");

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  const [scoreSample, setScoreSample] = useState(null);

  // Industry filter pills + dashboard-tab bar chart both read from this
  // single source (the new /leadership/industry-categories endpoint).
  const [industryCategories, setIndustryCategories] = useState([]);
  const [industryTotal, setIndustryTotal] = useState(0);
  const [industryCap, setIndustryCap] = useState({ cap: 12, remaining_slots: 12 });

  const [industry, setIndustry] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [trackFilter, setTrackFilter] = useState(null);
  // AI score bucket filter (0–9). Matches the histogram's floor()-bucketing
  // exactly — bucket i covers scores [i, i+1), bucket 9 also catches 10.
  // Set by clicking a histogram bar; the click also flips view to Applications.
  const [scoreBucket, setScoreBucket] = useState(null);
  const [recoFilter, setRecoFilter] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  // Applications-tab filter panel (Status / AI score / Industry) collapses
  // behind a "Filters ▾" toggle, matching the admin pipeline presentation.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [apps, setApps] = useState([]);
  const [appsTotal, setAppsTotal] = useState(0);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState(null);

  const [openRow, setOpenRow] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Bumped after a gate-1 decision (e.g. reject) to refetch stats + the list.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // ── Click-to-sort state for the applications table ──
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  // ── Initial fetch ──
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    leadershipApi.getStats()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        setStatsLoading(false);
        // Score-distribution histogram reads the full set of AI overall
        // scores the stats endpoint bundles in (all screened apps), not a
        // capped page of the applications list.
        const ss = (s?.ai_score_overalls || [])
          .filter((v) => typeof v === "number" && Number.isFinite(v));
        setScoreSample(ss);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatsError(err?.message || "Failed to load stats.");
        setStatsLoading(false);
        setScoreSample([]);
      });
    leadershipApi.getIndustryCategories()
      .then((data) => {
        if (cancelled) return;
        setIndustryCategories(data?.categories || []);
        setIndustryTotal(data?.total ?? 0);
        setIndustryCap({
          cap: data?.cap ?? 12,
          remaining_slots: data?.remaining_slots ?? 0,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setIndustryCategories([]);
        setIndustryTotal(0);
      });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  // ── Search debounce — strip "TIR-"/"SIP-" prefix so pasted IDs hit
  //   the backend's display_seq.eq match.
  useEffect(() => {
    const t = setTimeout(() => {
      const stripped = searchInput.replace(/^(TIR|SIP|VIP)-/i, "");
      setSearch(stripped);
      setOffset(0);
    }, 300);
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
      ai_score_bucket: scoreBucket ?? undefined,
      recommendation: recoFilter || undefined,
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
  }, [industry, statusFilter, trackFilter, scoreBucket, recoFilter, search, offset, refreshNonce]);

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

  // Map the new /industry-categories payload to the shape the existing
  // dashboard-tab bar chart expects ({id, label, n, pct}). Single source
  // for the filter pills too.
  const industries = useMemo(() => {
    if (!industryCategories.length) return [];
    return industryCategories.map((c) => ({
      id: c.id,
      label: c.label,
      n: c.count,
      pct: industryTotal > 0 ? Math.round((c.count / industryTotal) * 1000) / 10 : 0,
    }));
  }, [industryCategories, industryTotal]);

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
    setScoreBucket(null);
    setRecoFilter(null);
    setSearchInput("");
    setSearch("");
    setOffset(0);
  }

  // Export the applications that match the CURRENT filters (not just the
  // loaded page) — fetch a large page, then build + download a CSV client-side.
  const handleExportCsv = useCallback(async () => {
    setExporting(true);
    try {
      // The list endpoint caps `limit` at 200, so page through until we've
      // collected every row matching the current filters.
      const EXPORT_PAGE = 200;
      const baseParams = {
        industry: industry || undefined,
        status: statusFilter || undefined,
        track: trackFilter ? trackFilter.toLowerCase() : undefined,
        ai_score_bucket: scoreBucket ?? undefined,
        recommendation: recoFilter || undefined,
        search: search || undefined,
      };
      const all = [];
      let pageOffset = 0;
      let total = Infinity;
      // Hard cap the loop (50 pages = 10k rows) as a safety net.
      for (let i = 0; i < 50 && pageOffset < total; i += 1) {
        const page = await leadershipApi.listApplications({
          ...baseParams,
          limit: EXPORT_PAGE,
          offset: pageOffset,
        });
        const rows = page?.applications || [];
        all.push(...rows);
        total = page?.total ?? all.length;
        if (rows.length === 0) break;
        pageOffset += EXPORT_PAGE;
      }
      if (all.length === 0) {
        window.alert("No applications match the current filters.");
        return;
      }
      const csv = buildApplicationsCsv(all, statusLabelById);
      const stamp = new Date().toISOString().slice(0, 10);
      triggerCsvDownload(csv, `artpark-applications-${stamp}.csv`);
    } catch (err) {
      window.alert(err?.message || "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [industry, statusFilter, trackFilter, scoreBucket, recoFilter, search, statusLabelById]);
  const filtersActive = !!(
    industry || statusFilter || trackFilter || scoreBucket !== null || search || recoFilter
  );
  // Count of applied filters living inside the collapsible panel (Status /
  // AI score / Industry) — shown as a badge on the "Filters" toggle so it's
  // discoverable when the panel is closed.
  const advFilterCount =
    (statusFilter ? 1 : 0) + (scoreBucket !== null ? 1 : 0) + (industry ? 1 : 0) + (recoFilter ? 1 : 0);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const renderAppsHeader = (label, colKey, isNum = false) => {
    const isSorted = sortCol === colKey;
    return (
      <th
        className={isNum ? "num" : ""}
        onClick={() => handleSort(colKey)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}
          {isSorted ? (sortAsc ? " ▲" : " ▼") : ""}
        </span>
      </th>
    );
  };

  const sortedApps = useMemo(() => {
    if (!sortCol) return apps;
    return [...apps].sort((a, b) => {
      let valA, valB;
      if (sortCol === "project") {
        valA = a.project_name || "";
        valB = b.project_name || "";
      } else if (sortCol === "founder") {
        valA = a.founder?.name || a.basic_full_name || "";
        valB = b.founder?.name || b.basic_full_name || "";
      } else if (sortCol === "industry") {
        valA = a.industry?.label || "";
        valB = b.industry?.label || "";
      } else if (sortCol === "stage") {
        valA = a.stage?.label || a.stage_label || "";
        valB = b.stage?.label || b.stage_label || "";
      } else if (sortCol === "ai_score") {
        valA = a.ai_score_overall != null ? a.ai_score_overall : -1;
        valB = b.ai_score_overall != null ? b.ai_score_overall : -1;
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      } else if (sortCol === "reviewer_score") {
        valA = a.reviewer_score != null ? a.reviewer_score : -1;
        valB = b.reviewer_score != null ? b.reviewer_score : -1;
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      } else if (sortCol === "reviewers") {
        valA = a.reviewers ? a.reviewers.submitted : -1;
        valB = b.reviewers ? b.reviewers.submitted : -1;
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      } else if (sortCol === "status") {
        valA = statusLabelById[a.status] || a.status || "";
        valB = statusLabelById[b.status] || b.status || "";
      } else if (sortCol === "submitted") {
        valA = a.submitted_at || a.created_at || "";
        valB = b.submitted_at || b.created_at || "";
      } else if (sortCol === "id") {
        valA = a.display_id || "";
        valB = b.display_id || "";
      } else {
        return 0;
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [apps, sortCol, sortAsc, statusLabelById]); // eslint-disable-line react-hooks/exhaustive-deps

  // Human-readable snapshot timestamp for the hero subline.
  const snapshotAt = useMemo(() => {
    return new Date().toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).replace(",", " ·") + " IST";
  }, [stats]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-shell">
      <header className="app-header app-header-leadership">
        <div className="logos">
          <img
            src="/assets/artpark-iisc-logo.webp"
            alt="ARTPARK · AI & Robotics Technology Park at IISc"
            className="brand-combined"
          />
        </div>

        <span className="role-pill">Leadership · Dashboard</span>

        <div className="spacer" />

        <div className="user-chip-lp">
          <span className="avatar" aria-hidden="true">{initialsFor(user)}</span>
          <span className="email">{user?.email || user?.full_name || "—"}</span>
          <span className="menu-dot" aria-hidden="true">⌄</span>
        </div>

        {showSwitchToApplicant && (
          <a className="applicant-btn" href="/apply" aria-label="Switch to applicant view">
            <span className="arrow" style={{ marginLeft: 0, marginRight: 2 }}>←</span> Applicant
          </a>
        )}

        <PortalSwitcher current="leadership" />

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
              TIR + VIP cohort <em>2026</em>
            </h1>
          </div>
          <div className="lp-head-r">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleExportCsv}
              disabled={exporting}
              aria-busy={exporting ? "true" : undefined}
            >
              {exporting ? "Exporting…" : <>Export CSV <span style={{ marginLeft: 4 }}>↓</span></>}
            </button>
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
                      <span className="lp-metric-split-label">{trackLabel("sip")}</span>
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
                        const isSelected = scoreBucket === i;
                        const isEmpty = b.count === 0;
                        const cls = [
                          "lp-hist-bar",
                          isSelected ? "is-selected" : "",
                          !isSelected && i === histogram.medianIdx ? "is-peak" : "",
                        ].filter(Boolean).join(" ");
                        const labelRange = `${b.from.toFixed(0)}–${b.to.toFixed(0)}`;
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`lp-hist-col lp-hist-col-btn${isEmpty ? " is-empty" : ""}`}
                            onClick={() => {
                              if (isEmpty) return;
                              const next = isSelected ? null : i;
                              setScoreBucket(next);
                              setOffset(0);
                              if (next !== null) setView("applications");
                            }}
                            disabled={isEmpty}
                            aria-pressed={isSelected}
                            aria-label={
                              isEmpty
                                ? `No applications in score range ${labelRange}`
                                : `Show ${b.count} application${b.count === 1 ? "" : "s"} in score range ${labelRange}`
                            }
                            title={
                              isEmpty
                                ? `Score ${labelRange} · 0 applications`
                                : `Score ${labelRange} · ${b.count} application${b.count === 1 ? "" : "s"} — click to filter`
                            }
                          >
                            <span className="lp-hist-bar-n">{b.count}</span>
                            <div className="lp-hist-bar-wrap">
                              <div
                                className={cls}
                                style={{ height: `${heightPct}%` }}
                              />
                            </div>
                            <span className="lp-hist-label">{labelRange}</span>
                          </button>
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
                          </div>
                          <span className="lp-ind-n">
                            <strong>{i.n}</strong> · {i.pct}%
                          </span>
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
                      All
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

            {/* ── Footer ── */}
            <div className="page-foot">
              <span>ARTPARK / OS · Leadership view</span>
              {showSwitchToApplicant && (
                <a href="/apply" className="foot-link">
                  <span className="arrow" style={{ marginLeft: 0, marginRight: 4 }}>←</span>
                  Switch to applicant view
                </a>
              )}
            </div>
          </>
        )}

        {view === "applications" && (
          <>
            <div className="filter-bar">
              <input
                className="field filter-search"
                type="search"
                placeholder="Search by name, email, org, or project"
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
                {[["tir", "TIR"], ["sip", "VIP"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip${trackFilter === value ? " active" : ""}`}
                    onClick={() => { setTrackFilter(trackFilter === value ? null : value); setOffset(0); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="filter-spacer" />
              {filtersActive && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllFilters}>
                  Clear filters
                </button>
              )}
              <button
                type="button"
                className={`lp-filters-toggle${filtersOpen ? " is-open" : ""}`}
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
                <span>Filters</span>
                {advFilterCount > 0 && <span className="lp-filters-count">{advFilterCount}</span>}
                <span className="lp-filters-caret">{filtersOpen ? "▴" : "▾"}</span>
              </button>
              <span className="filter-count">
                {appsLoading ? "…" : `${apps.length} of ${appsTotal}`}
              </span>
            </div>

            {filtersOpen && (
            <>
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
                {(stats?.status_counts || [])
                  .filter((s) => s.id !== "ai_screening")
                  .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip${statusFilter === s.id ? " active" : ""}`}
                    onClick={() => { setStatusFilter(statusFilter === s.id ? null : s.id); setOffset(0); }}
                  >
                    <span
                      className={`lp-status-dot lp-status-${bucketFor(s.id)}`}
                      style={{ marginRight: 6 }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-bar" style={{ marginBottom: "var(--s-5)" }}>
              <span className="eyebrow" style={{ marginRight: "var(--s-3)" }}>AI score</span>
              <div className="filter-chips">
                <button
                  type="button"
                  className={`chip${scoreBucket === null ? " active" : ""}`}
                  onClick={() => { setScoreBucket(null); setOffset(0); }}
                >
                  All
                </button>
                {Array.from({ length: HISTOGRAM_BIN_COUNT }, (_, i) => {
                  const count = histogram.bins[i]?.count ?? 0;
                  const isActive = scoreBucket === i;
                  const isEmpty = count === 0 && !isActive;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`chip${isActive ? " active" : ""}`}
                      onClick={() => {
                        setScoreBucket(isActive ? null : i);
                        setOffset(0);
                      }}
                      disabled={isEmpty}
                      title={`Score ${i}–${i + 1} · ${count} application${count === 1 ? "" : "s"}`}
                    >
                      {i}–{i + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {industryCategories.length > 0 && (
              <div className="filter-bar" style={{ marginBottom: "var(--s-5)" }}>
                <span className="eyebrow" style={{ marginRight: "var(--s-3)" }}>Industry</span>
                <div className="filter-chips">
                  <button
                    type="button"
                    className={`chip${!industry ? " active" : ""}`}
                    onClick={() => { setIndustry(null); setOffset(0); }}
                  >
                    All
                  </button>
                  {industryCategories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip${industry === c.id ? " active" : ""}`}
                      onClick={() => {
                        setIndustry(industry === c.id ? null : c.id);
                        setOffset(0);
                      }}
                      title={`${c.count} application${c.count === 1 ? "" : "s"}`}
                    >
                      {c.label}{" "}
                      <span className="lp-pill-count">{c.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="filter-bar" style={{ marginBottom: "var(--s-5)" }}>
              <span className="eyebrow" style={{ marginRight: "var(--s-3)" }}>Recommendation</span>
              <div className="filter-chips">
                <button type="button" className={`chip${!recoFilter ? " active" : ""}`}
                  onClick={() => { setRecoFilter(null); setOffset(0); }}>All</button>
                {[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]].map(([v, label]) => (
                  <button key={v} type="button" className={`chip${recoFilter === v ? " active" : ""}`}
                    onClick={() => { setRecoFilter(recoFilter === v ? null : v); setOffset(0); }}>{label}</button>
                ))}
              </div>
            </div>
            </>
            )}

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
              <table className="tbl lp-apps-table">
                <thead>
                  <tr>
                    {renderAppsHeader("Project", "project")}
                    {renderAppsHeader("Founder", "founder")}
                    {renderAppsHeader("Industry", "industry")}
                    {renderAppsHeader("Stage", "stage")}
                    {renderAppsHeader("AI score", "ai_score", true)}
                    {renderAppsHeader("Reviewer score", "reviewer_score", true)}
                    {renderAppsHeader("Reviewers", "reviewers", true)}
                    <th>Reco</th>
                    {renderAppsHeader("Status", "status")}
                    {renderAppsHeader("Submitted", "submitted")}
                    <th className="lp-id-col" onClick={() => handleSort("id")} style={{ cursor: "pointer", userSelect: "none" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        ID{sortCol === "id" ? (sortAsc ? " ▲" : " ▼") : ""}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedApps.map((a) => (
                    <tr
                      key={`${a.track}-${a.id}`}
                      className="clickable"
                      onClick={() => setOpenRow(a)}
                    >
                      <td className="lp-cell-project">
                        <div className="lp-cell-primary">
                          {a.project_name || (
                            <span style={{ color: "var(--ink-dim)" }}>—</span>
                          )}
                        </div>
                        <div className="lp-cell-sub">
                          {relabelDisplayId(a.display_id)} · {trackLabel(a.track)}
                          {a.moved_to_track && (
                            <span className="os-chip" title={`Moved to ${trackLabel(a.moved_to_track)}`}
                              style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                                background: '#fff4d6', border: '1px solid #e6c34d', color: '#8a6d00',
                                borderRadius: 999, padding: '1px 6px', verticalAlign: 'middle' }}>
                              → {trackLabel(a.moved_to_track).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="lp-cell-founder">
                        <div className="lp-cell-primary">
                          {a.founder?.name || (
                            <span style={{ color: "var(--ink-dim)" }}>—</span>
                          )}
                        </div>
                        <div className="lp-cell-sub">
                          {a.founder?.affiliation || "—"}
                        </div>
                      </td>
                      <td>{a.industry?.label || "—"}</td>
                      <td title={a.stage?.raw || ""}>{a.stage?.label || "—"}</td>
                      <td className="num">
                        <ScorePill score={a.ai_score_overall} />
                      </td>
                      <td className="num">
                        {a.reviewer_score != null
                          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>{Number(a.reviewer_score).toFixed(1)}</span>
                          : <span style={{ color: "var(--ink-dim)" }}>—</span>
                        }
                      </td>
                      <td className="num">
                        {a.reviewers && (a.reviewers.assigned > 0 || a.reviewers.submitted > 0)
                          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{a.reviewers.submitted} / {a.reviewers.assigned}</span>
                          : <span style={{ color: "var(--ink-dim)" }}>—</span>}
                      </td>
                      <td><RecoCell reco={a.reco} /></td>
                      <td>
                        <StatusCell
                          statusId={a.status}
                          label={statusLabelById[a.status] || a.status}
                        />
                      </td>
                      <td>{fmtRelative(a.submitted_at || a.created_at)}</td>
                      <td className="lp-id-col">{relabelDisplayId(a.display_id)}</td>
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
            onDecided={() => { setOpenRow(null); setRefreshNonce((n) => n + 1); }}
          />
        )}
      </main>
    </div>
  );
}
