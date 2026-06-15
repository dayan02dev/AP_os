// Admin Platform Portal — shell. Mirrors reviewer/v2/ReviewerPortal.jsx.
//
// `tab` selects the active surface: "dashboard" | "pipeline" | "reviewers" |
// "gate1" | "batches" | "audit" | "analytics" | "settings". Navigation is
// route-based (deep-linkable). The portal stylesheet is imported once here and
// the whole subtree is wrapped in `.adm-portal` so the ported prototype CSS
// (scoped under that root) never leaks into other surfaces.
//
// For T14 every tab renders a placeholder stub; the real screens land in
// T15–T20. Jury / Psychometry / Gate-2 are intentionally omitted.

import { useNavigate } from "react-router-dom";

import "../../../styles/admin-portal.css";

import { useAuth } from "../../../hooks/useAuth.jsx";
import { initialsOf } from "./ui.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import AdminPipeline from "./AdminPipeline.jsx";

const TABS = [
  { key: "dashboard", label: "Dashboard", to: "/admin" },
  { key: "pipeline", label: "Pipeline", to: "/admin/pipeline" },
  { key: "reviewers", label: "Reviewers", to: "/admin/reviewers" },
  { key: "gate1", label: "Gate 1", to: "/admin/gate1" },
  { key: "batches", label: "Batches", to: "/admin/batches" },
  { key: "audit", label: "Audit", to: "/admin/audit" },
  { key: "analytics", label: "Analytics", to: "/admin/analytics" },
  { key: "settings", label: "Settings", to: "/admin/settings" },
];

const CRUMB = {
  dashboard: "DASHBOARD",
  pipeline: "PIPELINE",
  reviewers: "REVIEWERS",
  gate1: "GATE 1",
  batches: "BATCHES",
  audit: "AUDIT LOG",
  analytics: "ANALYTICS",
  settings: "SETTINGS",
};

const STUB_TEXT = {
  reviewers: "Reviewers — coming in T17",
  gate1: "Gate 1 — coming in T18",
  batches: "Batches — coming in T19",
  audit: "Audit — coming in T20",
  analytics: "Analytics — coming in T20",
  settings: "Settings — coming in T20",
};

function AdminTopbar({ tab }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const initials = initialsOf(user?.full_name, user?.email);
  const email = user?.email || "admin@artpark.in";

  const signOut = async () => {
    await logout();
    navigate("/apply/signin");
  };

  return (
    <div className="adm-topbar">
      <button className="adm-home-btn" onClick={() => navigate("/admin")}>← HOME</button>

      <div className="adm-brand">
        <img
          src="/assets/artpark-iisc-logo.webp"
          alt="ARTPARK · AI & Robotics Technology Park at IISc"
          className="adm-brand-logo"
        />
      </div>

      <span className="adm-portal-tag">
        <span className="adm-live-dot" />
        ADMIN PORTAL · {CRUMB[tab] || "DASHBOARD"}
      </span>

      <div className="adm-topbar-spacer" />

      <div className="adm-user-chip" aria-label="Signed in user">
        <span
          className="os-avatar"
          style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}
        >
          {initials}
        </span>
        <span>{email}</span>
      </div>
      <button className="adm-signout" onClick={signOut}>SIGN OUT ↗</button>
    </div>
  );
}

function AdminTabBar({ tab }) {
  const navigate = useNavigate();
  return (
    <div className="adm-tabbar" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          className={"adm-tab" + (tab === t.key ? " active" : "")}
          onClick={() => navigate(t.to)}
        >
          {t.label}
        </button>
      ))}
      {/* Link out to the existing user-management surface (kept separate). */}
      <button
        className="adm-tab adm-tab-link"
        onClick={() => navigate("/admin/users")}
      >
        Users ↗
      </button>
    </div>
  );
}

function TabStub({ tab }) {
  return (
    <div className="adm-stub">
      <h2>{STUB_TEXT[tab] || "Coming soon"}</h2>
      <p>
        This surface is a placeholder. The live screen lands in a later task; the
        portal shell, navigation, API seam, and scoped styles are in place.
      </p>
    </div>
  );
}

export default function AdminPortal({ tab = "dashboard" }) {
  return (
    <div className="adm-portal os-shell">
      <AdminTopbar tab={tab} />
      <div className="adm-layout">
        <AdminTabBar tab={tab} />
        {tab === "dashboard" ? (
          <AdminDashboard />
        ) : tab === "pipeline" ? (
          <AdminPipeline />
        ) : (
          <TabStub tab={tab} />
        )}
      </div>
    </div>
  );
}
