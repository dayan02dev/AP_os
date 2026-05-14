// AssignReviewersModal — assign up to 3 reviewers to one application.
//
// On open, fetches all users with the `reviewer` role via the admin list
// endpoint and pre-checks the ones already actively assigned. On submit,
// computes a diff against the current set and issues separate POSTs (for
// adds) and DELETEs (for removals). Surfaces backend 409s cleanly:
//   - reviewer_limit_reached    — soft-block the submit, show a hint
//   - self_assignment_blocked   — pre-filter the applicant out of the list
//   - review_already_submitted  — explain why this reviewer can't be removed
//
// The "active" definition matches the backend: states 'pending' or 'accepted'.
// Declined/completed history isn't surfaced here in Phase 1.

import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi } from "../../../lib/adminApi.js";
import { leadershipApi } from "../../../lib/leadershipApi.js";

const MAX_REVIEWERS = 3;
const ACTIVE_STATES = new Set(["pending", "accepted"]);

function shortId(uid) {
  return (uid || "").slice(0, 8);
}

export default function AssignReviewersModal({ application, onClose, onSuccess }) {
  const track = application?.track || null;
  const applicantUserId = application?.user_id || null;
  const currentAssignments = useMemo(
    () => (application?.reviewer_assignments || []).filter((a) =>
      ACTIVE_STATES.has(a.state),
    ),
    [application?.reviewer_assignments],
  );
  const initiallySelected = useMemo(
    () => new Set(currentAssignments.map((a) => a.reviewer_user_id)),
    [currentAssignments],
  );

  const [reviewers, setReviewers] = useState(null);     // null = loading
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(initiallySelected);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const panelRef = useRef(null);

  // Fetch reviewer roster once on mount.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .listUsers({ role: "reviewer", limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const users = (res?.users || [])
          .filter((u) => Array.isArray(u.roles) && u.roles.includes("reviewer"))
          // Defensive: never list the applicant themselves as an option.
          .filter((u) => u.id !== applicantUserId);
        setReviewers(users);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message || "Failed to load reviewer list.");
          setReviewers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applicantUserId]);

  // Modal a11y.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, submitting]);

  if (!application) return null;

  // Selected user ids the user is actively considering, in display order.
  const selectedList = (reviewers || []).filter((u) => selected.has(u.id));

  // Pre-cache assignee rows by user_id so we can find the `state` for
  // unassign-blocking explanations on the diff.
  const assignmentByUserId = useMemo(() => {
    const m = {};
    for (const a of currentAssignments) m[a.reviewer_user_id] = a;
    return m;
  }, [currentAssignments]);

  function toggle(userId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else {
        if (next.size >= MAX_REVIEWERS) {
          // Don't allow checkbox into a 4+ state; the disabled hint below
          // makes this obvious to the user. Still safe to submit because the
          // backend caps at 3.
          return prev;
        }
        next.add(userId);
      }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    // Compute the diff vs the original assignment set.
    const initial = initiallySelected;
    const target = selected;
    const toAdd = [...target].filter((id) => !initial.has(id));
    const toRemove = [...initial].filter((id) => !target.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      // Nothing to do — close gracefully without an API roundtrip.
      onSuccess?.();
      return;
    }

    setSubmitting(true);
    try {
      // Run removals first so the cap math is friendlier when swapping the
      // 3rd reviewer for a new one — otherwise an add+remove of equal counts
      // could transiently push the count to 4 and 409.
      for (const uid of toRemove) {
        try {
          await leadershipApi.unassignReviewer(application.id, track, uid);
        } catch (err) {
          const code = err?.details?.code || err?.code;
          if (code === "review_already_submitted") {
            // Surface specifically; abort the rest of the diff so the user
            // can re-confirm the action with the warning in mind.
            throw new Error(
              `Reviewer ${shortId(uid)} already submitted a review and can't be revoked in Phase 1.`,
            );
          }
          throw err;
        }
      }
      if (toAdd.length > 0) {
        await leadershipApi.bulkAssignReviewers(application.id, track, toAdd);
      }
      onSuccess?.();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      let msg = err?.details?.message || err?.message || "Failed to update reviewers.";
      if (code === "reviewer_limit_reached") {
        msg = `Cannot exceed ${MAX_REVIEWERS} active reviewers per application.`;
      } else if (code === "self_assignment_blocked") {
        msg = "The applicant can't be assigned as their own reviewer.";
      }
      setSubmitError(`${code ? `[${code}] ` : ""}${msg}`);
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={!submitting ? onClose : undefined}>
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-reviewers-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div style={headStyle}>
          <div>
            <div className="eir-mono eir-dim" style={kickerStyle}>
              § Assign reviewers
            </div>
            <h3 id="assign-reviewers-title" style={titleStyle}>
              {application.basic_full_name || application.id?.slice(0, 8)}
            </h3>
            <div className="eir-mono eir-dim" style={subStyle}>
              {(track || "").toUpperCase()} · select up to {MAX_REVIEWERS} reviewers
            </div>
          </div>
          <button
            type="button"
            className="eir-mono"
            style={closeBtnStyle}
            onClick={onClose}
            disabled={submitting}
          >
            close ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          <div className="eir-mono eir-dim" style={statusLineStyle}>
            {selected.size} / {MAX_REVIEWERS} selected
            {selectedList.length > 0 && (
              <span>
                {" · "}
                {selectedList
                  .map((u) => u.full_name || u.email || shortId(u.id))
                  .join(", ")}
              </span>
            )}
          </div>

          {loadError && (
            <div className="lp-error" style={errorStyle}>
              {loadError}
            </div>
          )}

          {reviewers === null ? (
            <div className="lp-loading">loading reviewer roster…</div>
          ) : reviewers.length === 0 ? (
            <p style={emptyStyle}>
              No users with the <code>reviewer</code> role yet. Ask an admin to
              grant the reviewer role via the User Management page first.
            </p>
          ) : (
            <ul style={listStyle}>
              {reviewers.map((u) => {
                const isOn = selected.has(u.id);
                const wasInitiallyOn = initiallySelected.has(u.id);
                const assignment = assignmentByUserId[u.id];
                const disabledForCap = !isOn && selected.size >= MAX_REVIEWERS;
                return (
                  <li key={u.id} style={itemStyle(isOn)}>
                    <label style={itemLabelStyle}>
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(u.id)}
                        disabled={submitting || disabledForCap}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <strong>{u.full_name || u.email || shortId(u.id)}</strong>
                        <span className="eir-mono eir-dim" style={{ fontSize: 11 }}>
                          {u.email}
                          {wasInitiallyOn && assignment?.state && (
                            <> · currently <em>{assignment.state}</em></>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {submitError && (
            <div className="lp-error" role="alert" style={errorStyle}>
              {submitError}
            </div>
          )}

          <div style={actionsStyle}>
            <button
              type="button"
              className="lp-drawer-action-btn"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="lp-drawer-action-btn is-primary"
              disabled={submitting || reviewers === null}
            >
              {submitting ? "Saving…" : "Save reviewers"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Inline style tokens (same palette as the drawer) ──────────────────

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "color-mix(in srgb, var(--ink) 32%, transparent)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
  padding: 24,
};

const panelStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  width: "min(600px, 100%)",
  maxHeight: "calc(100vh - 48px)",
  display: "flex",
  flexDirection: "column",
  outline: "none",
};

const headStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: 20,
  borderBottom: "1px solid var(--line)",
};

const kickerStyle = {
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const titleStyle = {
  margin: "6px 0 4px",
  fontFamily: "var(--font-serif)",
  fontSize: 22,
  color: "var(--ink)",
};

const subStyle = {
  fontSize: 11,
  letterSpacing: "0.08em",
};

const closeBtnStyle = {
  background: "transparent",
  border: "1px solid var(--line)",
  padding: "4px 10px",
  fontSize: 11,
  cursor: "pointer",
  color: "var(--ink-dim)",
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  overflowY: "auto",
};

const statusLineStyle = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxHeight: 380,
  overflowY: "auto",
  border: "1px solid var(--line)",
  background: "var(--bg-soft)",
};

const itemStyle = (isOn) => ({
  padding: "10px 12px",
  borderBottom: "1px solid var(--line)",
  background: isOn ? "var(--accent-soft)" : "transparent",
});

const itemLabelStyle = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1.4,
};

const emptyStyle = {
  fontSize: 13,
  color: "var(--ink-dim)",
  lineHeight: 1.5,
  margin: 0,
  padding: "12px 14px",
  border: "1px dashed var(--line)",
  background: "var(--bg-soft)",
};

const errorStyle = {
  fontSize: 12,
  padding: "8px 12px",
  border: "1px solid var(--line)",
  background: "var(--bg-soft)",
  color: "var(--ink)",
};

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  paddingTop: 8,
  borderTop: "1px solid var(--line)",
  marginTop: 4,
};
