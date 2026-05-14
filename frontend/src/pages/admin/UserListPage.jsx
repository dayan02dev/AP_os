// UserListPage — renders inside AdminLayout's <Outlet />.
//
// Fetches GET /admin/users via adminApi.listUsers({ search, role }).
// 250ms debounced search input, role <select> filter, clickable rows
// navigating to /admin/users/:id, and a "+ Add user" button going to
// /admin/users/new. Loading, empty, and error states all surfaced.
// No pagination, no sortable columns — deferred to later tasks.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";

const ROLE_OPTIONS = [
  { value: "", label: "All roles" },
  { value: "applicant", label: "applicant" },
  { value: "founder", label: "founder" },
  { value: "reviewer", label: "reviewer" },
  { value: "mentor", label: "mentor" },
  { value: "leadership", label: "leadership" },
  { value: "admin", label: "admin" },
];

export default function UserListPage() {
  const navigate = useNavigate();

  // Raw search string — we debounce before firing the API call
  const [searchInput, setSearchInput] = useState("");
  // Debounced search committed to the query
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Debounce: commit searchInput → search after 250ms idle
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch whenever committed search or roleFilter changes
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const data = await adminApi.listUsers(params);
      setUsers(data.users ?? []);
      setTotal(data.total ?? null);
    } catch (err) {
      setError(err?.message || "Failed to load users.");
      setUsers([]);
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Derived: are any filters active?
  const filtersActive = search !== "" || roleFilter !== "";

  // Count label
  const countLabel = (() => {
    if (total === null) return null;
    if (!filtersActive) return `${total} user${total !== 1 ? "s" : ""}`;
    return `${users.length} of ${total} user${total !== 1 ? "s" : ""}`;
  })();

  return (
    <div className="user-list-page">
      {/* ── Page header ── */}
      <div className="user-list-header">
        <div className="user-list-header-left">
          <span className="eir-mono user-list-kicker">admin · users</span>
          <h1 className="user-list-title">Users</h1>
        </div>
        <button
          type="button"
          className="eir-chip-btn eir-mono user-list-add-btn"
          onClick={() => navigate("/admin/users/new")}
        >
          + Add user
        </button>
      </div>

      {/* ── Filters row ── */}
      <div className="user-list-filters">
        <input
          className="user-list-search eir-mono"
          type="text"
          placeholder="search name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search users"
        />
        <select
          className="user-list-role-select eir-mono"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {countLabel && (
          <span className="eir-mono eir-dim user-list-count">{countLabel}</span>
        )}
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="user-list-error" role="alert">
          <span className="eir-mono">Error:</span> {error}
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && !error && (
        <div className="user-list-loading eir-mono eir-dim">Loading users…</div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && users.length === 0 && (
        <div className="user-list-empty eir-mono eir-dim">
          No users match these filters.
        </div>
      )}

      {/* ── Table ── */}
      {!loading && !error && users.length > 0 && (
        <div className="user-list-table-wrap">
          <div className="user-list-table" role="table" aria-label="Users">
            {/* Header row */}
            <div className="user-list-tr user-list-tr-head" role="row">
              <div className="user-list-th eir-mono" role="columnheader">Name</div>
              <div className="user-list-th eir-mono" role="columnheader">Email</div>
              <div className="user-list-th eir-mono" role="columnheader">Roles</div>
              <div className="user-list-th eir-mono" role="columnheader">Joined</div>
            </div>

            {/* Data rows */}
            {users.map((user) => (
              <button
                type="button"
                key={user.id}
                className="user-list-tr user-list-tr-row"
                role="row"
                onClick={() => navigate(`/admin/users/${user.id}`)}
                aria-label={`View ${user.full_name || user.email}`}
              >
                <div className="user-list-td user-list-td-name" role="cell">
                  <span className="user-list-name">
                    {user.full_name || <span className="eir-dim">—</span>}
                  </span>
                  {user.location_city && (
                    <span className="eir-mono eir-dim user-list-location">
                      {user.location_city}
                    </span>
                  )}
                </div>
                <div className="user-list-td user-list-td-email eir-mono" role="cell">
                  {user.email}
                </div>
                <div className="user-list-td user-list-td-roles" role="cell">
                  {(user.roles ?? []).length > 0 ? (
                    <span className="user-list-chips">
                      {user.roles.map((role) => (
                        <span key={role} className="user-list-role-chip eir-mono">
                          {role}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="eir-dim eir-mono">—</span>
                  )}
                </div>
                <div className="user-list-td user-list-td-joined eir-mono eir-dim" role="cell">
                  {user.created_at?.slice(0, 10) ?? "—"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
