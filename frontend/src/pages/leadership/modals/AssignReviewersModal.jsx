// AssignReviewersModal — assign up to 3 reviewers to an application.
//
// Visual contract: ARTPARK design system §5.5 .modal.
// Fetches GET /admin/users?role=reviewer, pre-checks current assignees,
// diffs on submit (DELETE removals first, then POST adds so swap flows
// don't transiently trip the 3-cap).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    () => (application?.reviewer_assignments || []).filter((a) => ACTIVE_STATES.has(a.state)),
    [application?.reviewer_assignments],
  );
  const initiallySelected = useMemo(
    () => new Set(currentAssignments.map((a) => a.reviewer_user_id)),
    [currentAssignments],
  );

  const [reviewers, setReviewers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(initiallySelected);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.listUsers({ role: "reviewer", limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const users = (res?.users || [])
          .filter((u) => Array.isArray(u.roles) && u.roles.includes("reviewer"))
          .filter((u) => u.id !== applicantUserId);
        setReviewers(users);
      })
      .catch((err) => {
        if (!cancelled) { setLoadError(err?.message || "Failed to load reviewers."); setReviewers([]); }
      });
    return () => { cancelled = true; };
  }, [applicantUserId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, submitting]);

  if (!application) return null;

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
        if (next.size >= MAX_REVIEWERS) return prev;
        next.add(userId);
      }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    const initial = initiallySelected;
    const target = selected;
    const toAdd = [...target].filter((id) => !initial.has(id));
    const toRemove = [...initial].filter((id) => !target.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      onSuccess?.();
      return;
    }

    setSubmitting(true);
    try {
      for (const uid of toRemove) {
        try {
          await leadershipApi.unassignReviewer(application.id, track, uid);
        } catch (err) {
          const code = err?.details?.code || err?.code;
          if (code === "review_already_submitted") {
            throw new Error(`Reviewer ${shortId(uid)} already submitted a review and can't be revoked in Phase 1.`);
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
      if (code === "reviewer_limit_reached") msg = `Cannot exceed ${MAX_REVIEWERS} active reviewers per application.`;
      else if (code === "self_assignment_blocked") msg = "The applicant can't be assigned as their own reviewer.";
      setSubmitError(`${code ? `[${code}] ` : ""}${msg}`);
      setSubmitting(false);
    }
  }

  return createPortal((
    <div
      className="modal-scrim"
      role="presentation"
      onClick={(e) => { if (!submitting && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        style={{ maxWidth: 600 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-reviewers-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div>
          <span className="modal-eyebrow">Assign reviewers</span>
          <h2 id="assign-reviewers-title">
            Assign for {application.basic_full_name || application.id?.slice(0, 8)}.
          </h2>
        </div>

        <div className="modal-body">
          <p>
            Pick up to <strong>{MAX_REVIEWERS}</strong> reviewers. They'll get an email with a link to the inbox.
            {selected.size > 0 && (
              <> Currently selected: <strong>{selected.size} of {MAX_REVIEWERS}</strong>.</>
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="modal-fields">
          {loadError && <div className="inline-error" role="alert">{loadError}</div>}

          {reviewers === null ? (
            <div className="inline-loading">Loading reviewer roster…</div>
          ) : reviewers.length === 0 ? (
            <div className="card card-soft">
              <span className="eyebrow">No reviewers yet</span>
              <p style={{ marginTop: "var(--s-2)", color: "var(--ink-soft)", fontSize: 14 }}>
                No users have the <strong>reviewer</strong> role yet. Ask an admin to grant
                the reviewer role via the User Management page.
              </p>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                maxHeight: 360,
                overflowY: "auto",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-sharp)",
              }}
            >
              {reviewers.map((u) => {
                const isOn = selected.has(u.id);
                const wasInitiallyOn = initiallySelected.has(u.id);
                const assignment = assignmentByUserId[u.id];
                const disabledForCap = !isOn && selected.size >= MAX_REVIEWERS;
                return (
                  <li
                    key={u.id}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      background: isOn ? "rgba(50,19,183,0.04)" : "transparent",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        gap: "var(--s-3)",
                        alignItems: "flex-start",
                        padding: "var(--s-3) var(--s-4)",
                        cursor: disabledForCap ? "not-allowed" : "pointer",
                        opacity: disabledForCap ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(u.id)}
                        disabled={submitting || disabledForCap}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <strong style={{ fontSize: 14 }}>
                          {u.full_name || u.email || shortId(u.id)}
                        </strong>
                        <span style={{ color: "var(--ink-soft)", fontSize: 12, wordBreak: "break-all" }}>
                          {u.email}
                          {wasInitiallyOn && assignment?.state && (
                            <> · currently <span style={{ textTransform: "capitalize" }}>{assignment.state}</span></>
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {submitError && <div className="inline-error" role="alert">{submitError}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || reviewers === null}
            >
              {submitting ? "Saving…" : (
                <>Save reviewers <span className="arrow">→</span></>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  ), document.body);
}
