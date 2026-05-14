// UserDetailPage — renders inside AdminLayout's <Outlet />.
//
// Fetches GET /admin/users/{id} via adminApi.getUser(userId).
// Displays a read-only profile section, a UserRolesPanel, and a
// UserSecurityPanel side by side. Roles + security actions trigger a
// refetch so the page stays in sync without a full reload.

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";
import UserRolesPanel from "./UserRolesPanel.jsx";
import UserSecurityPanel from "./UserSecurityPanel.jsx";

function fmt(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr.slice(0, 10);
  }
}

function ProfileField({ label, value }) {
  return (
    <div className="user-detail-field">
      <span className="user-detail-field-label eir-mono eir-dim">{label}</span>
      <span className="user-detail-field-value">
        {value || <span className="eir-dim">—</span>}
      </span>
    </div>
  );
}

export default function UserDetailPage() {
  const { id: userId } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchUser = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await adminApi.getUser(userId);
      setUser(data);
    } catch (err) {
      if (err?.status === 404) {
        setNotFound(true);
      } else if (err?.status === 403) {
        setError("You don't have permission to view this user.");
      } else if (err?.status === 401) {
        setError("Your session expired. Please sign in again.");
      } else {
        setError(err?.message || "Couldn't load user.");
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="user-detail-page">
        <div className="user-detail-loading eir-mono eir-dim">Loading user…</div>
      </div>
    );
  }

  // ── Not found ──
  if (notFound) {
    return (
      <div className="user-detail-page">
        <button
          type="button"
          className="user-detail-back eir-mono"
          onClick={() => navigate("/admin/users")}
        >
          ← back to users
        </button>
        <div className="user-detail-not-found eir-mono">
          User not found.
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="user-detail-page">
        <button
          type="button"
          className="user-detail-back eir-mono"
          onClick={() => navigate("/admin/users")}
        >
          ← back to users
        </button>
        <div className="user-detail-error" role="alert">
          <span className="eir-mono">Error:</span> {error}
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="user-detail-page">
      {/* ── Back link ── */}
      <button
        type="button"
        className="user-detail-back eir-mono"
        onClick={() => navigate("/admin/users")}
      >
        ← back to users
      </button>

      {/* ── Page header ── */}
      <div className="user-detail-header">
        <div className="user-detail-header-left">
          <span className="eir-mono user-detail-kicker">admin · users · detail</span>
          <h1 className="user-detail-title">
            {user.full_name || <span className="eir-dim">No name</span>}
          </h1>
          <span className="user-detail-email eir-mono eir-dim">{user.email}</span>
        </div>
        {user.active_role && (
          <span className="user-detail-role-chip eir-mono">{user.active_role}</span>
        )}
      </div>

      {/* ── Three-panel layout ── */}
      <div className="user-detail-panels">
        {/* Panel 1: Profile fields (read-only) */}
        <section className="user-detail-profile-panel">
          <div className="user-detail-panel-heading eir-mono">Profile</div>
          <div className="user-detail-fields">
            <ProfileField label="Full name"    value={user.full_name} />
            <ProfileField label="Email"        value={user.email} />
            <ProfileField label="Phone"        value={user.phone} />
            <ProfileField label="City"         value={user.location_city} />
            <ProfileField label="Joined"       value={fmt(user.created_at)} />
            <ProfileField
              label="Last sign-in"
              value={user.last_sign_in_at ? fmt(user.last_sign_in_at) : null}
            />
            {user.applications_count !== undefined && (
              <ProfileField
                label="Applications"
                value={String(user.applications_count)}
              />
            )}
          </div>
        </section>

        {/* Panel 2: Roles */}
        <UserRolesPanel
          userId={user.id}
          roles={user.roles ?? []}
          onRolesChanged={fetchUser}
        />

        {/* Panel 3: Security */}
        <UserSecurityPanel
          userId={user.id}
          email={user.email}
          onDeactivated={() => navigate("/admin/users")}
        />
      </div>
    </div>
  );
}
