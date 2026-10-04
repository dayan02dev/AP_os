// Reviewer Portal v2 — shell. Ported from REVIEWER-UI/os/reviewer.jsx
// (ReviewerApp + ReviewerTopbar + ReviewerCohortHeader + ReviewerTabBar).
//
// `tab` prop selects the active surface: "dashboard" | "queue" | "eval" |
// "history". Navigation is route-based (deep-linkable); the eval screen reads
// :track/:appId from the URL. The portal stylesheet is imported once here.

import { useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import "../../../styles/reviewer-portal.css";
import "../../../styles/vip-memo.css";

import { useAuth } from "../../../hooks/useAuth.jsx";
import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import { relabelDisplayId } from "../../../lib/trackLabel.js";
import { COHORT_LABEL, initialsOf } from "./ui.jsx";
import PortalSwitcher from "../../../components/PortalSwitcher.jsx";
import AccountSettingsButton from "../../../components/AccountSettingsButton.jsx";

import ReviewerDashboard from "./ReviewerDashboard.jsx";
import ReviewerQueue from "./ReviewerQueue.jsx";
import ReviewerEval from "./ReviewerEval.jsx";
import ReviewerHistory, { decisionLabel } from "./ReviewerHistory.jsx";

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

  const signOut = async () => {
    await logout();
    navigate("/apply/signin");
  };

  return (
    <div className="lp-topbar">
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
        <div className="lp-topbar-user" style={{ cursor: "default" }}>
          <div
            className="os-avatar"
            style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0, background: "#3213b7", color: "#fff" }}
          >
            {initials}
          </div>
          <span>{email}</span>
        </div>
        <AccountSettingsButton />
        <PortalSwitcher current="reviewer" />
        <button className="lp-signout" onClick={signOut}>SIGN OUT ↗</button>
      </div>
    </div>
  );
}

// ── CSV export (queue on Dashboard/My Queue, history on My History) ─────
const trackName = (t) => (t === "tir" ? "TIR" : "VIP");
const num1 = (v) => (typeof v === "number" ? v.toFixed(1) : "");

function downloadCsv(table, filename) {
  const cell = (v) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const csv = table.map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportReviewerQueueCsv() {
  const STATUS_LABEL = { submitted: "Submitted", draft: "Draft", "not-started": "Not Started" };
  const queue = await reviewerApi.getQueue();
  const headers = ["ID", "Project", "Founders", "Industry", "Stage", "Track", "AI Score", "Status"];
  const rows = queue.map((s) => [
    relabelDisplayId(s.applicationId),
    s.name,
    (s.founders || []).join("; "),
    s.industry,
    s.stage,
    trackName(s.movedToTrack || s.track),
    s.ai && s.ai.overall != null ? Number(s.ai.overall).toFixed(1) : "",
    STATUS_LABEL[s.reviewStatus] || "",
  ]);
  downloadCsv([headers, ...rows], "reviewer-queue-TIR-VIP-2026.csv");
}

// Header + one row per submitted review (GET /reviewer/history rows).
export function historyCsvRows(rows) {
  const headers = ["Date", "ID", "Startup", "Track", "My score", "AI score",
    "Variance", "My reco", "Admin decision"];
  return [headers, ...(rows || []).map((h) => [
    (h.date || "").slice(0, 10),
    relabelDisplayId(h.applicationId),
    h.name,
    trackName(h.track),
    num1(h.myScore),
    num1(h.aiScore),
    num1(h.variance),
    (h.reco || "").toUpperCase(),
    decisionLabel(h.adminDecision),
  ])];
}

async function exportReviewerHistoryCsv() {
  const data = await reviewerApi.getHistory();
  downloadCsv(historyCsvRows(data && data.rows), "reviewer-history-TIR-VIP-2026.csv");
}
// ── Cohort page header ─────────────────────────────────────────────────
function ReviewerCohortHeader({ tab }) {
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
      await (tab === "history" ? exportReviewerHistoryCsv() : exportReviewerQueueCsv());
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
        </div>
        <div style={{ marginTop: 4 }}>
          <button className="os-btn ghost" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : tab === "history" ? "Export history CSV ↓" : "Export queue CSV ↓"}
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
  // Dashboard → My Queue pre-filter (industry, or an explicit "all") passed via
  // navigation state; undefined when the queue was opened any other way.
  const initialDomain = location.state?.domain;

  const openEval = (track, appId) => navigate(`/reviewer/eval/${track}/${appId}`);
  const pickIndustry = (domain) => navigate("/reviewer/queue", { state: { domain } });

  // Single getQueue fetch per page view, lifted into the shell. The dashboard,
  // queue and the tab badge (shown on every tab with a tab bar, History
  // included) need it; the eval screen has no tab bar and reads its own data.
  // The async result is passed down so no child refetches the queue itself.
  const needsQueue = tab !== "eval";
  const queueAsync = useAsync(
    () => (needsQueue ? reviewerApi.getQueue() : Promise.resolve(null)),
    [needsQueue],
  );
  const queueCount = queueAsync.data ? queueAsync.data.length : null;

  return (
    <div className="rv-portal os-shell">
      <ReviewerTopbar tab={tab} />
      <div className="lp-layout">
        {tab !== "eval" && <ReviewerCohortHeader tab={tab} />}
        {tab !== "eval" && <ReviewerTabBar tab={tab} queueCount={queueCount} />}

        {tab === "dashboard" && (
          <ReviewerDashboard onPickIndustry={pickIndustry} queueAsync={queueAsync} />
        )}
        {tab === "queue" && (
          <ReviewerQueue
            onOpen={openEval}
            initialDomain={initialDomain}
            navKey={location.key}
            queueAsync={queueAsync}
          />
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
