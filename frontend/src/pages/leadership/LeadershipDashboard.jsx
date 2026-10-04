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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { leadershipApi } from "../../lib/leadershipApi.js";
import { fmtRelative } from "../../lib/timeFmt.js";
import { trackLabel, relabelDisplayId } from "../../lib/trackLabel.js";
import AppDrawer from "./components/AppDrawer.jsx";
import PortalSwitcher from "../../components/PortalSwitcher.jsx";
import { RecoCell, RECO_LABEL, aggregateReco } from "../../components/RecoCell.jsx";
import { useStickyState } from "../../hooks/useStickyState.js";
import {
  fetchAllApplications,
  loadSelectedKeys,
  rowNativeTrack,
} from "./selectedStartups.js";
import {
  STAGES,
  breakdownFor,
  recoQuery,
  rowStage,
  stageQuery,
} from "./pipelineStages.js";
import PipelineBreakdown from "./components/PipelineBreakdown.jsx";
import { writeReviewIdList } from "./reviewNav.js";
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

// Status dot for a stage — a .lp-status-{bucket} class or a literal colour.
export function StageDot({ stage, style }) {
  if (stage?.color) {
    return <span className="lp-status-dot" style={{ background: stage.color, ...style }} />;
  }
  return <span className={`lp-status-dot lp-status-${stage?.dot || "open"}`} style={style} />;
}

// One label for a row everywhere (list, drawer, review page, CSV) — see
// pipelineStages.js. "Final selected" keeps the green tag styling.
export function StageCell({ stage }) {
  const selected = stage?.id === "final_selected";
  return (
    <span
      className={`lp-chip${selected ? " lp-selected-tag" : ""}`}
      style={selected ? { background: "#e6f4ec", border: `1px solid ${stage.color}`, color: "#1d6b43", fontWeight: 600 } : undefined}
    >
      <StageDot stage={stage} />
      <span>{stage?.label || "—"}</span>
    </span>
  );
}

// Reviewers "submitted / assigned". Reviews by a reviewer who has since been
// unassigned must never read "3 / 0" — say what happened instead.
function reviewersText(rv) {
  if (!rv || !(rv.assigned > 0 || rv.submitted > 0)) return null;
  if (rv.submitted > rv.assigned) return `${rv.submitted} submitted`;
  return `${rv.submitted} / ${rv.assigned}`;
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

export function buildApplicationsCsv(rows, selectedKeys = null) {
  const header = [
    "Application ID", "Track", "Project", "Founder", "Organisation",
    "Industry", "Stage", "AI score", "Reviewer score", "Reviewers", "Reco",
    "Status", "Submitted",
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
      a.reviewer_score != null ? Number(a.reviewer_score).toFixed(1) : "",
      reviewersText(a.reviewers) || "",
      RECO_LABEL[aggregateReco(a.reco)] || "",
      rowStage(a, { selectedKeys }).label,
      a.submitted_at || a.created_at || "",
    ].map(csvCell).join(","));
  }
  // Lead with a BOM so Excel opens it as UTF-8.
  return "﻿" + lines.join("\r\n");
}

// Strip a pasted "TIR-"/"VIP-"/"SIP-" prefix so IDs hit the backend's
// display_seq match; trim first so stray spaces don't zero the results.
const normSearch = (v) => (v || "").trim().replace(/^(TIR|SIP|VIP)-/i, "");

// One list query for the current filters. Stages / reco buckets the API can't
// express exactly (see pipelineStages.js) fetch every page under the coarser
// server filter and are narrowed + paginated here; the server-side sort still
// orders the whole set. `all` returns every matching row (CSV, review Prev/Next).
export async function queryApplications({
  base, statusFilter, recoFilter, selectedKeys, offset = 0, limit = PAGE_SIZE, all = false,
}) {
  const sq = stageQuery(statusFilter);
  const rq = recoQuery(recoFilter);
  const params = { ...base, status: sq.status, recommendation: rq.recommendation };
  const keeps = [sq.keep, rq.keep].filter(Boolean);
  if (!keeps.length && !all) {
    const page = await leadershipApi.listApplications({ ...params, limit, offset });
    return { rows: page?.applications || [], total: page?.total ?? 0 };
  }
  const ctx = { selectedKeys };
  const rows = (await fetchAllApplications(params)).filter((r) => keeps.every((k) => k(r, ctx)));
  return { rows: all ? rows : rows.slice(offset, offset + limit), total: rows.length };
}

// Columns the list API can sort server-side (contract C3). Others are not
// sortable: a client sort would only reorder the current page.
const SORT_PARAM = {
  id: "id", project: "project", founder: "founder", industry: "industry",
  ai_score: "ai_score", reco: "reco", status: "status", submitted: "submitted_at",
};

const STICKY = "leadership";

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

  // View + filters are sticky so "← Back" from the review page lands on the
  // same tab, filters, sort and page.
  const [view, setView] = useStickyState(STICKY, "view", "dashboard");

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  const [scoreSample, setScoreSample] = useState(null);

  // Industry filter pills + dashboard-tab bar chart both read from this
  // single source (the new /leadership/industry-categories endpoint).
  const [industryCategories, setIndustryCategories] = useState([]);
  const [industryTotal, setIndustryTotal] = useState(0);
  // Apps with no industry; null until the backend reports it (then clickable).
  const [industryUnclassified, setIndustryUnclassified] = useState(null);
  const [industryCap, setIndustryCap] = useState({ cap: 12, remaining_slots: 12 });

  const [industry, setIndustry] = useStickyState(STICKY, "industry", null);
  // A pipeline stage id (pipelineStages.STAGES), not a raw status.
  const [statusFilter, setStatusFilter] = useStickyState(STICKY, "stage", null);
  const [trackFilter, setTrackFilter] = useStickyState(STICKY, "track", null);
  // AI score bucket filter (0–9). Matches the histogram's floor()-bucketing
  // exactly — bucket i covers scores [i, i+1), bucket 9 also catches 10.
  // Set by clicking a histogram bar; the click also flips view to Applications.
  const [scoreBucket, setScoreBucket] = useStickyState(STICKY, "scoreBucket", null);
  const [recoFilter, setRecoFilter] = useStickyState(STICKY, "reco", null);
  const [searchInput, setSearchInput] = useStickyState(STICKY, "search", "");
  const [search, setSearch] = useState(() => normSearch(searchInput));
  const [offset, setOffset] = useStickyState(STICKY, "offset", 0);
  // Applications-tab filter panel (Status / AI score / Industry) collapses
  // behind a "Filters ▾" toggle, matching the admin pipeline presentation.
  const [filtersOpen, setFiltersOpen] = useStickyState(STICKY, "filtersOpen", false);

  const [apps, setApps] = useState([]);
  const [appsTotal, setAppsTotal] = useState(0);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState(null);

  // Keys (`${native_track}:${id}`) of every selected startup (all current IC
  // memos signed), or null while loading / if the IC-documents or shortlist
  // fetch failed. Only a fallback once rows carry `final_selected`.
  const [selectedKeys, setSelectedKeys] = useState(null);

  const [openRow, setOpenRow] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Bumped after a gate-1 decision (e.g. reject) to refetch stats + the list.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // ── Click-to-sort state for the applications table (server-side) ──
  const [sortCol, setSortCol] = useStickyState(STICKY, "sortCol", null);
  const [sortAsc, setSortAsc] = useStickyState(STICKY, "sortAsc", true);

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
        // Backend sends {id, label, count}; tolerate a bare number too.
        const unc = data?.unclassified;
        const uncN = typeof unc === "number" ? unc : unc?.count;
        setIndustryUnclassified(typeof uncN === "number" ? uncN : null);
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
    loadSelectedKeys()
      .then((keys) => { if (!cancelled) setSelectedKeys(keys); })
      .catch(() => { if (!cancelled) setSelectedKeys(null); });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  // ── Search debounce — trimmed, prefix-stripped (normSearch). Only a real
  //   change resets the page, so a remount keeps the sticky offset.
  const searchRef = useRef(search);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = normSearch(searchInput);
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearch(next);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filters shared by the list, the CSV export and the review Prev/Next list.
  const baseParams = useMemo(() => ({
    industry: industry || undefined,
    track: trackFilter ? trackFilter.toLowerCase() : undefined,
    ai_score_bucket: scoreBucket ?? undefined,
    search: search || undefined,
    sort: sortCol ? SORT_PARAM[sortCol] : undefined,
    order: sortCol ? (sortAsc ? "asc" : "desc") : undefined,
  }), [industry, trackFilter, scoreBucket, search, sortCol, sortAsc]);
  // Final pending / selected are split on the IC-memo selection.
  const needsSelection = statusFilter === "final_selected" || statusFilter === "final_pending";

  // ── Refetch app list on any filter change ──
  useEffect(() => {
    let cancelled = false;
    setAppsLoading(true);
    setAppsError(null);
    queryApplications({ base: baseParams, statusFilter, recoFilter, selectedKeys, offset })
      .then(({ rows, total }) => {
        if (cancelled) return;
        setApps(rows);
        setAppsTotal(total);
        setAppsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setAppsError(err?.message || "Failed to load applications.");
        setAppsLoading(false);
      });
    return () => { cancelled = true; };
  // selectedKeys only matters for the final-round split — keep it out of the
  // deps otherwise so its initial load doesn't refetch the list.
  }, [baseParams, statusFilter, recoFilter, offset, refreshNonce, // eslint-disable-line react-hooks/exhaustive-deps
      needsSelection ? selectedKeys : null]);

  const filterAndShow = useCallback(
    (setter) => (val) => {
      setter(val);
      setOffset(0);
      if (val) setView("applications");
    },
    [],
  );

  const totals = stats?.totals || {};
  const submitted = totals.apps_submitted ?? 0;

  // Map the /industry-categories payload to the dashboard bar chart shape
  // ({id, label, n, pct}). Apps with no industry get an "Unclassified" bar so
  // the bars add up to every submitted app; percentages share that base and
  // always show one decimal.
  const unclassifiedN = industryUnclassified ?? (
    stats && industryTotal > 0 ? Math.max(0, submitted - industryTotal) : 0
  );
  const industries = useMemo(() => {
    if (!industryCategories.length) return [];
    const base = industryTotal + unclassifiedN;
    const pct = (n) => (base > 0 ? ((n / base) * 100).toFixed(1) : "0.0");
    const out = industryCategories.map((c) => ({
      id: c.id, label: c.label, n: c.count, pct: pct(c.count),
    }));
    if (unclassifiedN > 0) {
      out.push({
        id: "unclassified", label: "Unclassified", n: unclassifiedN, pct: pct(unclassifiedN),
        // Filterable only once the backend accepts industry=unclassified.
        clickable: industryUnclassified != null,
      });
    }
    return out;
  }, [industryCategories, industryTotal, unclassifiedN, industryUnclassified]);

  // Status chips: pipeline stages with live counts (contract C1), narrowed to
  // the track filter. Empty stages are hidden unless active. Without the
  // breakdown (older backend) every stage shows, uncounted.
  const breakdown = breakdownFor(stats, trackFilter);
  const stageChips = STAGES.map((st) => {
    let n = breakdown ? breakdown.stages?.[st.id] ?? 0 : null;
    if (n == null && st.id === "final_selected" && selectedKeys) n = selectedKeys.size;
    return { ...st, n };
  }).filter((st) => !breakdown || st.n > 0 || statusFilter === st.id);
  const tirCount = totals.tir_count ?? 0;
  const sipCount = totals.sip_count ?? 0;
  const avgAi =
    totals.avg_ai_score === null || totals.avg_ai_score === undefined
      ? "—"
      : Number(totals.avg_ai_score).toFixed(1);
  const profiles = totals.profiles_signed_up ?? 0;
  const pipeline = stats?.pipeline_breakdown || null;
  // Passed the 1st gate (final round + offered + onboarded), per contract C1.
  const advanced = pipeline?.gate1_selected ?? totals.advanced_past_review ?? 0;
  const scoredCount = stats?.ai_scored_count ?? (stats?.ai_score_overalls || []).length;
  const onboarded = totals.onboarded ?? 0;

  // Six-step funnel. Backend may not yet expose `drafted` — it will render as 0
  // if missing, leaving the row visible but empty (better than silently dropping).
  const funnel = stats?.funnel || {};
  const funnelOrder = [
    { id: "profiles",  label: "Profiles",  sub: "signed up" },
    { id: "drafted",   label: "Drafted",   sub: "started" },
    { id: "submitted", label: "Submitted", sub: "complete" },
    { id: "in_review", label: "In review", sub: "with reviewers" },
    { id: "advanced",  label: "Advanced",  sub: "1st-gate selected" },
    { id: "decided",   label: "Decided",   sub: "offered + onboarded" },
  ];
  const funnelMax = Math.max(1, ...funnelOrder.map((f) => funnel[f.id] ?? 0));

  // Real per-component means from /leadership/stats (ai_component_means).
  // Weights are the scorer's (workers/ai_screener/scoring.py WEIGHTS). A
  // missing mean renders "—", never a stand-in number.
  const componentAverages = useMemo(() => {
    const means = stats?.ai_component_means || {};
    const val = (k) => (typeof means[k] === "number" && Number.isFinite(means[k]) ? means[k] : null);
    return [
      { id: "problem",    label: "Problem Impact & Importance",      weight: 22, value: val("problem") },
      { id: "solution",   label: "Completeness & Depth of Solution", weight: 30, value: val("solution") },
      { id: "tech",       label: "Technical Depth",                  weight: 22, value: val("tech") },
      { id: "founders",   label: "Behavioral Parameters",            weight: 14, value: val("founders") },
      { id: "commitment", label: "Commitment",                       weight: 12, value: val("commitment") },
    ];
  }, [stats]);

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

  // Export the applications that match the CURRENT filters and sort (not
  // just the loaded page), then build + download a CSV client-side.
  const handleExportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const { rows: all } = await queryApplications({
        base: baseParams, statusFilter, recoFilter, selectedKeys, all: true,
      });
      if (all.length === 0) {
        window.alert("No applications match the current filters.");
        return;
      }
      const csv = buildApplicationsCsv(all, selectedKeys);
      // Local (IST) date, not the UTC one toISOString() gives.
      const stamp = new Date().toLocaleDateString("en-CA");
      triggerCsvDownload(csv, `artpark-applications-${stamp}.csv`);
    } catch (err) {
      window.alert(err?.message || "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [baseParams, statusFilter, recoFilter, selectedKeys]);

  // "Review application": Prev/Next on the review page walks the list the user
  // came from. Seed it with the visible page right away, then swap in every
  // matching row once fetched (the review page listens for the update).
  const openReview = useCallback((row) => {
    const entry = (r) => ({ id: r.id, track: rowNativeTrack(r), label: rowStage(r, { selectedKeys }).label });
    writeReviewIdList(apps.map(entry));
    navigate(`/leadership/applications/${rowNativeTrack(row)}/${row.id}/review`);
    if (appsTotal > apps.length) {
      queryApplications({ base: baseParams, statusFilter, recoFilter, selectedKeys, all: true })
        .then(({ rows }) => { if (rows.length) writeReviewIdList(rows.map(entry)); })
        .catch(() => { /* best-effort: the visible page is already stored */ });
    }
  }, [apps, appsTotal, baseParams, statusFilter, recoFilter, selectedKeys, navigate]);
  const filtersActive = !!(
    industry || statusFilter || trackFilter || scoreBucket !== null || search || recoFilter
  );
  // Count of applied filters living inside the collapsible panel (Status /
  // AI score / Industry) — shown as a badge on the "Filters" toggle so it's
  // discoverable when the panel is closed.
  const advFilterCount =
    (statusFilter ? 1 : 0) + (scoreBucket !== null ? 1 : 0) + (industry ? 1 : 0) + (recoFilter ? 1 : 0);

  // Sorting is server-side over every filtered row (contract C3, nulls last),
  // so a new sort always starts at page 1.
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
    setOffset(0);
  };

  const renderAppsHeader = (label, colKey, isNum = false) => {
    if (!SORT_PARAM[colKey]) return <th className={isNum ? "num" : ""}>{label}</th>;
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
                <span className="lp-metric-kicker">1st-gate selected</span>
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
                  {scoredCount ? `across ${scoredCount} scored apps` : "no scored apps yet"}
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

            {/* ── Gate-aware status breakdown (sums to every submitted app) ── */}
            {pipeline && (
              <PipelineBreakdown
                breakdown={pipeline}
                activeStage={statusFilter}
                onFilter={(id) => filterAndShow(setStatusFilter)(statusFilter === id ? null : id)}
              />
            )}

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
                    Five weighted signals scored 0–10; the overall score is their weighted mean.
                    Bars show the cohort average of each signal.
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
                      const clickable = i.clickable !== false;
                      return (
                        <button
                          key={i.id}
                          type="button"
                          className="lp-ind-row"
                          disabled={!clickable}
                          onClick={() => clickable && filterAndShow(setIndustry)(industry === i.id ? null : i.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            textAlign: "left",
                            cursor: clickable ? "pointer" : "default",
                            width: "100%",
                            color: "inherit",
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
                    {industries.filter((i) => i.clickable !== false).map((i) => (
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
                placeholder="Search by name, email, org, project or ID"
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
                {stageChips.map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    className={`chip${statusFilter === st.id ? " active" : ""}`}
                    onClick={() => { setStatusFilter(statusFilter === st.id ? null : st.id); setOffset(0); }}
                    title={st.id === "final_selected"
                      ? "Final round with every current IC memo signed"
                      : undefined}
                  >
                    <StageDot stage={st} style={{ marginRight: 6 }} />
                    {st.label}
                    {st.n != null && <>{" "}<span className="lp-pill-count">{st.n}</span></>}
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
                  {industries.filter((c) => c.clickable !== false).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip${industry === c.id ? " active" : ""}`}
                      onClick={() => {
                        setIndustry(industry === c.id ? null : c.id);
                        setOffset(0);
                      }}
                      title={`${c.n} application${c.n === 1 ? "" : "s"}`}
                    >
                      {c.label}{" "}
                      <span className="lp-pill-count">{c.n}</span>
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
                {[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"],
                  ["single", "1 review", "One review so far — a verdict needs 2"],
                  ["none", "No reviews"]].map(([v, label, title]) => (
                  <button key={v} type="button" className={`chip${recoFilter === v ? " active" : ""}`}
                    title={title}
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
                    {renderAppsHeader("Reco", "reco")}
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
                  {apps.map((a) => (
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
                            <span className="os-chip"
                              title={`Moved from ${trackLabel(a.native_track || a.track)}`}
                              style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                                background: '#fff4d6', border: '1px solid #e6c34d', color: '#8a6d00',
                                borderRadius: 999, padding: '1px 6px', verticalAlign: 'middle' }}>
                              {trackLabel(a.native_track || a.track).toUpperCase()} →
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
                        {reviewersText(a.reviewers)
                          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
                              title={a.reviewers.submitted > a.reviewers.assigned
                                ? `${a.reviewers.submitted} reviews submitted · ${a.reviewers.assigned} reviewer(s) currently assigned`
                                : undefined}>{reviewersText(a.reviewers)}</span>
                          : <span style={{ color: "var(--ink-dim)" }}>—</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <RecoCell reco={a.reco} splitSingle
                          reviewCount={typeof a.review_count === "number" ? a.review_count : undefined}
                          onSelect={(v) => { setRecoFilter(recoFilter === v ? null : v); setOffset(0); }} />
                      </td>
                      <td>
                        <StageCell stage={rowStage(a, { selectedKeys })} />
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
            stage={rowStage(openRow, { selectedKeys })}
            onReview={openReview}
            onClose={() => setOpenRow(null)}
            onDecided={() => { setOpenRow(null); setRefreshNonce((n) => n + 1); }}
          />
        )}
      </main>
    </div>
  );
}
