import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { reviewerApiV2 } from "../../lib/reviewerApiV2.js";
import { useAsync } from "./components/useAsync.js";
import "./styles/reviewer-v2.css";

// The prototype's ReviewerTopbar — ported to ES module, wired to real auth
function ReviewerTopbar({ tab }) {
  const crumb =
    tab === "dashboard" ? "DASHBOARD"
    : tab === "queue"   ? "MY QUEUE"
    : tab === "eval"    ? "ACTIVE APPLICATION"
    : tab === "history" ? "MY HISTORY"
    : "MY QUEUE";

  const { data: me } = useAsync(() => reviewerApiV2.getMe(), []);
  const { user, logout } = useAuth();

  // Prefer real auth identity, fall back to mock while backend isn't wired
  const initials = user
    ? (user.full_name || user.email || "·").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()
    : (me && me.initials) || "·";
  const email = user?.email || (me && me.email) || "reviewer@artpark.in";

  const ROLES = [
    { key: "reviewer",   label: "Reviewer" },
    { key: "leadership", label: "Leadership" },
  ];
  const ACTIVE_ROLE = "reviewer";
  const [roleMenu, setRoleMenu] = useState(false);
  const navigate = useNavigate();

  const switchRole = (r) => {
    setRoleMenu(false);
    if (r.key === ACTIVE_ROLE) return;
    navigate("/leadership");
  };
  const goHome  = () => navigate("/");
  const signOut = () => { logout(); };

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={goHome}>← HOME</button>

      <div className="lp-brand">
        <img
          className="lp-brand-combined"
          src="/assets/artpark-iisc-combined.webp"
          alt="ARTPARK · AI & Robotics Technology Park @ IISc"
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
          {roleMenu && (
            <>
              <div className="lp-menu-backdrop" onClick={() => setRoleMenu(false)} />
              <div className="lp-role-menu" role="menu">
                <div className="lp-role-menu-head">Switch role</div>
                {ROLES.map((r) => (
                  <button
                    key={r.key}
                    role="menuitem"
                    className={"lp-role-item" + (r.key === ACTIVE_ROLE ? " is-active" : "")}
                    onClick={() => switchRole(r)}
                  >
                    <span className="lp-role-dot" />
                    <span>{r.label}</span>
                    {r.key === ACTIVE_ROLE && <span className="lp-role-check">✓</span>}
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

// Cohort page header (export CSV button)
function ReviewerCohortHeader({ onExportCsv }) {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{ marginBottom: 8 }}>
        ARTPARK / OS · Reviewer Portal
      </div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">
            TIR + VIP cohort <span className="lp-year">2026</span>
          </h1>
          <div className="lp-cohort-sub">
            applications closed 22 May 2026 · live snapshot · 28 May 2026 · 15:04 IST
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          <button className="os-btn ghost" onClick={onExportCsv}>
            Export CSV ↓
          </button>
        </div>
      </div>
    </div>
  );
}

// Tab bar — driven by the tab state passed from the parent shell
function ReviewerTabBar({ tab, setTab }) {
  const { data: queue } = useAsync(() => reviewerApiV2.getQueue(), []);
  const queueCount = queue ? queue.length : null;
  return (
    <div className="lp-tabs">
      {[
        { id: "dashboard", label: "Dashboard", sub: "OVERVIEW · CHARTS · FUNNEL", badge: null },
        { id: "queue",     label: "My Queue",  sub: "ASSIGNED STARTUPS",          badge: queueCount },
        { id: "history",   label: "My History",sub: "PAST REVIEWS",               badge: null },
      ].map((t) => (
        <div
          key={t.id}
          className={`lp-tab${tab === t.id ? " active" : ""}`}
          onClick={() => setTab(t.id)}
        >
          <div className="lp-tab-label">
            {t.label}
            {t.badge != null && <span className="lp-tab-badge">{t.badge}</span>}
          </div>
          <div className="lp-tab-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// CSV export helper (client-side, same as prototype)
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
  const queue = await reviewerApiV2.getQueue();
  const headers = ["ID", "Project", "Founders", "Industry", "Stage", "Track", "AI Score", "Status", "Due"];
  const rows = queue.map((s) => [
    s.applicationId,
    s.name,
    (s.founders || []).join("; "),
    s.industry,
    s.stage,
    s.track === "tir" ? "TIR" : "VIP",
    s.ai && s.ai.overall != null ? s.ai.overall.toFixed(1) : "",
    STATUS_LABEL[s.reviewStatus] || "",
    s.due,
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

// Derive the active tab from the current URL path.
function useActiveTab() {
  const { pathname } = useLocation();
  if (pathname.includes("/eval/")) return "eval";
  if (pathname.includes("/history"))  return "history";
  return "queue"; // inbox and dashboard both live under /inbox
}

// The shell renders the topbar, then <Outlet /> for the child page.
// Child pages (InboxPage, HistoryPage) render their own cohort header and tab bar
// because they manage tab state internally (Dashboard vs Queue live in InboxPage).
export default function ReviewerV2AppShell() {
  const activeTab = useActiveTab();
  return (
    <div className="reviewer-v2-shell os-shell">
      <ReviewerTopbar tab={activeTab} />
      <div className="lp-layout" style={{ flex: 1 }}>
        <Outlet />
      </div>
    </div>
  );
}

// Named exports used by child pages
export { ReviewerTopbar, ReviewerCohortHeader, ReviewerTabBar, exportReviewerQueueCsv };
