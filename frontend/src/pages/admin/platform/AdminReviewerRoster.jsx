// AdminReviewerRoster — A-3 Reviewer Roster (Task 19)
//
// Reviewer management surface. Fetches GET /admin/platform/reviewers and
// presents a table of reviewer stats. Supports:
//   • Edit weight + domains (inline via a small per-row drawer)
//     → PATCH /admin/platform/reviewers/{user_id}
//   • Rebalance button → POST /admin/platform/reviewers/rebalance
//     Shows returned {assigned, reviewers} counts; reloads after.
//   • Invite reviewer modal → adminApi.createUser({email, full_name, roles, send_invite})
//     Shows the temp_password/invite result on success; reloads after.
//
// Column set (matches A-3 prototype):
//   Reviewer (name + email) | Domains | Weight | Progress (C / A + bar) |
//   Consistency (% or — , colour coded) | Last activity | Batch | Actions
//
// Every field access is guarded — consistency may be null, lastActivity may
// be absent. Reload after every mutation so the table stays in sync.

import { useCallback, useState } from "react";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { adminApi } from "../../../lib/adminApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "./ui.jsx";

// ─── Helpers ────────────────────────────────────────────────────────────────

function consistencyColor(val) {
  if (val === null || val === undefined) return "";
  if (val >= 0.9) return "green";
  if (val >= 0.8) return "amber";
  return "red";
}

function parseProgress(assigned, completed) {
  const a = typeof assigned === "number" ? assigned : 0;
  const c = typeof completed === "number" ? completed : 0;
  return { assigned: a, completed: c, pct: a > 0 ? Math.min(1, c / a) : 0 };
}

// ─── Edit Drawer ─────────────────────────────────────────────────────────────
// Slides in from the right for weight + domain edits. Calls patchReviewer and
// invokes onSaved (which reloads the parent list) on success.

function EditDrawer({ reviewer, onClose, onSaved }) {
  const [weight, setWeight] = useState(
    typeof reviewer.weight === "number" ? reviewer.weight : 1.0
  );
  const [domains, setDomains] = useState(
    Array.isArray(reviewer.domains) ? reviewer.domains.join(", ") : (reviewer.domains || "")
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const domainsArr = domains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      await adminPlatformApi.patchReviewer(reviewer.user_id, {
        weight: parseFloat(weight) || 1.0,
        domains: domainsArr,
      });
      onSaved();
    } catch (e) {
      setErr(e?.message || "Save failed");
      setSaving(false);
    }
  };

  return (
    <div
      className="os-drawer-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(36,36,36,0.4)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="os-drawer"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "90vw",
          height: "100%",
          background: "var(--bg-paper)",
          borderLeft: "1px solid var(--line-strong)",
          boxShadow: "-10px 0 40px rgba(36,36,36,0.15)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Head */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>
              Edit Reviewer
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>
              {reviewer.name || reviewer.email}
            </div>
          </div>
          <button
            className="os-btn sm ghost"
            onClick={onClose}
            style={{ padding: "2px 10px", fontSize: 18 }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label
              className="os-text-xs os-text-dim os-uppercase"
              style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
            >
              Weight
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="5.0"
              className="os-input"
              style={{ width: "100%", fontSize: 14 }}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
              Multiplier applied to this reviewer's scores. Default is 1.0.
            </div>
          </div>

          <div>
            <label
              className="os-text-xs os-text-dim os-uppercase"
              style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
            >
              Domains (comma-separated)
            </label>
            <input
              type="text"
              className="os-input"
              style={{ width: "100%", fontSize: 14 }}
              placeholder="e.g. Robotics, AI, CleanTech"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
          </div>

          {err && (
            <div
              style={{
                color: "var(--bad)",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 12px",
                background: "var(--bad-soft)",
                borderRadius: 4,
              }}
            >
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            background: "var(--bg-soft)",
          }}
        >
          <button className="os-btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="os-btn"
            style={{ background: "var(--accent)", color: "#fff" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose, onInvited }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const handleInvite = async () => {
    if (!name.trim() || !email.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await adminApi.createUser({
        email: email.trim(),
        full_name: name.trim(),
        roles: ["reviewer"],
        send_invite: true,
      });
      setResult(res);
      onInvited();
    } catch (e) {
      setErr(e?.message || "Invite failed.");
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(36,36,36,0.5)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-paper)",
          border: "1px solid var(--line-strong)",
          borderRadius: 4,
          width: 440,
          maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(36,36,36,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Head */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>
            Invite Reviewer
          </div>
          <button
            className="os-btn sm ghost"
            onClick={onClose}
            style={{ padding: "2px 8px", fontSize: 18 }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {result ? (
            <div>
              <div
                style={{
                  color: "var(--ok)",
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                Reviewer invited successfully.
              </div>
              {result.temp_password && (
                <div
                  style={{
                    background: "var(--bg-soft)",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "10px 14px",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 13,
                    color: "var(--ink)",
                  }}
                >
                  Temp password:{" "}
                  <strong>{result.temp_password}</strong>
                </div>
              )}
              {result.invite_url && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--ink-soft)",
                    wordBreak: "break-all",
                  }}
                >
                  Invite URL: {result.invite_url}
                </div>
              )}
              <button
                className="os-btn"
                style={{ marginTop: 20, width: "100%" }}
                onClick={onClose}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label
                  className="os-text-xs os-text-dim os-uppercase"
                  style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
                >
                  Full Name
                </label>
                <input
                  type="text"
                  className="os-input"
                  style={{ width: "100%" }}
                  placeholder="e.g. Vikram Sundar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label
                  className="os-text-xs os-text-dim os-uppercase"
                  style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  className="os-input"
                  style={{ width: "100%" }}
                  placeholder="name@example.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {err && (
                <div
                  style={{
                    color: "var(--bad)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "8px 12px",
                    background: "var(--bad-soft)",
                    borderRadius: 4,
                  }}
                >
                  {err}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 12,
                  paddingTop: 4,
                }}
              >
                <button className="os-btn ghost" onClick={onClose} disabled={saving}>
                  Cancel
                </button>
                <button
                  className="os-btn"
                  style={{ background: "var(--accent)", color: "#fff" }}
                  onClick={handleInvite}
                  disabled={saving}
                >
                  {saving ? "Inviting…" : "Send Invite"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Rebalance Result Banner ───────────────────────────────────────────────

function RebalanceBanner({ result, onDismiss }) {
  if (!result) return null;
  return (
    <div
      style={{
        background: "var(--ok-soft, #cfe5df)",
        border: "1px solid var(--ok, #2a8f5a)",
        borderRadius: 4,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ok, #2a8f5a)", fontWeight: 600 }}>
        Rebalance complete —{" "}
        {typeof result.assigned === "number" ? result.assigned : "?"} assignments across{" "}
        {typeof result.reviewers === "number" ? result.reviewers : "?"} reviewers.
      </span>
      <button
        className="os-btn sm ghost"
        style={{ padding: "2px 8px", fontSize: 12 }}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function AdminReviewerRoster() {
  const [rev, setRev] = useState(0); // bump to reload
  const load = useCallback(
    () => adminPlatformApi.getReviewers(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev]
  );

  const { data, loading, error } = useAsync(load, [rev]);

  const reviewers = data?.reviewers ?? [];

  // Mutation state
  const [editTarget, setEditTarget] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceResult, setRebalanceResult] = useState(null);
  const [rebalanceErr, setRebalanceErr] = useState(null);

  const reload = useCallback(() => setRev((n) => n + 1), []);

  const handleRebalance = async () => {
    setRebalancing(true);
    setRebalanceErr(null);
    setRebalanceResult(null);
    try {
      const res = await adminPlatformApi.rebalance({});
      setRebalanceResult(res);
      reload();
    } catch (e) {
      setRebalanceErr(e?.message || "Rebalance failed.");
    } finally {
      setRebalancing(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="dash-scroll">
      {/* Header */}
      <div className="pl-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="dash-section-tag">A-3 · REVIEWERS</div>
          <div className="dash-card-title">Reviewer roster</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            Assignments, progress, weight calibration.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
          <button
            className="os-btn ghost"
            onClick={() => setShowInvite(true)}
          >
            Invite reviewer
          </button>
          <button
            className="os-btn"
            style={{ background: "var(--accent)", color: "#fff" }}
            onClick={handleRebalance}
            disabled={rebalancing}
          >
            {rebalancing ? "Rebalancing…" : "Rebalance"}
          </button>
        </div>
      </div>

      {/* Rebalance feedback */}
      {rebalanceResult && (
        <RebalanceBanner
          result={rebalanceResult}
          onDismiss={() => setRebalanceResult(null)}
        />
      )}
      {rebalanceErr && (
        <div
          style={{
            color: "var(--bad)",
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 12px",
            background: "var(--bad-soft)",
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          {rebalanceErr}
        </div>
      )}

      {/* Body */}
      {loading && <LoadingState label="Loading reviewers…" />}
      {!loading && error && (
        <ErrorState error={error} onRetry={reload} />
      )}
      {!loading && !error && reviewers.length === 0 && (
        <EmptyState label="No reviewers yet. Invite one to get started." />
      )}

      {!loading && !error && reviewers.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="os-table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Domains</th>
                <th className="num">Weight</th>
                <th>Progress</th>
                <th>Consistency</th>
                <th>Last activity</th>
                <th>Batch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reviewers.map((r) => {
                const { assigned, completed, pct } = parseProgress(r.assigned, r.completed);
                const cons = r.consistency; // may be null
                const consColor = consistencyColor(cons);
                const domainsArr = Array.isArray(r.domains) ? r.domains : [];

                return (
                  <tr key={r.user_id}>
                    {/* Reviewer — name + email */}
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                        {r.name || "—"}
                      </div>
                      {r.email && (
                        <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 1 }}>
                          {r.email}
                        </div>
                      )}
                    </td>

                    {/* Domains */}
                    <td>
                      {domainsArr.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {domainsArr.map((d) => (
                            <span
                              key={d}
                              className="os-chip"
                              style={{ fontSize: 11, padding: "1px 6px" }}
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>

                    {/* Weight */}
                    <td className="num">
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {typeof r.weight === "number" ? r.weight.toFixed(1) : "1.0"}
                      </span>
                      {r.weight > 1.0 && (
                        <span
                          className="os-chip purple"
                          style={{ fontSize: 9, padding: "1px 5px", fontWeight: 700, marginLeft: 6 }}
                        >
                          PRIMARY
                        </span>
                      )}
                    </td>

                    {/* Progress: C / A + progress bar */}
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 72,
                            height: 6,
                            background: "var(--line)",
                            borderRadius: 3,
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(pct * 100)}%`,
                              background: "var(--ink)",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span
                          className="os-mono os-text-sm"
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {completed} / {assigned}
                        </span>
                      </div>
                    </td>

                    {/* Consistency — null → "—" */}
                    <td>
                      {cons !== null && cons !== undefined ? (
                        <span className={`os-chip ${consColor}`}>
                          {(cons * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>

                    {/* Last activity */}
                    <td className="os-mono os-text-sm os-text-soft">
                      {r.lastActivity || "—"}
                    </td>

                    {/* Batch */}
                    <td className="os-text-soft os-text-sm">
                      {r.batch || "—"}
                    </td>

                    {/* Actions */}
                    <td>
                      <button
                        className="os-btn sm secondary"
                        onClick={() => setEditTarget(r)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit drawer */}
      {editTarget && (
        <EditDrawer
          reviewer={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            reload();
          }}
        />
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
