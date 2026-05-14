// ProfileShell — top bar rendered inside AdminLayout.
//
// Reads user + logout from useAuth() directly (no props needed).
// Renders nothing if user is not yet loaded.

import { useAuth } from "../hooks/useAuth.jsx";
import RoleSwitcher from "./RoleSwitcher.jsx";

export default function ProfileShell() {
  const { user, logout } = useAuth();

  // Defensive: render nothing until user is resolved.
  if (!user) return null;

  const displayName = user.full_name || user.email || "—";

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-left">
        <span className="admin-topbar-kicker eir-mono">ARTPARK / OS</span>
        <div className="admin-topbar-identity">
          <span className="admin-topbar-name">{displayName}</span>
          {user.full_name && (
            <span className="admin-topbar-email eir-dim">{user.email}</span>
          )}
        </div>
      </div>

      <div className="admin-topbar-right">
        <RoleSwitcher />
        <button
          type="button"
          className="admin-signout-btn"
          onClick={logout}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
