import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";
import { bucketForAssignment, INBOX_STATES } from "./inboxCardStates.js";
import DeclineAssignmentModal from "./scoring/DeclineAssignmentModal.jsx";

function fmtAssigned(iso) {
  if (!iso) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function fmtCountdown(lockedAtIso) {
  if (!lockedAtIso) return "";
  const ms = new Date(lockedAtIso).getTime() - Date.now();
  if (ms <= 0) return "0:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AssignmentCard({ a, bucket, onScore, onEdit, onDecline }) {
  const isEditable = bucket === INBOX_STATES.EDITABLE;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.04em" }}>
          {isEditable && <span className="dot amber" style={{ marginRight: 8 }} />}
          {a.app_identifier}
        </span>
        <span className="inbox-card-meta">
          {a.industry && <span>{a.industry}</span>}
          {a.industry && <span className="sep" />}
          <span>{isEditable ? `Edit window closes in ${fmtCountdown(a.my_review.locked_at)}` : `Assigned ${fmtAssigned(a.assigned_at)}`}</span>
        </span>
      </div>
      <p style={{ fontSize: "var(--t-body-lg)", color: "var(--ink)", margin: "12px 0 0" }}>
        {a.problem_one_liner || "—"}
      </p>
      {!isEditable && a.assigned_by_display && (
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "4px 0 0" }}>
          by {a.assigned_by_display}
        </p>
      )}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
        {isEditable ? (
          <button type="button" className="btn btn-dark" onClick={() => onEdit(a)}>
            Edit review <span className="arrow">→</span>
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => onDecline(a)}>
              Decline
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onScore(a)}>
              Score this <span className="arrow">→</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReviewerInboxPage() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [declinePending, setDeclinePending] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reviewerApi.listAssignments();
      setAssignments(res.assignments || []);
    } catch (err) {
      setError(err?.message || "Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const buckets = useMemo(() => {
    const toReview = [];
    const editable = [];
    for (const a of assignments) {
      const b = bucketForAssignment(a);
      if (b === INBOX_STATES.TO_REVIEW) toReview.push(a);
      else if (b === INBOX_STATES.EDITABLE) editable.push(a);
    }
    return { toReview, editable };
  }, [assignments]);

  const goScore = useCallback((a) => {
    try {
      sessionStorage.setItem(
        "reviewer_inbox_id_list",
        JSON.stringify(assignments.map((x) => ({ track: x.application_track, id: x.application_id }))),
      );
    } catch { /* ignore */ }
    navigate(`/reviewer/${a.application_track}/${a.application_id}/score`);
  }, [assignments, navigate]);

  const goEdit = goScore;

  const onConfirmDecline = useCallback(async (reason) => {
    if (!declining) return;
    setDeclinePending(true);
    try {
      await reviewerApi.declineAssignment(declining.assignment_id, reason);
      setDeclining(null);
      await load();
    } catch (err) {
      window.alert(err?.message || "Failed to decline. Please try again.");
    } finally {
      setDeclinePending(false);
    }
  }, [declining, load]);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">Reviews</span>
          <h1>Inbox.</h1>
          <p className="page-sub">
            {buckets.toReview.length === 0 && buckets.editable.length === 0
              ? "Nothing waiting on you right now."
              : "Read carefully. Your scores stay private until leadership compares them."}
          </p>
        </div>
      </header>

      {error && <div className="inline-error" role="alert">{error}</div>}
      {loading && <p style={{ color: "var(--ink-soft)" }}>Loading…</p>}

      {!loading && !error && buckets.toReview.length === 0 && buckets.editable.length === 0 && (
        <div className="card card-soft" style={{ textAlign: "center", padding: "96px 32px" }}>
          <span className="eyebrow">All clear</span>
          <h3 style={{ marginTop: 12 }}>You're caught up.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            Leadership will assign new applications as they come in.
          </p>
        </div>
      )}

      {buckets.toReview.length > 0 && (
        <section className="inbox-section">
          <span className="eyebrow">To review · {buckets.toReview.length}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            {buckets.toReview.map((a) => (
              <AssignmentCard
                key={a.assignment_id}
                a={a}
                bucket={INBOX_STATES.TO_REVIEW}
                onScore={goScore}
                onDecline={(x) => setDeclining(x)}
              />
            ))}
          </div>
        </section>
      )}

      {buckets.editable.length > 0 && (
        <section className="inbox-section">
          <span className="eyebrow">Editable · {buckets.editable.length} · within 60-min edit window</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            {buckets.editable.map((a) => (
              <AssignmentCard
                key={a.assignment_id}
                a={a}
                bucket={INBOX_STATES.EDITABLE}
                onEdit={goEdit}
              />
            ))}
          </div>
        </section>
      )}

      {declining && (
        <DeclineAssignmentModal
          assignmentId={declining.assignment_id}
          isPending={declinePending}
          onConfirm={onConfirmDecline}
          onCancel={() => setDeclining(null)}
        />
      )}
    </>
  );
}
