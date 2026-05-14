// UserListPage — renders inside AdminLayout's <Outlet />.
//
// Visual contract: ARTPARK design system §5.2 page-head, §5.4 filter-bar,
// §5.3 .tbl, §5.11 toast. No icons, no emoji, no badges. Sharp corners.
//
// Fetches GET /admin/users via adminApi.listUsers. 250ms debounced search.
// Role chips replace the previous <select>. Click row → /admin/users/:id.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api.js";

const ROLE_CHIPS = [
  { value: "",           label: "All" },
  { value: "admin",      label: "Admin" },
  { value: "leadership", label: "Leadership" },
  { value: "reviewer",   label: "Reviewer" },
  { value: "mentor",     label: "Mentor" },
  { value: "founder",    label: "Founder" },
];

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

function primaryRole(roles) {
  // Display priority — show the most "load-bearing" role.
  if (!roles?.length) return null;
  const order = ["admin", "leadership", "reviewer", "mentor", "founder", "applicant"];
  for (const r of order) {
    if (roles.includes(r)) return r;
  }
  return roles[0];
}

function RoleCell({ roles }) {
  const primary = primaryRole(roles);
  if (!primary) return <span style={{ color: "var(--ink-dim)" }}>—</span>;
  const extra = (roles?.length || 0) - 1;
  return (
    <span>
      <span style={{ textTransform: "capitalize" }}>{primary}</span>
      {extra > 0 && (
        <span style={{ color: "var(--ink-dim)", marginLeft: 6 }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export default function UserListPage() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (roleFilter) params.set("role", roleFilter);
        const qs = params.toString();
        const data = await api.get(`/admin/users${qs ? `?${qs}` : ""}`, { signal: ctrl.signal });
        if (!cancelled) {
          setUsers(data.users ?? []);
          setTotal(data.total ?? null);
        }
      } catch (err) {
        if (cancelled) return;
        let msg;
        if (err?.status === 403) msg = "You don't have permission to view users.";
        else if (err?.status === 401) msg = "Your session expired. Please sign in again.";
        else msg = err?.message || "Couldn't load users.";
        setError(msg);
        setUsers([]);
        setTotal(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [search, roleFilter]);

  const filtersActive = search !== "" || roleFilter !== "";
  const countLabel = (() => {
    if (total === null) return null;
    if (!filtersActive) return `${total} user${total !== 1 ? "s" : ""}`;
    return `${users.length} of ${total}`;
  })();

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setRoleFilter("");
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">User management</span>
          <h1>Users.</h1>
          <p className="page-sub">
            Search, filter by role, and drill into any user's profile.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/admin/users/new")}
          >
            Invite user <span className="arrow">→</span>
          </button>
        </div>
      </header>

      <div className="filter-bar">
        <input
          className="field filter-search"
          type="search"
          placeholder="Search by name or email"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search users"
        />
        <div className="filter-chips" role="group" aria-label="Filter by role">
          {ROLE_CHIPS.map((opt) => (
            <button
              key={opt.value || "all"}
              type="button"
              className={`chip${roleFilter === opt.value ? " active" : ""}`}
              onClick={() => setRoleFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="filter-spacer" />
        {countLabel && <span className="filter-count">{countLabel}</span>}
      </div>

      {error && <div className="inline-error" role="alert">{error}</div>}

      {loading && !error && <div className="inline-loading">Loading users…</div>}

      {!loading && !error && users.length === 0 && (
        <div className="card card-soft tbl-empty">
          <span className="eyebrow">No matches</span>
          <h3>No users match those filters.</h3>
          <p>
            {filtersActive
              ? "Clear the filters or invite someone new."
              : "Invite the first user to get started."}
          </p>
          {filtersActive ? (
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/admin/users/new")}
            >
              Invite user <span className="arrow">→</span>
            </button>
          )}
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th aria-label="Actions" style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="clickable"
                  onClick={() => navigate(`/admin/users/${u.id}`)}
                >
                  <td className="primary">
                    {u.full_name || <span style={{ color: "var(--ink-dim)" }}>No name</span>}
                    <span className="sub">{u.email}</span>
                  </td>
                  <td><RoleCell roles={u.roles} /></td>
                  <td>
                    <span className="status-cell">
                      <span className="dot green" />
                      Active
                    </span>
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="row-menu"
                      aria-label="Row actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/users/${u.id}`);
                      }}
                    >
                      ⋯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
