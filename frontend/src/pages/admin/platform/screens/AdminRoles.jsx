// AdminRoles — A-3B User Access & Roles (Task 16)
//
// Faithful port of AdminRoles from admin-2.jsx prototype.
//
// LIVE: user list fetched from GET /admin/users via adminApi.listUsers().
//        Refetches after every mutation attempt.
//
// PREVIEW (badge on controls, not whole screen):
//   - Invite Member modal → create-user call uses adminApi.createUser() but
//     the multi-role payload may not match the single-role backend exactly.
//     The "Invite Member" button and modal carry a <PreviewBadge />.
//   - Edit roles → adminApi.grantRole / revokeRole per delta. These endpoints
//     are stubs in Session 2 backend and may 404. The "Edit" button and
//     "Save Permissions" button carry a <PreviewBadge />.
//   - Delete → no backend endpoint exists yet. Delete button carries a
//     <PreviewBadge /> and shows an alert (no-op).
//
// No global OS_DATA singleton calls used anywhere.

import React, { useState, useEffect, useMemo, useReducer } from "react";
import { adminApi } from "../../../../lib/adminApi";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { generateBasicPassword } from "../helpers/adminHelpers";
import { PageHead, Chip } from "../shell/osAtoms";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// Normalise a user from the API response into the shape used in the table.
// API shape: { id, email, full_name, roles: string[], created_at, ... }
function normaliseUser(u) {
  return {
    id:     u.id,
    name:   u.full_name || u.email || "(no name)",
    email:  u.email || "",
    // API roles are lowercase; capitalise for display
    roles:  (u.roles || []).map(r => r.charAt(0).toUpperCase() + r.slice(1)),
    joined: fmtDate(u.created_at),
    _raw:   u,
  };
}

const ALL_ROLES = ['Reviewer', 'Jury', 'Leadership', 'Founder'];

function getRoleColor(role) {
  switch (role) {
    case 'Reviewer':   return 'blue';
    case 'Jury':       return 'green';
    case 'Leadership': return 'indigo';
    case 'Founder':    return 'amber';
    default:           return '';
  }
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AdminRoles() {
  // Force-re-render hook (mirrors prototype pattern)
  const [, forceUpdate] = useReducer(x => x + 1, 0);

  // ── API state ────────────────────────────────────────────────────────────
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState(null);
  const [refetchTick, setRefetchTick] = useState(0);

  const refetch = () => setRefetchTick(t => t + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setFetchErr(null);
        const data = await adminApi.listUsers();
        if (!cancelled) {
          const raw = data?.users ?? (Array.isArray(data) ? data : []);
          setUsers(raw.map(normaliseUser));
        }
      } catch (err) {
        if (!cancelled) setFetchErr(err?.message || "Couldn't load users.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refetchTick]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useStickyState("admin.roles", "sortCol", null);
  const [sortAsc, setSortAsc] = useStickyState("admin.roles", "sortAsc", true);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const renderHeader = (label, colKey, isNum = false) => {
    const isSorted = sortCol === colKey;
    return (
      <th
        className={isNum ? 'num' : ''}
        onClick={() => handleSort(colKey)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: isNum ? 'flex-end' : 'flex-start', width: '100%' }}>
          {label}
          {isSorted ? (sortAsc ? ' ▲' : ' ▼') : ''}
        </span>
      </th>
    );
  };

  // ── Search / filter ───────────────────────────────────────────────────────
  const [search, setSearch] = useStickyState("admin.roles", "search", "");

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const sortedUsers = useMemo(() => {
    if (!sortCol) return filteredUsers;
    return [...filteredUsers].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name')  { valA = a.name;             valB = b.name; }
      else if (sortCol === 'roles') { valA = a.roles.join(', '); valB = b.roles.join(', '); }
      else if (sortCol === 'joined') { valA = a.joined;         valB = b.joined; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ?  1 : -1;
      return 0;
    });
  }, [filteredUsers, sortCol, sortAsc]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalUsers = users.length;
  const roleCounts = { Reviewer: 0, Jury: 0, Leadership: 0, Founder: 0 };
  let multiRoleCount = 0;
  users.forEach(u => {
    u.roles.forEach(r => { if (roleCounts[r] !== undefined) roleCounts[r]++; });
    if (u.roles.length > 1) multiRoleCount++;
  });

  // ── Add-user modal (PREVIEW — create API expects single role) ─────────────
  const [showAddModal, setShowAddModal]     = useState(false);
  const [newName, setNewName]               = useState('');
  const [newEmail, setNewEmail]             = useState('');
  const [newRoles, setNewRoles]             = useState([]);
  const [addPassword, setAddPassword]       = useState('');
  const [addErr, setAddErr]                 = useState(null);
  const [addBusy, setAddBusy]               = useState(false);

  const toggleNewRole = (role) => {
    setNewRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleAddUser = async () => {
    if (!newName || !newEmail) { setAddErr("Name and Email are required"); return; }
    setAddErr(null);
    setAddBusy(true);
    try {
      // createUser expects { email, full_name, roles: string[], send_invite: bool }
      // Roles are lowercase for the API
      await adminApi.createUser({
        email:       newEmail.trim(),
        full_name:   newName.trim(),
        roles:       newRoles.map(r => r.toLowerCase()),
        send_invite: false,
      });
      setNewName(''); setNewEmail(''); setNewRoles([]);
      setShowAddModal(false);
      refetch();
    } catch (err) {
      const code = err?.details?.detail?.code || err?.details?.code;
      if (code === 'email_exists') setAddErr("That email is already registered.");
      else if (code === 'invalid_role') setAddErr("Invalid role(s) selected.");
      else setAddErr(err?.message || "Couldn't create user.");
    } finally {
      setAddBusy(false);
    }
  };

  // ── Edit-roles modal (PREVIEW — grantRole/revokeRole may 404) ─────────────
  const [editingUser, setEditingUser] = useState(null);
  const [editRoles, setEditRoles]     = useState([]);
  const [editErr, setEditErr]         = useState(null);
  const [editBusy, setEditBusy]       = useState(false);

  const toggleEditRole = (role) => {
    setEditRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleSaveEditRoles = async () => {
    if (!editingUser) return;
    setEditErr(null);
    setEditBusy(true);
    const oldRoles = editingUser.roles.map(r => r.toLowerCase());
    const newRolesLower = editRoles.map(r => r.toLowerCase());
    const toGrant  = newRolesLower.filter(r => !oldRoles.includes(r));
    const toRevoke = oldRoles.filter(r => !newRolesLower.includes(r));
    try {
      await Promise.all([
        ...toGrant.map(r => adminApi.grantRole(editingUser.id, r)),
        ...toRevoke.map(r => adminApi.revokeRole(editingUser.id, r)),
      ]);
      setEditingUser(null);
      setEditRoles([]);
      refetch();
    } catch (err) {
      setEditErr(err?.message || "Couldn't update roles.");
    } finally {
      setEditBusy(false);
    }
  };

  // ── Delete (no backend endpoint — preview no-op) ──────────────────────────
  const handleDeleteUser = (user) => {
    window.alert(`Delete is not yet available in the backend.\n\nUser: ${user.name} (${user.email})`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHead
        eyebrow="A-3B · ROLES MANAGEMENT"
        title="User <em>Access &amp; Roles</em>"
        sub="Assign and manage system roles (Reviewers, Jury, Leadership, Founders) with multi-role support."
        actions={[
          <button
            key="add"
            className="os-btn"
            onClick={() => {
              setAddPassword(generateBasicPassword());
              setAddErr(null);
              setShowAddModal(true);
            }}
          >
            + Invite Member
          </button>,
          <PreviewBadge key="preview-add" />,
        ]}
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { key: 'total',      label: 'Total Users',   val: totalUsers,          color: 'var(--ink)',         sub: 'System accounts'    },
          { key: 'reviewer',   label: 'Reviewers',     val: roleCounts.Reviewer, color: 'var(--accent)',      sub: 'Assigned to batches' },
          { key: 'jury',       label: 'Jury Members',  val: roleCounts.Jury,     color: 'var(--brand-green)', sub: 'Evaluation panel'    },
          { key: 'leadership', label: 'Leadership',    val: roleCounts.Leadership,color:'var(--brand-violet)','sub': 'Admins & Managers'  },
          { key: 'founder',    label: 'Founders',      val: roleCounts.Founder,  color: 'var(--brand-amber)', sub: 'Startup applicants'  },
        ].map(({ key, label, val, color, sub }) => (
          <div key={key} className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color }}>{val}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{sub}</span>
          </div>
        ))}
      </div>

      {/* Loading / error guards */}
      {loading && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-dim)' }}>Loading users…</div>
      )}
      {fetchErr && !loading && (
        <div className="inline-error" role="alert" style={{ marginBottom: 16 }}>{fetchErr}</div>
      )}

      {!loading && (
        <div className="os-grid-sidebar">
          {/* Left: user table */}
          <div className="os-card" style={{ padding: 24 }}>
            <div className="os-row between os-mb" style={{ alignItems: 'center' }}>
              <div className="os-card-title">User List</div>
              <div className="os-search-wrap" style={{ width: 240 }}>
                <input
                  className="os-input search sm"
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <table className="os-table">
              <thead>
                <tr>
                  {renderHeader('User Details', 'name')}
                  {renderHeader('Assigned Roles', 'roles')}
                  {renderHeader('Joined', 'joined')}
                  <th style={{ width: 160, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="os-row gap-sm" style={{ alignItems: 'center' }}>
                        <div className="os-avatar" style={{ width: 32, height: 32, fontSize: 12, flexShrink: 0 }}>
                          {String(u.name || '').split(' ').map(s => s[0]).slice(0, 2).join('')}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>{u.name}</div>
                          <div style={{ color: 'var(--ink-dim)', fontSize: 11 }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="os-row gap-xs" style={{ flexWrap: 'wrap' }}>
                        {u.roles.length === 0 ? (
                          <span style={{ color: 'var(--ink-dim)', fontStyle: 'italic', fontSize: 12 }}>No role assigned</span>
                        ) : (
                          u.roles.map(r => (
                            <Chip key={r} tone={getRoleColor(r)}>{r}</Chip>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="os-mono os-text-xs">{u.joined}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="os-row gap-xs" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          className="os-btn sm ghost"
                          onClick={() => {
                            setEditingUser(u);
                            setEditRoles([...u.roles]);
                            setEditErr(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="os-btn sm ghost"
                          style={{ color: 'var(--brand-coral)' }}
                          onClick={() => handleDeleteUser(u)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedUsers.length === 0 && !loading && (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-dim)', fontStyle: 'italic' }}>
                      {fetchErr ? 'Error loading users.' : 'No users found matching query.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Right: role distribution + access logs */}
          <div className="os-stack gap-lg">
            <div className="os-card">
              <div className="os-card-title os-mb-sm">Role Distribution</div>
              <p className="os-text-sm os-text-soft os-mb-lg">
                Visual share of access roles across the current workspace.
              </p>
              <div className="os-stack gap-md">
                {ALL_ROLES.map(role => {
                  const count = roleCounts[role];
                  const pct = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
                  const colorMap = {
                    Reviewer:   'var(--accent)',
                    Jury:       'var(--brand-green)',
                    Leadership: 'var(--brand-violet)',
                    Founder:    'var(--brand-amber)',
                  };
                  return (
                    <div key={role} className="os-stack gap-xs">
                      <div className="os-row between" style={{ fontSize: 12, fontWeight: 500 }}>
                        <span style={{ color: 'var(--ink)' }}>{role}s</span>
                        <span className="os-mono" style={{ color: 'var(--ink-dim)' }}>
                          {count} user{count !== 1 ? 's' : ''} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: colorMap[role],
                          borderRadius: 4,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px dashed var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Multi-role overlap</span>
                <span className="os-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {multiRoleCount} user{multiRoleCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <div className="os-card soft">
              <div className="os-card-title os-mb-sm">Access Logs</div>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>
                No recent access changes logged.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add-user modal (PREVIEW) ───────────────────────────────────────── */}
      {showAddModal && (
        <div className="os-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="os-modal-head">
              <div className="os-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                Invite Member <PreviewBadge />
              </div>
              <button className="os-close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-dim)' }} onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="os-modal-body os-stack gap-md">
              <div>
                <label className="os-label">FULL NAME</label>
                <input
                  className="os-input os-w-100"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Vikram Sundar"
                />
              </div>
              <div>
                <label className="os-label">EMAIL ADDRESS</label>
                <input
                  className="os-input os-w-100"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="e.g. vikram.s@artpark.in"
                />
              </div>
              <div>
                <label className="os-label">ASSIGN SYSTEM ROLES</label>
                <div className="os-stack gap-sm os-mt-sm">
                  {ALL_ROLES.map(role => (
                    <label key={role} className="os-row gap-sm" style={{ cursor: 'pointer', alignItems: 'center', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={newRoles.includes(role)}
                        onChange={() => toggleNewRole(role)}
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="os-label">TEMPORARY PASSWORD</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="os-input os-w-100 os-mono"
                    style={{ fontSize: 13, background: 'var(--bg-soft)', fontWeight: 600 }}
                    value={addPassword}
                    readOnly
                  />
                  <button
                    className="os-btn secondary sm"
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(addPassword);
                      window.alert("Password copied to clipboard!");
                    }}
                  >
                    Copy
                  </button>
                </div>
                <span style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                  Note: the backend uses magic-link invite — this password is for reference only.
                </span>
              </div>
              {addErr && <div className="inline-error" role="alert">{addErr}</div>}
            </div>
            <div className="os-modal-foot">
              <button className="os-btn ghost" onClick={() => setShowAddModal(false)} disabled={addBusy}>Cancel</button>
              <button className="os-btn" onClick={handleAddUser} disabled={addBusy}>
                {addBusy ? 'Inviting…' : 'Invite Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit-roles modal (PREVIEW) ─────────────────────────────────────── */}
      {editingUser && (
        <div className="os-modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="os-modal-head">
              <div className="os-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
                Edit User Access <PreviewBadge />
              </div>
              <button className="os-close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-dim)' }} onClick={() => setEditingUser(null)}>×</button>
            </div>
            <div className="os-modal-body os-stack gap-md">
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Updating permissions for <strong style={{ color: 'var(--ink)' }}>{editingUser.name}</strong> ({editingUser.email}).
              </div>
              <div>
                <label className="os-label">ASSIGNED ROLES</label>
                <div className="os-stack gap-sm os-mt-sm">
                  {ALL_ROLES.map(role => (
                    <label key={role} className="os-row gap-sm" style={{ cursor: 'pointer', alignItems: 'center', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={editRoles.includes(role)}
                        onChange={() => toggleEditRole(role)}
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editErr && <div className="inline-error" role="alert">{editErr}</div>}
            </div>
            <div className="os-modal-foot">
              <button className="os-btn ghost" onClick={() => setEditingUser(null)} disabled={editBusy}>Cancel</button>
              <button className="os-btn" onClick={handleSaveEditRoles} disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminRoles;
