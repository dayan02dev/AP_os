// Placeholder for /admin/dashboard until Session 5 ships the real
// Leadership Dashboard. Currently used as the post-signin landing page
// for users with the `leadership` or `admin` role.
//
// Session 5 will replace this route target with
// frontend/src/pages/leadership/LeadershipDashboard.jsx (or similar)
// — do not extend this file with real UI work.

import { useAuth } from "../../hooks/useAuth.jsx";

export default function AdminDashboardStub() {
  const { user, logout } = useAuth();
  return (
    <div style={{ padding: 40, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>Admin shell — placeholder</h1>
      <p>
        Signed in as <strong>{user?.email}</strong>
      </p>
      <p>
        Roles: <code>{(user?.roles || []).join(", ") || "(none granted)"}</code>
      </p>
      <p style={{ color: "#888" }}>
        <em>
          The Leadership Dashboard ships in Session 5. This page exists so the
          vertical-slice smoke test (admin signs in → lands somewhere
          role-appropriate → creates a reviewer) is exercisable end-to-end.
        </em>
      </p>
      <p>
        <a href="/admin/users/new">+ Add user</a>
        {" · "}
        <button type="button" onClick={logout}>Sign out</button>
      </p>
    </div>
  );
}
