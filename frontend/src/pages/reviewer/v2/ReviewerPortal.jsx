// Reviewer Portal v2 — shell. Ported from REVIEWER-UI/os/reviewer.jsx
// (ReviewerApp + ReviewerTopbar + ReviewerCohortHeader + ReviewerTabBar).
//
// `tab` prop selects the active surface: "dashboard" | "queue" | "eval" |
// "history". Navigation is route-based (deep-linkable); the eval screen reads
// :track/:appId from the URL. The portal stylesheet is imported once here.

import { useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import "../../../styles/reviewer-portal.css";

import { useAuth } from "../../../hooks/useAuth.jsx";
import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import { COHORT_LABEL, initialsOf } from "./ui.jsx";

import ReviewerDashboard from "./ReviewerDashboard.jsx";
import ReviewerQueue from "./ReviewerQueue.jsx";
import ReviewerEval from "./ReviewerEval.jsx";
import ReviewerHistory from "./ReviewerHistory.jsx";

// ── Topbar (LP-style) ──────────────────────────────────────────────────
function ReviewerTopbar({ tab }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const crumb =
    tab === "dashboard" ? "DASHBOARD"
    : tab === "queue" ? "MY QUEUE"
    : tab === "eval" ? "ACTIVE APPLICATION"
    : tab === "history" ? "MY HISTORY"
    : "MY QUEUE";

  const initials = initialsOf(user?.full_name, user?.email);
  const email = user?.email || "reviewer@artpark.in";

  const [roleMenu, setRoleMenu] = useState(false);
  const roles = user?.roles || [];
  const ROLES = [
    { key: "reviewer", label: "Reviewer", to: "/reviewer" },
    { key: "leadership", label: "Leadership", to: "/leadership" },
  ].filter((r) => r.key === "reviewer" || roles.includes(r.key));

  const switchRole = (r) => {
    setRoleMenu(false);
    if (r.key === "reviewer") return;
    navigate(r.to);
  };

  const signOut = async () => {
    await logout();
    navigate("/apply/signin");
  };

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={() => navigate("/reviewer")}>← HOME</button>

      <div className="lp-brand">
        <img
          src="/assets/artpark-iisc-logo.webp"
          alt="ARTPARK · AI & Robotics Technology Park at IISc"
          className="lp-brand-combined"
        />
      </div>

      <div className="lp-topbar-crumb">
        <div className="lp-topbar-pill">
          <span className="lp-live-dot" />
          <span>REVIEWER · {crumb}</span>
        </div>
      </div>

      <div className="lp-topbar-right">
        <div className="lp-topbar-user-wrap">
          <button
            className="lp-topbar-user"
            onClick={() => setRoleMenu((m) => !m)}
            aria-haspopup="menu"
            aria-expanded={roleMenu}
          >
            <div
              className="os-avatar"
              style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0, background: "#3213b7", color: "#fff" }}
            >
              {initials}
            </div>
            <span>{email}</span>
            <span className="caret">▾</span>
          </button>
          {roleMenu && ROLES.length > 1 && (
            <>
              <div className="lp-menu-backdrop" onClick={() => setRoleMenu(false)} />
              <div className="lp-role-menu" role="menu">
                <div className="lp-role-menu-head">Switch role</div>
                {ROLES.map((r) => (
                  <button
                    key={r.key}
                    role="menuitem"
                    className={"lp-role-item" + (r.key === "reviewer" ? " is-active" : "")}
                    onClick={() => switchRole(r)}
                  >
                    <span className="lp-role-dot" />
                    <span>{r.label}</span>
                    {r.key === "reviewer" && <span className="lp-role-check">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button className="lp-signout" onClick={signOut}>SIGN OUT ↗</button>
      </div>
    </div>
  );
}

// ── CSV export (reads the live queue) ──────────────────────────────────
async function exportReviewerQueueCsv() {
  const STATUS_LABEL = {
    submitted: "Submitted",
    "in-progress": "In Progress",
    draft: "Draft",
    "not-started": "Not Started",
  };
  const cell = (v) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const queue = await reviewerApi.getQueue();
  const headers = ["ID", "Project", "Founders", "Industry", "Stage", "Track", "AI Score", "Status", "Due"];
  const rows = queue.map((s) => [
    s.applicationId,
    s.name,
    (s.founders || []).join("; "),
    s.industry,
    s.stage,
    s.track === "tir" ? "TIR" : "VIP",
    s.ai && s.ai.overall != null ? Number(s.ai.overall).toFixed(1) : "",
    STATUS_LABEL[s.reviewStatus] || "",
    s.due || "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "reviewer-queue-TIR-VIP-2026.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Cohort page header ─────────────────────────────────────────────────
function ReviewerCohortHeader() {
  const [exporting, setExporting] = useState(false);
  // Human-readable snapshot timestamp, rendered at page load (IST). Matches the
  // prototype's "live snapshot · 28 May 2026 · 15:04 IST" format.
  const snapshotAt = useMemo(
    () =>
      new Date().toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
      }).replace(",", " ·") + " IST",
    [],
  );
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportReviewerQueueCsv();
    } catch (err) {
      alert("Export failed — please try again.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{ marginBottom: 8 }}>ARTPARK / OS · Reviewer Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">
            {COHORT_LABEL.replace(/ 2026$/, "")} <span className="lp-year">2026</span>
          </h1>
          <div className="lp-cohort-sub">
            applications closed 22 May 2026 · live snapshot · {snapshotAt}
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          <button className="os-btn ghost" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV ↓"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab bar (badge reflects the live queue length) ─────────────────────
// queueCount is passed down from the shell's single getQueue fetch so the
// badge does not trigger a second identical request per page view.
function ReviewerTabBar({ tab, queueCount }) {
  const navigate = useNavigate();
  return (
    <div className="lp-tabs">
      <div className={`lp-tab${tab === "dashboard" ? " active" : ""}`} onClick={() => navigate("/reviewer")}>
        <div className="lp-tab-label">Dashboard</div>
        <div className="lp-tab-sub">OVERVIEW · CHARTS · FUNNEL</div>
      </div>
      <div className={`lp-tab${tab === "queue" ? " active" : ""}`} onClick={() => navigate("/reviewer/queue")}>
        <div className="lp-tab-label">
          My Queue
          {queueCount != null && <span className="lp-tab-badge">{queueCount}</span>}
        </div>
        <div className="lp-tab-sub">ASSIGNED STARTUPS</div>
      </div>
      <div className={`lp-tab${tab === "history" ? " active" : ""}`} onClick={() => navigate("/reviewer/history")}>
        <div className="lp-tab-label">My History</div>
        <div className="lp-tab-sub">PAST REVIEWS</div>
      </div>
    </div>
  );
}

export default function ReviewerPortal({ tab = "dashboard" }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  // Dashboard → My Queue pre-filter (industry) passed via navigation state.
  const initialDomain = location.state?.domain || "all";

  const openEval = (track, appId) => navigate(`/reviewer/eval/${track}/${appId}`);
  const pickIndustry = (domain) => navigate("/reviewer/queue", { state: { domain } });

  // Single getQueue fetch per page view, lifted into the shell. Only the
  // dashboard and queue surfaces (and the tab badge) need it — the eval and
  // history tabs read their own data — so we skip the request entirely on
  // those tabs. The async result is passed down to both children so neither
  // refetches the queue itself.
  const needsQueue = tab === "dashboard" || tab === "queue";
  const queueAsync = useAsync(
    () => (needsQueue ? reviewerApi.getQueue() : Promise.resolve(null)),
    [needsQueue],
  );
  const queueCount = queueAsync.data ? queueAsync.data.length : null;

  return (
    <div className="rv-portal os-shell">
      <ReviewerTopbar tab={tab} />
      <div className="lp-layout">
        {tab !== "eval" && <ReviewerCohortHeader />}
        {tab !== "eval" && <ReviewerTabBar tab={tab} queueCount={queueCount} />}

        {tab === "dashboard" && (
          <ReviewerDashboard onPickIndustry={pickIndustry} queueAsync={queueAsync} />
        )}
        {tab === "queue" && (
          <ReviewerQueue onOpen={openEval} initialDomain={initialDomain} queueAsync={queueAsync} />
        )}
        {tab === "eval" && (
          <div className="lp-tab-content lp-tab-content--full">
            <ReviewerEval
              track={params.track}
              appId={params.appId}
              onBack={() => navigate("/reviewer/queue")}
              onOpen={openEval}
            />
          </div>
        )}
        {tab === "history" && (
          <div className="lp-tab-content">
            <ReviewerHistory onOpenEval={openEval} />
          </div>
        )}
      </div>
    </div>
  );
}
