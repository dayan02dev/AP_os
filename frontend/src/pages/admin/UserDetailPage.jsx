// UserDetailPage — /admin/users/:id
//
// Visual contract: ARTPARK design system §6.4.
// Two-col 1fr/320px. Left: .card panels for Personal + Roles. Right: .card-soft Security.
// Page head: eyebrow USER · ADMIN, h1 = name (no trailing period — proper noun),
// sub = email · role-dot · last-active.

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";
import UserRolesPanel from "./UserRolesPanel.jsx";
import UserSecurityPanel from "./UserSecurityPanel.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function rolesLabel(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return "No roles";
  const names = roles.map((r) => (typeof r === "string" ? r : r.role));
  // Capitalise + join with em-dash
  return names.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(" · ");
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
      if (err?.status === 404) setNotFound(true);
      else if (err?.status === 403) setError("You don't have permission to view this user.");
      else if (err?.status === 401) setError("Your session expired. Please sign in again.");
      else setError(err?.message || "Couldn't load user.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  if (loading) {
    return <div className="inline-loading">Loading user…</div>;
  }

  if (notFound) {
    return (
      <>
        <button
          type="button"
          className="back-link"
          onClick={() => navigate("/admin/users")}
        >
          ← Back to users
        </button>
        <div className="card card-soft tbl-empty">
          <span className="eyebrow">Not found</span>
          <h3>That user doesn't exist.</h3>
          <p>The link may be stale, or the user was deactivated and removed.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate("/admin/users")}
          >
            Back to users
          </button>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <button
          type="button"
          className="back-link"
          onClick={() => navigate("/admin/users")}
        >
          ← Back to users
        </button>
        <div className="inline-error" role="alert">{error}</div>
      </>
    );
  }

  if (!user) return null;

  const roleList = user.roles || [];
  const headSub = [
    user.email,
    rolesLabel(roleList),
    user.created_at && `Joined ${fmtDate(user.created_at)}`,
  ].filter(Boolean);

  return (
    <>
      <button
        type="button"
        className="back-link"
        onClick={() => navigate("/admin/users")}
      >
        ← Back to users
      </button>

      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">User · admin</span>
          {/* No trailing period — h1 is a proper noun (the user's name). */}
          <h1>{user.full_name || user.email}</h1>
          <div
            className="page-sub"
            style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)", alignItems: "center" }}
          >
            <span className="status-cell"><span className="dot green" /> Active</span>
            {headSub.map((bit, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--s-2)" }}>
                <span style={{ color: "var(--ink-dim)" }}>·</span>
                <span>{bit}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="two-col">
        <div className="col-main">
          <section className="card">
            <div className="section-head" style={{ marginBottom: "var(--s-3)" }}>
              <span className="eyebrow">Personal info</span>
              <h2 style={{ marginTop: "var(--s-2)" }}>Profile.</h2>
            </div>
            <dl className="def">
              <div className="def-row">
                <dt>Full name</dt>
                <dd>{user.full_name || <span style={{ color: "var(--ink-dim)" }}>Not set</span>}</dd>
                <span />
              </div>
              <div className="def-row">
                <dt>Email</dt>
                <dd style={{ wordBreak: "break-all" }}>{user.email}</dd>
                <span style={{ color: "var(--ink-dim)", fontSize: 11 }}>Immutable</span>
              </div>
              <div className="def-row">
                <dt>Phone</dt>
                <dd>{user.phone || <span style={{ color: "var(--ink-dim)" }}>Not set</span>}</dd>
                <span />
              </div>
              <div className="def-row">
                <dt>City</dt>
                <dd>{user.location_city || <span style={{ color: "var(--ink-dim)" }}>Not set</span>}</dd>
                <span />
              </div>
              <div className="def-row">
                <dt>Joined</dt>
                <dd>{fmtDate(user.created_at)}</dd>
                <span />
              </div>
              {user.applications_count !== undefined && (
                <div className="def-row">
                  <dt>Applications</dt>
                  <dd>{user.applications_count}</dd>
                  <span />
                </div>
              )}
            </dl>
          </section>

          <UserRolesPanel
            userId={user.id}
            roles={user.roles ?? []}
            onRolesChanged={fetchUser}
          />
        </div>

        <aside className="col-aside">
          <UserSecurityPanel
            userId={user.id}
            email={user.email}
            onDeactivated={() => navigate("/admin/users")}
          />
        </aside>
      </div>
    </>
  );
}
