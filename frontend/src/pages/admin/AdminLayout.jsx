// AdminLayout — React Router layout for all /admin/* routes.
//
// Structure (per ARTPARK design system §5.1):
//   .app-shell
//     .app-betabar       — black strip, "STAGING" pill
//     .app-header        — IISc + ARTPARK logos · role tag · switch role · user chip
//     .app-body          — 240px rail + 1fr main
//       aside.app-rail   — User management nav + Support divider
//       main.app-main    — child page renders via <Outlet />
//
// Auth: reads from useAuth(). Renders "Loading…" while pending; renders
// nothing if user is null (ProtectedRoute owns the redirect).

import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { hasCapability } from "../../lib/rbac.js";
import "../../styles/admin.css";

function initialsFor(user) {
  const src = user?.full_name || user?.email || "";
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("") || "—";
}

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="app-shell">
        <div className="app-main" style={{ paddingTop: 96 }}>
          <span className="inline-loading">Loading…</span>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const roles = user.roles || [];
  const showSwitchToLeadership = hasCapability(roles, "view_stats");

  return (
    <div className="app-shell">
      <div className="app-betabar">
        <span>ARTPARK / OS</span>
        <span className="pill">Staging</span>
        <span style={{ opacity: 0.6 }}>Programs admin</span>
      </div>

      <header className="app-header">
        <div className="logos">
          <img src="/assets/iisc-logo.png" alt="IISc" className="iisc" />
          <span className="rule" aria-hidden="true" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="artpark" />
        </div>
        <span className="role-tag">Admin</span>
        <div className="spacer" />
        {showSwitchToLeadership && (
          <button
            type="button"
            className="switch-role"
            onClick={() => navigate("/leadership")}
            aria-label="Switch to leadership view"
          >
            Switch to leadership <span className="arrow">→</span>
          </button>
        )}
        <div className="user-chip" aria-label="Signed in user">
          <span className="avatar" aria-hidden="true">{initialsFor(user)}</span>
          <span>
            <span className="name">{user.full_name || user.email}</span>
            {user.full_name && <span className="email">{user.email}</span>}
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

      <div className="app-body">
        <aside className="app-rail" aria-label="Admin navigation">
          <div className="rail-section">User management</div>
          <NavLink to="/admin/users" end className={({ isActive }) => `rail-link${isActive ? " active" : ""}`}>
            Users
          </NavLink>
          <NavLink to="/admin/users/new" className={({ isActive }) => `rail-link${isActive ? " active" : ""}`}>
            Add user
          </NavLink>

          <div className="rail-divider" />
          <div className="rail-section">Help</div>
          <NavLink to="/apply/support" className={({ isActive }) => `rail-link${isActive ? " active" : ""}`}>
            Support
          </NavLink>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
