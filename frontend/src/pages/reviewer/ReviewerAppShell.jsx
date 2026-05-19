// ReviewerAppShell — top bars + left rail (.app-shell pattern from
// design system §5.1). Used by /reviewer/inbox and /reviewer/completed.
// The /reviewer/:track/:id/score page exits this shell — see
// ReviewerScoringPage.

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import "../../styles/reviewer.css";

function initials(emailOrName) {
  if (!emailOrName) return "·";
  const t = String(emailOrName).trim();
  if (t.includes(" ")) {
    const parts = t.split(/\s+/);
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export default function ReviewerAppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const display = user?.full_name || user?.email || "Reviewer";
  const multiRole = (user?.roles || []).length > 1;

  return (
    <div className="app-shell">
      <div className="app-betabar">
        <span className="pill">BETA</span>
        <span>ARTPARK Programs · Staging</span>
      </div>

      <header className="app-header">
        <div className="logos">
          <img className="iisc" src="/iisc-logo.png" alt="IISc" />
          <span className="rule" aria-hidden="true" />
          <img className="artpark" src="/artpark-logo.png" alt="ARTPARK" />
        </div>
        <span className="role-tag">Reviewer</span>
        <span className="spacer" />
        {multiRole && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate("/role-switch")}
          >
            Switch role <span className="arrow">→</span>
          </button>
        )}
        <span className="user-chip" title={display}>
          <span className="avatar">{initials(display)}</span>
          {display}
          <button
            type="button"
            onClick={logout}
            className="btn btn-ghost"
            style={{ marginLeft: 12 }}
          >
            Sign out
          </button>
        </span>
      </header>

      <div className="app-body" style={{ display: "grid", gridTemplateColumns: "240px 1fr" }}>
        <nav className="app-rail" aria-label="Reviewer navigation">
          <div className="rail-section">Reviews</div>
          <NavLink to="/reviewer/inbox" className={({ isActive }) =>
            `rail-link${isActive ? " active" : ""}`}>
            Inbox
          </NavLink>
          <NavLink to="/reviewer/completed" className={({ isActive }) =>
            `rail-link${isActive ? " active" : ""}`}>
            Completed
          </NavLink>
          <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0" }} />
          <NavLink to="/apply/support" className="rail-link">
            Support
          </NavLink>
        </nav>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
