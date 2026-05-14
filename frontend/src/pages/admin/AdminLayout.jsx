// AdminLayout — React Router layout component for all /admin/* routes.
//
// Structure:
//   .admin-shell
//     aside.admin-sidebar   — brand + nav links
//     main.admin-main
//       ProfileShell        — top bar (user name, role switcher, sign out)
//       .admin-content
//         <Outlet />        — child page renders here
//
// Auth: reads from useAuth(). Shows "Loading…" while loading; renders nothing
// if user is null after loading (ProtectedRoute in Task 4 handles the redirect).

import { Outlet, NavLink } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import ProfileShell from "../../components/ProfileShell.jsx";
import "../../styles/admin.css";

export default function AdminLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="admin-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <span className="eir-dim eir-mono" style={{ fontSize: 13, letterSpacing: "0.1em" }}>
          Loading…
        </span>
      </div>
    );
  }

  // If user is null after loading, render nothing — ProtectedRoute (Task 4)
  // owns the auth-redirect logic. No duplicate redirect here.
  if (!user) return null;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">ARTPARK / OS</div>
        <nav>
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/users/new">+ Add user</NavLink>
          {/* Leadership nav link — Session 5 owns that surface. */}
        </nav>
      </aside>

      <main className="admin-main">
        <ProfileShell />
        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
