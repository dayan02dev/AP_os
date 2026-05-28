// RoleSwitcher — inline chip group for toggling the user's active role.
//
// Rules:
//   - Returns null (renders nothing) when user has <= 1 role.
//   - For multi-role users, shows only the roles they actually have.
//   - Tries PATCH /me/active-role on click; falls back to local state on failure.
//   - refreshMe() is called on success so AuthContext updates.

import { useState } from "react";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";

// Role meta — labels + icons. Inline only, not exported.
const ROLE_META = {
  applicant:  { label: "Applicant",  icon: "✏" },
  founder:    { label: "Founder",    icon: "★" },
  reviewer:   { label: "Reviewer",   icon: "▣" },
  mentor:     { label: "Mentor",     icon: "◇" },
  leadership: { label: "Leadership", icon: "✦" },
  admin:      { label: "Admin",      icon: "⚙" },
};

export default function RoleSwitcher() {
  const { user, refreshMe } = useAuth();

  // Local mirror of active_role so the UI responds immediately even if the
  // backend endpoint doesn't exist yet (Session 5 ships /me/active-role).
  const [localActive, setLocalActive] = useState(null);

  const roles = user?.roles || [];

  // Hard requirement: hide entirely for single-role users.
  if (roles.length <= 1) return null;

  // Resolve displayed active role: prefer local state override, fallback to
  // what the server returned.
  const activeRole = localActive ?? user?.active_role ?? roles[0];

  async function handleRoleClick(newRole) {
    if (newRole === activeRole) return;

    // Optimistic local update first — UI feels instant.
    setLocalActive(newRole);

    try {
      await api.patch("/me/active-role", { active_role: newRole });
      // Success: let AuthContext refresh so the rest of the app sees the change.
      await refreshMe();
      // Clear local override — AuthContext is now the source of truth.
      setLocalActive(null);
    } catch {
      // Endpoint missing or server error — local state already applied above,
      // so the UI still reflects the change. No throw.
    }
  }

  return (
    <div className="role-switcher" role="group" aria-label="Switch active role">
      {roles.map((role) => {
        const meta = ROLE_META[role] || { label: role, icon: "○" };
        const isActive = role === activeRole;
        return (
          <button
            key={role}
            type="button"
            className={`role-switcher-chip${isActive ? " role-switcher-chip--active" : ""}`}
            onClick={() => handleRoleClick(role)}
            aria-pressed={isActive}
            title={meta.label}
          >
            <span className="role-switcher-chip-icon" aria-hidden="true">
              {meta.icon}
            </span>
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
