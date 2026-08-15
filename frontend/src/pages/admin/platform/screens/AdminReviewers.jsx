// AdminReviewers — A-5 Reviewer Roster
//
// Faithful port of prototype AdminReviewers from admin-2.jsx (reviewer-mode
// only — jury now has its own AdminJury v2 screen).
//
//   • Roster table rows ← useAdminData("reviewers") → data.reviewers
//   • Sortable columns: name, domain, progress, consistency, weight, lastActivity
//   • Per-row "Manage" drawer: edit weight, domains, batch assignments
//     → patchReviewer(id, { weight, domains }) on save, then reload()
//   • Invite reviewer modal → adminApi.createUser({ email, full_name, roles, send_invite })
//     Shows temp_password / invite_url on success

import React, { useState, useMemo } from "react";

import { useAdminData } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { adminApi } from "../../../../lib/adminApi";
import { PageHead } from "../shell/osAtoms";
import { ManageApplicationsDrawer } from "./ManageApplicationsDrawer";
import { RemoveMemberDialog, removalSummary } from "./RemoveMemberDialog";

// Guaranteed policy-compliant temp password: >=10 chars with upper, lower,
// digit, and symbol (mirrors the backend `_password_ok`). The legacy
// generateBasicPassword() doesn't guarantee a digit, so we use this.
export function genStrongPassword() {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "!@#$%*-+";
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  let core = "";
  const all = U + L + D + S;
  for (let i = 0; i < 6; i++) core += pick(all);
  // Ensure one of each class + length >= 10 ("Rv-" prefix + 4 guaranteed + 6 core = 13)
  return `Rv-${pick(U)}${pick(L)}${pick(D)}${pick(S)}${core}`;
}
export function pwValid(pw) {
  return pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// Render a reviewer's last-activity value: ISO timestamps → absolute IST
// date + time ("29 Jun 2026, 10:39 AM"); non-ISO strings (the jury mock's
// "2h ago") pass through; empty → an em dash.
export function formatLastActivity(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
  // en-GB yields "29 Jun 2026, 10:39 am" → uppercase the meridiem.
  return s.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

// ─── Rebalance banner ────────────────────────────────────────────────────────

// (Rebalance banner removed — the Rebalance batches action was retired.)

// ─── Manage / Edit drawer ────────────────────────────────────────────────────
// Weight + domains + inline batch chip editor (reviewer-mode only).

function ManageDrawer({ reviewer, allBatches, onClose, onSaved, onRequestDelete }) {
  const [name, setName] = useState(reviewer.name || '');
  const [email, setEmail] = useState(reviewer.email || '');
  const [weight, setWeight] = useState(typeof reviewer.weight === 'number' ? reviewer.weight : 1.0);
  const [domains, setDomains] = useState(
    Array.isArray(reviewer.domains) ? reviewer.domains.join(', ') : (reviewer.domain || '')
  );
  const [batches, setBatches] = useState(
    Array.isArray(reviewer.batches)
      ? reviewer.batches.map(b => (typeof b === 'string' ? b : b.name))
      : (reviewer.batch && reviewer.batch !== 'Unassigned' ? [reviewer.batch] : [])
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const domainsArr = domains.split(',').map(d => d.trim()).filter(Boolean);
      const body = {
        weight: Math.min(10, Math.max(0, parseFloat(weight) || 0)),
        domains: domainsArr,
      };
      // Identity fields only sent when changed (an email change also re-syncs
      // the auth login on the backend).
      if (name.trim() && name.trim() !== (reviewer.name || '')) body.full_name = name.trim();
      if (email.trim() && email.trim() !== (reviewer.email || '')) body.email = email.trim();
      await adminPlatformApi.patchReviewer(reviewer.id, body);
      onSaved();
    } catch (e) {
      setErr(e?.message || 'Save failed');
      setSaving(false);
    }
  };

  const removeBatch = (b) => setBatches(prev => prev.filter(x => x !== b));
  const addBatch = (b) => { if (b && !batches.includes(b)) setBatches(prev => [...prev, b]); };

  return (
    <div
      className="os-drawer-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(36,36,36,0.4)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end', animation: 'osDrawerFadeIn 0.2s ease-out' }}
    >
      <div
        className="os-drawer"
        onClick={e => e.stopPropagation()}
        style={{ width: 680, maxWidth: '90vw', height: '100%', background: 'var(--bg-paper)', borderLeft: '1px solid var(--line-strong)', boxShadow: '-10px 0 40px rgba(36,36,36,0.15)', display: 'flex', flexDirection: 'column', animation: 'osDrawerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        <div className="os-drawer-head" style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="os-drawer-title" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Edit reviewer details</div>
            <div className="os-drawer-subtitle" style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
              Reviewer: <strong>{reviewer.name}</strong> &middot; {reviewer.org || reviewer.domain}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 18 }}>&times;</button>
        </div>

        <div className="os-drawer-body" style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Identity — name + email */}
          <div>
            <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Full Name</label>
            <input
              type="text"
              className="os-input"
              style={{ width: '100%', fontSize: 14 }}
              placeholder="e.g. Rohan Sakpal"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Email Address</label>
            <input
              type="email"
              className="os-input"
              style={{ width: '100%', fontSize: 14 }}
              placeholder="name@artpark.in"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 4 }}>Changing the email also updates this reviewer's login.</div>
          </div>

          {/* Weight */}
          <div>
            <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Weight</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              className="os-input"
              style={{ width: '100%', fontSize: 14 }}
              value={weight}
              onChange={e => setWeight(e.target.value)}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 4 }}>Multiplier applied to this reviewer's scores. Default is 1.0.</div>
          </div>

          {/* Domains */}
          <div>
            <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Domains (comma-separated)</label>
            <input
              type="text"
              className="os-input"
              style={{ width: '100%', fontSize: 14 }}
              placeholder="e.g. Robotics, AI, CleanTech"
              value={domains}
              onChange={e => setDomains(e.target.value)}
            />
          </div>

          {/* Assigned batches */}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Assigned Batches:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {batches.length > 0 ? batches.map(b => (
                <span key={b} className="os-chip" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', fontWeight: 600, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {b}
                  <span
                    style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 11, color: '#FF5A5F', marginLeft: 2 }}
                    onClick={() => removeBatch(b)}
                  >
                    &times;
                  </span>
                </span>
              )) : <span className="os-text-soft" style={{ fontSize: 13 }}>None</span>}
              <select
                className="os-select sm"
                style={{ padding: '0 4px', fontSize: 11, height: 26, width: 40, minWidth: 40 }}
                value=""
                onChange={e => { if (e.target.value) addBatch(e.target.value); }}
              >
                <option value="" disabled>+</option>
                {allBatches.filter(b => !batches.includes(b)).map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>

          {err && (
            <div style={{ color: 'var(--bad)', fontSize: 13, fontWeight: 600, padding: '8px 12px', background: 'var(--bad-soft)', borderRadius: 4 }}>
              {err}
            </div>
          )}
        </div>

        <div className="os-drawer-foot" style={{ padding: '16px 24px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--bg-soft)' }}>
          <button
            className="os-btn ghost"
            style={{ color: '#d23b40', borderColor: '#f3c2c4' }}
            onClick={() => onRequestDelete && onRequestDelete(reviewer)}
            disabled={saving}
          >
            Delete reviewer
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={saving}>Close</button>
            <button
              className="os-btn"
              style={{ background: 'var(--accent)', color: '#fff' }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Invite modal ────────────────────────────────────────────────────────────

function InviteModal({ batchOptions = [], onClose, onInvited }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [invDomain, setInvDomain] = useState('');
  const [invBatch, setInvBatch] = useState('');
  const [password, setPassword] = useState(() => genStrongPassword());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const handleInvite = async () => {
    if (!name.trim() || !email.trim()) { setErr('Name and email are required.'); return; }
    if (!pwValid(password)) {
      setErr('Password must be at least 10 characters and include an uppercase letter, a lowercase letter, a digit, and a symbol.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await adminApi.createUser({
        email: email.trim(),
        full_name: name.trim(),
        roles: ['reviewer'],
        send_invite: true,
        temp_password: password,
        expertise_domains: invDomain.split(',').map(s => s.trim()).filter(Boolean),
        batch_id: invBatch || null,
      });
      setResult(res);
      onInvited();
    } catch (e) {
      setErr(e?.code === 'weak_password'
        ? 'Password must be at least 10 characters and include an uppercase letter, a lowercase letter, a digit, and a symbol.'
        : (e?.message || 'Invite failed.'));
      setSaving(false);
    }
  };

  return (
    <div
      className="os-modal-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(36,36,36,0.5)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="os-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 440, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 4, boxShadow: '0 20px 60px rgba(36,36,36,0.18)' }}
      >
        <div className="os-modal-head" style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Invite Member</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 18 }}>&times;</button>
        </div>

        <div className="os-modal-body os-stack gap-md" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result ? (
            <div>
              <div style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
                Reviewer invited successfully.
              </div>
              {result.temp_password && (
                <div style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 14px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: 'var(--ink)' }}>
                  Temp password: <strong>{result.temp_password}</strong>
                </div>
              )}
              {result.invite_url && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-soft)', wordBreak: 'break-all' }}>
                  Invite URL: {result.invite_url}
                </div>
              )}
              {result.existing_user && (
                <div className="os-text-xs os-text-dim" style={{ marginTop: 8 }}>This email already had an account — it's now a reviewer (other portal access removed).</div>
              )}
              <button className="os-btn" style={{ marginTop: 20, width: '100%' }} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Full Name</label>
                <input type="text" className="os-input os-w-100" placeholder="e.g. Vikram Sundar" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Email Address</label>
                <input type="email" className="os-input os-w-100" placeholder="name@example.in" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Expertise / Domains</label>
                <input type="text" className="os-input os-w-100" placeholder="e.g. Robotics, AI, CleanTech" value={invDomain} onChange={e => setInvDomain(e.target.value)} />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Initial Batch Assignment</label>
                <select className="os-select os-w-100" value={invBatch} onChange={e => setInvBatch(e.target.value)}>
                  <option value="">None (Unassigned)</option>
                  {batchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Temporary Password</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="os-input os-w-100 os-mono"
                    style={{ fontSize: 13, fontWeight: 600 }}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                  <button
                    className="os-btn secondary sm"
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(password); }}
                  >
                    Copy
                  </button>
                  <button
                    className="os-btn ghost sm"
                    type="button"
                    onClick={() => setPassword(genStrongPassword())}
                  >
                    Regenerate
                  </button>
                </div>
                <div className="os-text-xs os-text-dim" style={{ marginTop: 4 }}>Min 10 chars with an uppercase, lowercase, digit, and symbol.</div>
              </div>

              {err && (
                <div style={{ color: 'var(--bad)', fontSize: 13, fontWeight: 600, padding: '8px 12px', background: 'var(--bad-soft)', borderRadius: 4 }}>
                  {err}
                </div>
              )}

              <div className="os-modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 4 }}>
                <button className="os-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button
                  className="os-btn"
                  style={{ background: '#3213b7', color: '#fff' }}
                  onClick={handleInvite}
                  disabled={saving}
                >
                  {saving ? 'Inviting…' : 'Send Invite'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit-reviewer picker ─────────────────────────────────────────────────────
// Sits beside "Invite member": pick a reviewer, then open the edit drawer.

function EditPicker({ reviewers, onPick, onClose }) {
  const [sel, setSel] = useState(reviewers[0]?.id || '');
  return (
    <div
      className="os-modal-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(36,36,36,0.5)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="os-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 420, width: '90vw', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 4, boxShadow: '0 20px 60px rgba(36,36,36,0.18)' }}
      >
        <div className="os-modal-head" style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Edit reviewer</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 18 }}>&times;</button>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {reviewers.length === 0 ? (
            <div className="os-text-soft" style={{ fontSize: 13 }}>No reviewers to edit yet.</div>
          ) : (
            <>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Select reviewer</label>
                <select className="os-select os-w-100" style={{ width: '100%' }} value={sel} onChange={e => setSel(e.target.value)}>
                  {reviewers.map(r => (
                    <option key={r.id} value={r.id}>{r.name || r.email || r.id}</option>
                  ))}
                </select>
              </div>
              <div className="os-modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 4 }}>
                <button className="os-btn secondary" onClick={onClose}>Cancel</button>
                <button
                  className="os-btn"
                  style={{ background: '#3213b7', color: '#fff' }}
                  onClick={() => { const r = reviewers.find(x => x.id === sel); if (r) onPick(r); }}
                >
                  Edit details
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AdminReviewers() {
  const { data, loading, error, reload } = useAdminData('reviewers');
  const liveReviewers = data?.reviewers ?? [];

  // Batches list — needed to map batch NAME (from the roster) → batch ID,
  // which the assign/unassign endpoints require.
  const { data: batchesData } = useAdminData('batches');
  const batchList = batchesData?.batches ?? [];
  const batchNameToId = useMemo(() => {
    const m = new Map();
    for (const b of batchList) m.set(b.name, b.id);
    return m;
  }, [batchList]);

  // Transient error for assign/unassign calls.
  const [assignErr, setAssignErr] = useState(null);

  const handleAssignBatch = async (reviewerId, batchName) => {
    const batchId = batchNameToId.get(batchName);
    if (!batchId) { setAssignErr(`Unknown batch "${batchName}".`); return; }
    setAssignErr(null);
    try {
      await adminPlatformApi.assignBatchReviewers(batchId, { reviewer_user_ids: [reviewerId] });
      reload();
    } catch (e) {
      setAssignErr(e?.message || 'Assignment failed.');
    }
  };

  const handleUnassignBatch = async (reviewerId, batchName) => {
    const batchId = batchNameToId.get(batchName);
    if (!batchId) { setAssignErr(`Unknown batch "${batchName}".`); return; }
    setAssignErr(null);
    try {
      await adminPlatformApi.unassignBatchReviewer(batchId, reviewerId);
      reload();
    } catch (e) {
      setAssignErr(e?.message || 'Unassign failed.');
    }
  };

  const R = liveReviewers;

  // Sorting
  const [sortCol, setSortCol] = useStickyState("admin.reviewers", "sortCol", null);
  const [sortAsc, setSortAsc] = useStickyState("admin.reviewers", "sortAsc", true);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
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

  const sortedReviewers = useMemo(() => {
    if (!sortCol) return R;
    return [...R].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') { valA = a.name || ''; valB = b.name || ''; }
      else if (sortCol === 'domain') { valA = a.domain || ''; valB = b.domain || ''; }
      else if (sortCol === 'progress') {
        const parseProg = (p) => { if (!p) return 0; const [num, den] = String(p).split('/').map(x => parseInt(x.trim()) || 0); return den > 0 ? num / den : 0; };
        valA = parseProg(a.progress); valB = parseProg(b.progress);
      }
      else if (sortCol === 'consistency') { valA = a.consistency || 0; valB = b.consistency || 0; }
      else if (sortCol === 'weight') { valA = a.weight || 1.0; valB = b.weight || 1.0; }
      else if (sortCol === 'lastActivity') { valA = a.last || ''; valB = b.last || ''; }
      else { valA = ''; valB = ''; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [R, sortCol, sortAsc]);

  // Batches (for drawer / invite selector). Prefer the real batches list;
  // fall back to names referenced by reviewers. A reviewer's `batches` is now
  // [{ name, count }] from the roster endpoint, so map to names.
  const allBatches = useMemo(() => {
    const fromBatchList = batchList.map(b => b.name);
    const fromReviewers = liveReviewers.flatMap(r =>
      Array.isArray(r.batches)
        ? r.batches.map(b => (typeof b === 'string' ? b : b.name))
        : (r.batch && r.batch !== 'Unassigned' ? [r.batch] : [])
    );
    return Array.from(new Set([...fromBatchList, ...fromReviewers].filter(Boolean))).sort();
  }, [batchList, liveReviewers]);

  // Mutation state — reviewer mode
  const [manageTarget, setManageTarget] = useState(null);
  const [appsTarget, setAppsTarget] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showEditPicker, setShowEditPicker] = useState(false);
  // Delete flow: the drawers ask for it, RemoveMemberDialog confirms it.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [removedNote, setRemovedNote] = useState(null);

  const confirmDelete = async () => {
    const res = await adminPlatformApi.deleteReviewer(deleteTarget.id);
    setRemovedNote(removalSummary('reviewer', deleteTarget.name || deleteTarget.email, res));
    setDeleteTarget(null);
    setManageTarget(null);
    setAppsTarget(null);
    reload();
  };

  // Drawer animation styles (injected once)
  const drawerStyles = `
    @keyframes osDrawerFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes osDrawerSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  `;

  // ── Reviewer mode (live) ──────────────────────────────────────────────────
  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: drawerStyles }} />

      <PageHead
        eyebrow="A-5 · REVIEWERS"
        title="Reviewer <em>roster</em>"
        sub="Assignments, progress."
        actions={[
          <button key="inv" className="os-btn ghost" onClick={() => setShowInvite(true)}>Invite member</button>,
          <button key="edit" className="os-btn ghost" onClick={() => setShowEditPicker(true)}>Edit reviewer</button>,
        ]}
      />
      {removedNote && (
        <div style={{ color: '#1d6b45', fontSize: 13, fontWeight: 600, padding: '8px 12px', background: '#e9f6ef', border: '1px solid #b7ddc8', borderRadius: 4, marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{removedNote}</span>
          <button className="os-btn sm ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setRemovedNote(null)}>Dismiss</button>
        </div>
      )}
      {assignErr && (
        <div style={{ color: 'var(--bad)', fontSize: 13, fontWeight: 600, padding: '8px 12px', background: 'var(--bad-soft)', borderRadius: 4, marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{assignErr}</span>
          <button className="os-btn sm ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setAssignErr(null)}>Dismiss</button>
        </div>
      )}

      {loading && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-soft)' }}>Loading reviewers…</div>
      )}
      {!loading && error && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--bad)' }}>
          {error?.message || 'Failed to load reviewers.'}
          <button className="os-btn sm ghost" style={{ marginLeft: 12 }} onClick={reload}>Retry</button>
        </div>
      )}
      {!loading && !error && liveReviewers.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-soft)', border: '1px dashed var(--line)', borderRadius: 4, marginTop: 16 }}>
          No reviewers yet. Invite one to get started.
        </div>
      )}

      {!loading && !error && liveReviewers.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="os-table">
            <thead>
              <tr>
                {renderHeader('Reviewer', 'name')}
                {renderHeader('Domain', 'domain')}
                <th>Applications Assigned</th>
                {renderHeader('Progress', 'progress')}
                {renderHeader('Weight / Primary', 'weight')}
                {renderHeader('Last activity', 'lastActivity')}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedReviewers.map(r => {
                // Roster batches are [{ name, count }]; tolerate legacy string arrays / single batch.
                const rBatches = Array.isArray(r.batches)
                  ? r.batches.map(b => (typeof b === 'string' ? { name: b, count: null } : { name: b.name, count: b.count }))
                  : (r.batch && r.batch !== 'Unassigned' ? [{ name: r.batch, count: null }] : []);
                const assignedNames = rBatches.map(b => b.name);
                const availableBatches = allBatches.filter(b => !assignedNames.includes(b));
                const progressStr = r.progress || '0 / 0';
                const pParts = progressStr.split('/');
                const pNum = parseInt(pParts[0]) || 0;
                const pDen = parseInt(pParts[1]) || 1;
                const pct = Math.min(100, Math.max(0, (pNum / pDen) * 100));
                return (
                  <tr key={r.id}>
                    {/* Reviewer */}
                    <td>
                      <div className="startup">
                        {r.name || '—'}
                      </div>
                    </td>

                    {/* Domain */}
                    <td className="os-text-soft">{r.domain || '—'}</td>

                    {/* Applications Assigned */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                          {rBatches.length > 0
                            ? rBatches.map(b => (b.count != null ? `${b.count} of ${b.name}` : b.name)).join(', ')
                            : 'No assignments'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          {rBatches.map(b => (
                            <span key={b.name} className="os-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', fontSize: 11 }}>
                              {b.name}
                              {/* "Unbatched" is a computed bucket (apps in no batch), not a real
                                  batch — there's nothing to unassign from, so no × control. */}
                              {b.name !== 'Unbatched' && (
                                <span
                                  role="button"
                                  aria-label={`Remove ${b.name} from ${r.name}`}
                                  title={`Remove ${b.name}`}
                                  style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 11, color: '#FF5A5F', marginLeft: 2 }}
                                  onClick={() => handleUnassignBatch(r.id, b.name)}
                                >
                                  &times;
                                </span>
                              )}
                            </span>
                          ))}
                          {availableBatches.length > 0 ? (
                            <select
                              className="os-select sm"
                              aria-label={`Assign a batch to ${r.name}`}
                              style={{ padding: '0 4px', fontSize: 11, height: 24, width: 48, minWidth: 48 }}
                              value=""
                              onChange={e => { if (e.target.value) handleAssignBatch(r.id, e.target.value); }}
                            >
                              <option value="" disabled>+ ▾</option>
                              {availableBatches.map(b => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </select>
                          ) : (
                            batchList.length === 0 && (
                              <span className="os-text-soft" style={{ fontSize: 11 }}>No batches — create one in Applications</span>
                            )
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Progress */}
                    <td>
                      <div className="os-row gap-sm">
                        <div className="os-scorebar-track" style={{ width: 90 }}>
                          <div className="os-scorebar-fill" style={{ width: pct + '%', background: 'var(--ink)' }} />
                        </div>
                        <span className="os-mono os-text-sm">{progressStr}</span>
                      </div>
                    </td>

                    {/* Weight */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {typeof r.weight === 'number' ? r.weight.toFixed(1) : '1.0'}
                        </span>
                        {r.weight > 1.0 && (
                          <span className="os-chip purple" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 700 }}>PRIMARY</span>
                        )}
                      </div>
                    </td>

                    {/* Last activity */}
                    <td className="os-mono os-text-sm os-text-soft">{formatLastActivity(r.last)}</td>

                    {/* Actions */}
                    <td>
                      <button className="os-btn sm secondary" onClick={() => setAppsTarget(r)}>Manage</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manage drawer */}
      {manageTarget && (
        <ManageDrawer
          reviewer={manageTarget}
          allBatches={allBatches}
          onClose={() => setManageTarget(null)}
          onSaved={() => { setManageTarget(null); reload(); }}
          onRequestDelete={setDeleteTarget}
        />
      )}

      {/* Manage Applications drawer (per-reviewer assign/remove) */}
      {appsTarget && (
        <ManageApplicationsDrawer
          reviewer={appsTarget}
          onClose={() => setAppsTarget(null)}
          onChanged={reload}
          onRequestDelete={setDeleteTarget}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <RemoveMemberDialog
          kind="reviewer"
          member={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          batchOptions={batchList}
          onClose={() => setShowInvite(false)}
          onInvited={() => { setShowInvite(false); reload(); }}
        />
      )}

      {/* Edit-reviewer picker → opens the edit drawer for the chosen reviewer */}
      {showEditPicker && (
        <EditPicker
          reviewers={liveReviewers}
          onPick={(r) => { setShowEditPicker(false); setManageTarget(r); }}
          onClose={() => setShowEditPicker(false)}
        />
      )}
    </div>
  );
}

export default AdminReviewers;
