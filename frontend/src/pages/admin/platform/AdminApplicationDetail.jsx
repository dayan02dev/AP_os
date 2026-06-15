// AdminApplicationDetail — A-2 Application Detail (Task 17).
//
// Full-page standalone screen reached from the pipeline (T16) row click at
//   /admin/application/:track/:id
// Route-gated to the `view_app_detail` capability (granted to admin AND
// leadership per rbac.ROLE_CAPABILITIES).
//
// Loads the full admin detail via adminPlatformApi.getApplication(track, id):
// the leadership detail assembly (application row, ai_screening, reviews,
// reviewer_assignments, status_history) PLUS the admin-portal additions
// `decision` (latest admin_decisions row or null), `meta`
// (application_admin_meta or null), and `batch`.
//
// The screen drives three writes:
//   • Admin decision — POST .../decision via adminPlatformApi.decide.
//     Shortlist may omit a rationale; hold/reject/waitlist require one (the
//     backend returns 422 `rationale_required`). The chosen decision may be
//     illegal from the current status — the backend returns 422
//     `illegal_transition` with an `allowed` list, surfaced inline.
//   • Reviewer assignment — assign/unassign reuse leadershipApi
//     (assignReviewers / unassignReviewer). NOTE: those endpoints require the
//     `assign_reviewers` capability, which leadership has but an admin-only
//     account does not — an admin-only caller sees a graceful 403 message.
//   • Meta — Hide / Archive / Restore via adminPlatformApi.patchMeta.
//
// Every field access is guarded: the detail payload can carry nulls (no
// decision, no AI screening, no reviews) and a missing key renders "—",
// never crashes.

import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { useAuth } from "../../../hooks/useAuth.jsx";
import { schemaFor } from "../../leadership/applicationSchemas.js";
import ApplicationTab from "../../leadership/review/ApplicationTab.jsx";
import ReviewsTab from "../../leadership/review/ReviewsTab.jsx";
import AISummaryBlock from "../../leadership/components/AISummaryBlock.jsx";
import { useAsync, LoadingState, ErrorState, Chip } from "./ui.jsx";
import { initialsOf } from "./ui.jsx";

import "../../../styles/admin-portal.css";
import "../../../styles/admin.css";
import "../../../styles/leadership.css";
import "../../../styles/review-application.css";

// ─── Presentation maps (mirrors AdminPipeline) ──────────────────────────────
const STATUS_TONE = {
  shortlisted: "green",
  offered: "green",
  onboarded: "green",
  interview: "blue",
  evaluated: "purple",
  under_review: "amber",
  ai_screening: "amber",
  on_hold: "amber",
  submitted: "",
  rejected: "red",
  waitlisted: "slate",
  withdrawn: "slate",
};

const DECISION_TONE = {
  shortlisted: "green",
  on_hold: "amber",
  rejected: "red",
  waitlisted: "slate",
};

// The four gate-1 decisions. Shortlist alone may submit without a rationale.
const DECISIONS = [
  { id: "shortlisted", label: "Shortlist", needsRationale: false },
  { id: "on_hold", label: "Hold", needsRationale: true },
  { id: "rejected", label: "Reject", needsRationale: true },
  { id: "waitlisted", label: "Waitlist", needsRationale: true },
];

const AI_CATEGORY_BARS = [
  { key: "score_problem", label: "Problem impact" },
  { key: "score_completeness", label: "Completeness & depth" },
  { key: "score_tech", label: "Technical depth" },
  { key: "score_founders", label: "Behavioural signal" },
  { key: "score_commitment", label: "Commitment" },
  { key: "score_integrity", label: "Integrity & closure" },
];

function prettify(v) {
  if (!v) return "";
  return String(v)
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function shortId(uid) {
  return (uid || "").slice(0, 8) || "—";
}

// Pure rationale gate (exported for unit test). Shortlist may submit without a
// rationale; hold/reject/waitlist require a non-blank one. Returns true when
// the decision is OK to submit.
export function canSubmitDecision(decisionId, rationale) {
  if (!decisionId) return false;
  const opt = DECISIONS.find((d) => d.id === decisionId);
  if (!opt) return false;
  if (!opt.needsRationale) return true;
  return (rationale || "").trim().length > 0;
}

// Pure formatter for the 422 illegal_transition hint (exported for unit test).
export function illegalTransitionMessage(currentStatus, allowed) {
  const list = Array.isArray(allowed) ? allowed : [];
  const hint = list.length
    ? ` Allowed from "${prettify(currentStatus) || currentStatus || "current status"}": ${list.map(prettify).join(", ")}.`
    : "";
  return `That decision isn't allowed from the current status.${hint}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── AI screening panel (inline; mirrors review AIScreeningPanel ScoreTab) ──
function AiScreeningCard({ aiScreening }) {
  const overall = aiScreening?.score_overall;
  const hasOverall = typeof overall === "number" && Number.isFinite(overall);
  return (
    <section className="aad-card">
      <div className="aad-card-head">
        <span className="aad-eyebrow">AI SCREENING</span>
        {hasOverall && (
          <span className="aad-score-pill">{overall.toFixed(1)} / 10</span>
        )}
      </div>
      {!aiScreening ? (
        <p className="aad-muted">AI screening not run yet.</p>
      ) : (
        <>
          <div className="aad-bars">
            {AI_CATEGORY_BARS.map((c) => {
              const v = aiScreening?.[c.key];
              const pct = typeof v === "number" ? (v / 10) * 100 : 0;
              return (
                <div key={c.key} className="aad-bar-row">
                  <span className="aad-bar-label">{c.label}</span>
                  <div className="aad-bar-track">
                    <div className="aad-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="aad-bar-num">
                    {typeof v === "number" ? v.toFixed(1) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          {aiScreening?.summary && (
            <div className="aad-summary">
              <div className="aad-summary-head">AI Summary</div>
              <AISummaryBlock aiScreening={aiScreening} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Reviewer assignment panel ──────────────────────────────────────────────
function ReviewerAssignmentCard({
  id, track, assignments, currentUserId, onReload, setBanner,
}) {
  const [reviewerInput, setReviewerInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [unassigning, setUnassigning] = useState(null);

  // Best-effort roster for the picker. getReviewers requires
  // `manage_reviewers_roster` (admin) — leadership accounts 403 here, so the
  // picker silently falls back to the free-text ID input below.
  const { data: rosterData } = useAsync(
    () => adminPlatformApi.getReviewers().catch(() => null),
    [],
  );
  const roster = useMemo(() => rosterData?.reviewers ?? [], [rosterData]);
  const assignedIds = useMemo(
    () => new Set((assignments || []).map((a) => a?.reviewer_user_id)),
    [assignments],
  );
  const rosterAvailable = roster.filter((r) => !assignedIds.has(r?.user_id));

  const handleAssign = useCallback(async () => {
    const rid = reviewerInput.trim();
    if (!rid || busy) return;
    setBusy(true);
    try {
      const resp = await leadershipApi.assignReviewers(id, track, {
        reviewer_user_ids: [rid],
      });
      const result = (resp?.results || [])[0];
      const st = result?.status;
      if (st === "created") {
        setBanner({ kind: "ok", text: `Reviewer ${shortId(rid)} assigned.` });
      } else if (st === "already_assigned") {
        setBanner({ kind: "error", text: "That reviewer is already assigned." });
      } else if (st === "not_a_reviewer") {
        setBanner({ kind: "error", text: "That user is not a reviewer." });
      } else {
        setBanner({ kind: "ok", text: "Assignment processed." });
      }
      setReviewerInput("");
      await onReload();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      if (err?.status === 403 || code === "missing_capability") {
        setBanner({
          kind: "error",
          text: "You don't have permission to assign reviewers (assign_reviewers capability required).",
        });
      } else {
        setBanner({
          kind: "error",
          text: err?.details?.message || err?.message || "Failed to assign reviewer.",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [reviewerInput, busy, id, track, onReload, setBanner]);

  const handleUnassign = useCallback(async (a) => {
    if (!a?.reviewer_user_id || unassigning) return;
    if (!window.confirm(`Remove reviewer ${shortId(a.reviewer_user_id)} from this application?`)) {
      return;
    }
    setUnassigning(a.reviewer_user_id);
    try {
      await leadershipApi.unassignReviewer(id, track, a.reviewer_user_id);
      setBanner({ kind: "ok", text: `Reviewer ${shortId(a.reviewer_user_id)} unassigned.` });
      await onReload();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      if (code === "review_already_submitted") {
        setBanner({
          kind: "error",
          text: "This reviewer has already submitted a review and can't be unassigned in Phase 1.",
        });
      } else if (err?.status === 403 || code === "missing_capability") {
        setBanner({
          kind: "error",
          text: "You don't have permission to unassign reviewers (assign_reviewers capability required).",
        });
      } else {
        setBanner({
          kind: "error",
          text: err?.details?.message || err?.message || "Failed to unassign reviewer.",
        });
      }
    } finally {
      setUnassigning(null);
    }
  }, [unassigning, id, track, onReload, setBanner]);

  return (
    <section className="aad-card">
      <div className="aad-card-head">
        <span className="aad-eyebrow">REVIEWER ASSIGNMENT</span>
      </div>

      {(!assignments || assignments.length === 0) ? (
        <p className="aad-muted">No reviewers assigned yet.</p>
      ) : (
        <ul className="aad-rev-list">
          {assignments.map((a) => {
            const isSelf = a?.reviewer_user_id === currentUserId;
            return (
              <li
                key={a?.id || `${a?.reviewer_user_id}-${a?.assigned_at}`}
                className="aad-rev-row"
              >
                <span className="aad-rev-id">
                  Reviewer · {shortId(a?.reviewer_user_id)}
                  <span className="aad-rev-state">{a?.state || "pending"}</span>
                </span>
                <button
                  type="button"
                  className="aad-btn ghost sm"
                  disabled={isSelf || unassigning === a?.reviewer_user_id}
                  title={isSelf ? "You can't unassign yourself." : "Remove this reviewer."}
                  onClick={() => handleUnassign(a)}
                >
                  {unassigning === a?.reviewer_user_id ? "Unassigning…" : "Unassign"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="aad-assign-row">
        {rosterAvailable.length > 0 ? (
          <select
            className="aad-input"
            value={reviewerInput}
            onChange={(e) => setReviewerInput(e.target.value)}
            disabled={busy}
          >
            <option value="">Select a reviewer…</option>
            {rosterAvailable.map((r) => (
              <option key={r.user_id} value={r.user_id}>
                {r.name || r.email || shortId(r.user_id)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="aad-input"
            type="text"
            placeholder="Reviewer user-id"
            value={reviewerInput}
            onChange={(e) => setReviewerInput(e.target.value)}
            disabled={busy}
          />
        )}
        <button
          type="button"
          className="aad-btn"
          disabled={busy || !reviewerInput.trim()}
          onClick={handleAssign}
        >
          {busy ? "Assigning…" : "Assign"}
        </button>
      </div>
    </section>
  );
}

// ─── Admin decision card ─────────────────────────────────────────────────────
function DecisionCard({ id, track, currentDecision, currentStatus, onReload, setBanner }) {
  const [selected, setSelected] = useState(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  const opt = DECISIONS.find((d) => d.id === selected) || null;
  const needsRationale = !!opt?.needsRationale;
  const rationaleEmpty = !rationale.trim();
  const submitDisabled = busy || !canSubmitDecision(selected, rationale);

  const choose = (d) => {
    setSelected(d.id);
    setLocalError(null);
  };

  const submit = async () => {
    if (!selected) {
      setLocalError("Pick a decision first.");
      return;
    }
    if (needsRationale && rationaleEmpty) {
      setLocalError(`A rationale is required to ${opt.label.toLowerCase()} this application.`);
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await adminPlatformApi.decide(track, id, {
        decision: selected,
        rationale: rationale.trim() || undefined,
      });
      setBanner({ kind: "ok", text: `Decision recorded: ${prettify(selected)}.` });
      setSelected(null);
      setRationale("");
      await onReload();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      if (code === "illegal_transition") {
        setLocalError(illegalTransitionMessage(currentStatus, err?.details?.allowed));
      } else if (code === "rationale_required") {
        setLocalError(
          err?.details?.message || "A rationale is required for that decision.",
        );
      } else if (code === "application_not_found") {
        setLocalError("Application not found — it may have been removed.");
      } else if (err?.status === 403 || code === "missing_capability") {
        setLocalError("You don't have permission to record decisions.");
      } else {
        setLocalError(err?.details?.message || err?.message || "Failed to record decision.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="aad-card aad-decision">
      <div className="aad-card-head">
        <span className="aad-eyebrow">ADMIN DECISION</span>
        {currentDecision?.decision && (
          <Chip tone={DECISION_TONE[currentDecision.decision] || ""}>
            CURRENT · {prettify(currentDecision.decision).toUpperCase()}
          </Chip>
        )}
      </div>

      {currentDecision?.rationale && (
        <p className="aad-current-rationale">
          <span className="aad-muted">Last rationale:</span> {currentDecision.rationale}
        </p>
      )}

      <div className="aad-decision-btns">
        {DECISIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={
              "aad-btn decision" +
              (selected === d.id ? " active" : "") +
              (d.id === "shortlisted" ? " primary" : "")
            }
            disabled={busy}
            onClick={() => choose(d)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <textarea
        className="aad-textarea"
        rows={3}
        placeholder={
          needsRationale
            ? "Rationale (required for hold / reject / waitlist)…"
            : "Rationale (optional for shortlist)…"
        }
        value={rationale}
        onChange={(e) => {
          setRationale(e.target.value);
          if (localError) setLocalError(null);
        }}
        disabled={busy}
      />

      {localError && (
        <div className="aad-inline-error" role="alert">{localError}</div>
      )}

      <div className="aad-decision-foot">
        <button
          type="button"
          className="aad-btn primary"
          disabled={submitDisabled}
          onClick={submit}
        >
          {busy ? "Recording…" : "Record decision"}
        </button>
        {needsRationale && rationaleEmpty && (
          <span className="aad-muted aad-foot-hint">
            {opt.label} needs a rationale.
          </span>
        )}
      </div>
    </section>
  );
}

// ─── Meta controls (Hide / Archive / Restore) ───────────────────────────────
function MetaControls({ id, track, meta, onReload, setBanner }) {
  const [busy, setBusy] = useState(false);
  const isHidden = !!meta?.is_hidden;
  const isArchived = !!meta?.is_archived;

  const patch = useCallback(async (body, label) => {
    if (busy) return;
    setBusy(true);
    try {
      await adminPlatformApi.patchMeta(track, id, body);
      setBanner({ kind: "ok", text: `${label} applied.` });
      await onReload();
    } catch (err) {
      const code = err?.details?.code || err?.code;
      if (err?.status === 403 || code === "missing_capability") {
        setBanner({ kind: "error", text: "You don't have permission to change visibility." });
      } else {
        setBanner({
          kind: "error",
          text: err?.details?.message || err?.message || `${label} failed.`,
        });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, track, id, onReload, setBanner]);

  return (
    <div className="aad-meta-controls">
      {isHidden ? (
        <button type="button" className="aad-btn ghost sm" disabled={busy}
          onClick={() => patch({ is_hidden: false }, "Unhide")}>Unhide</button>
      ) : (
        <button type="button" className="aad-btn ghost sm" disabled={busy}
          onClick={() => patch({ is_hidden: true }, "Hide")}>Hide</button>
      )}
      {isArchived ? (
        <button type="button" className="aad-btn ghost sm" disabled={busy}
          onClick={() => patch({ is_archived: false }, "Restore")}>Restore</button>
      ) : (
        <button type="button" className="aad-btn ghost sm" disabled={busy}
          onClick={() => patch({ is_archived: true }, "Archive")}>Archive</button>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminApplicationDetail() {
  const { track, id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getApplication(track, id),
    [track, id],
  );

  const [banner, setBanner] = useState(null);

  const goBack = useCallback(() => navigate("/admin/pipeline"), [navigate]);

  const application = data?.application || null;
  const aiScreening = data?.ai_screening || null;
  const reviews = data?.reviews || [];
  const assignments = data?.reviewer_assignments || [];
  const decision = data?.decision || null;
  const meta = data?.meta || null;
  const batch = data?.batch || null;

  const resolvedTrack = data?.track || track;
  const schema = useMemo(() => schemaFor(resolvedTrack), [resolvedTrack]);

  const displayId = data?.display_id || data?.id || id;
  const founderName = data?.founder?.name || application?.basic_full_name || "—";
  const projectName = data?.project_name || "—";
  const status = application?.status || null;

  const is404 = error && (error.status === 404 || error?.details?.code === "application_not_found");

  return (
    <div className="adm-portal os-shell">
      <header className="aad-header">
        <button className="aad-back" onClick={goBack}>← Pipeline</button>
        <div className="aad-brand">
          <img
            src="/assets/artpark-iisc-logo.webp"
            alt="ARTPARK · AI & Robotics Technology Park at IISc"
            className="adm-brand-logo"
          />
        </div>
        <span className="adm-portal-tag">
          <span className="adm-live-dot" />
          ADMIN PORTAL · APPLICATION
        </span>
        <div className="aad-header-spacer" />
        {user?.email && (
          <div className="adm-user-chip" aria-label="Signed in user">
            <span className="os-avatar" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>
              {initialsOf(user?.full_name, user?.email)}
            </span>
            <span>{user.email}</span>
          </div>
        )}
      </header>

      <style>{AAD_CSS}</style>

      <div className="aad-layout">
        {loading ? (
          <LoadingState label="Loading application…" />
        ) : is404 ? (
          <div className="aad-notfound">
            <h2>Application not found</h2>
            <p className="aad-muted">
              No application matches <code>{track}/{id}</code>. It may have been removed.
            </p>
            <button className="aad-btn" onClick={goBack}>← Back to pipeline</button>
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data ? (
          <div className="aad-notfound">
            <h2>Application not found</h2>
            <button className="aad-btn" onClick={goBack}>← Back to pipeline</button>
          </div>
        ) : (
          <>
            {/* Title row */}
            <div className="aad-title-row">
              <div>
                <div className="aad-id os-mono">{displayId}</div>
                <h1 className="aad-name">{projectName}</h1>
                <div className="aad-sub">
                  <span>{founderName}</span>
                  {data?.industry?.label && <span> · {data.industry.label}</span>}
                  {data?.stage && <span> · {data.stage}</span>}
                  {batch?.name && <span> · Batch: {batch.name}</span>}
                </div>
              </div>
              <div className="aad-chips">
                {status && (
                  <Chip tone={STATUS_TONE[status] || ""}>
                    {prettify(status).toUpperCase()}
                  </Chip>
                )}
                {decision?.decision && (
                  <Chip tone={DECISION_TONE[decision.decision] || ""}>
                    {prettify(decision.decision).toUpperCase()}
                  </Chip>
                )}
                {meta?.is_hidden && <Chip tone="red">HIDDEN</Chip>}
                {meta?.is_archived && <Chip tone="slate">ARCHIVED</Chip>}
                <MetaControls
                  id={resolvedTrack ? data.id : id}
                  track={resolvedTrack}
                  meta={meta}
                  onReload={reload}
                  setBanner={setBanner}
                />
              </div>
            </div>

            {banner && (
              <div className={"aad-banner " + (banner.kind === "error" ? "is-error" : "is-ok")}>
                <span>{banner.text}</span>
                <button className="aad-banner-x" onClick={() => setBanner(null)} aria-label="Dismiss">×</button>
              </div>
            )}

            <div className="aad-grid">
              {/* Left column — application body + reviewer consensus */}
              <div className="aad-main">
                <section className="aad-card">
                  <div className="aad-card-head">
                    <span className="aad-eyebrow">APPLICATION</span>
                  </div>
                  <ApplicationTab
                    schema={schema}
                    application={application}
                    applicationId={data.id}
                  />
                </section>

                <section className="aad-card">
                  <div className="aad-card-head">
                    <span className="aad-eyebrow">REVIEWER CONSENSUS</span>
                  </div>
                  <ReviewsTab reviews={reviews} assignments={assignments} />
                </section>
              </div>

              {/* Right column — AI screening, assignment, decision */}
              <aside className="aad-aside">
                <DecisionCard
                  id={data.id}
                  track={resolvedTrack}
                  currentDecision={decision}
                  currentStatus={status}
                  onReload={reload}
                  setBanner={setBanner}
                />
                <AiScreeningCard aiScreening={aiScreening} />
                <ReviewerAssignmentCard
                  id={data.id}
                  track={resolvedTrack}
                  assignments={assignments}
                  currentUserId={user?.id || null}
                  onReload={reload}
                  setBanner={setBanner}
                />
                <section className="aad-card">
                  <div className="aad-card-head">
                    <span className="aad-eyebrow">STATUS HISTORY</span>
                  </div>
                  {(data?.status_history || []).length === 0 ? (
                    <p className="aad-muted">No status changes recorded.</p>
                  ) : (
                    <ul className="aad-history">
                      {(data.status_history || []).map((h, i) => (
                        <li key={h?.id || i} className="aad-history-row">
                          <span className="aad-history-status">
                            {prettify(h?.to_status || h?.status) || "—"}
                          </span>
                          <span className="aad-muted aad-history-when">
                            {fmtDate(h?.changed_at || h?.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Scoped styles — everything under `.adm-portal` so nothing leaks. Reuses the
// design tokens already defined by admin-portal.css.
const AAD_CSS = `
.adm-portal .aad-header {
  display:flex; align-items:center; gap:16px;
  padding:12px 24px; border-bottom:1px solid var(--line); background:#fff;
}
.adm-portal .aad-back {
  background:none; border:1px solid var(--line); border-radius:4px;
  padding:6px 12px; cursor:pointer; font-family:var(--font-sans);
  font-size:12px; font-weight:600; color:var(--ink-soft);
}
.adm-portal .aad-back:hover { background:var(--bg-soft); color:var(--ink); }
.adm-portal .aad-brand { display:flex; align-items:center; }
.adm-portal .aad-header-spacer { flex:1; }
.adm-portal .aad-layout { padding:24px; max-width:1280px; margin:0 auto; }
.adm-portal .aad-notfound { text-align:center; padding:64px 24px; }
.adm-portal .aad-notfound h2 { margin:0 0 8px; font-family:var(--font-sans); }
.adm-portal .aad-title-row {
  display:flex; align-items:flex-start; justify-content:space-between;
  gap:24px; margin-bottom:16px; flex-wrap:wrap;
}
.adm-portal .aad-id { font-size:12px; color:var(--ink-dim); }
.adm-portal .aad-name { margin:2px 0 4px; font-size:22px; font-family:var(--font-sans); color:var(--ink); }
.adm-portal .aad-sub { font-size:13px; color:var(--ink-soft); }
.adm-portal .aad-chips { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.adm-portal .aad-meta-controls { display:inline-flex; gap:6px; margin-left:4px; }
.adm-portal .aad-grid {
  display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:20px; align-items:start;
}
@media (max-width:980px) { .adm-portal .aad-grid { grid-template-columns:1fr; } }
.adm-portal .aad-main { display:flex; flex-direction:column; gap:20px; min-width:0; }
.adm-portal .aad-aside { display:flex; flex-direction:column; gap:16px; position:sticky; top:16px; }
.adm-portal .aad-card {
  border:1px solid var(--line); border-radius:6px; background:#fff; padding:16px 18px;
}
.adm-portal .aad-card-head {
  display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;
}
.adm-portal .aad-eyebrow {
  font-family:var(--font-mono, monospace); font-size:11px; letter-spacing:0.08em;
  font-weight:700; color:var(--ink-dim);
}
.adm-portal .aad-muted { color:var(--ink-dim); font-size:13px; }
.adm-portal .aad-score-pill {
  background:var(--ink); color:#fff; border-radius:4px; padding:2px 8px;
  font-size:12px; font-weight:700; font-family:var(--font-sans);
}
.adm-portal .aad-bars { display:flex; flex-direction:column; gap:8px; }
.adm-portal .aad-bar-row { display:grid; grid-template-columns:140px 1fr 32px; align-items:center; gap:10px; }
.adm-portal .aad-bar-label { font-size:12px; color:var(--ink-soft); }
.adm-portal .aad-bar-track { height:6px; background:var(--bg-soft); border-radius:3px; overflow:hidden; }
.adm-portal .aad-bar-fill { height:100%; background:var(--accent, #3213b7); }
.adm-portal .aad-bar-num { font-size:12px; font-weight:600; text-align:right; color:var(--ink); }
.adm-portal .aad-summary { margin-top:14px; border-top:1px solid var(--line); padding-top:12px; }
.adm-portal .aad-summary-head { font-size:12px; font-weight:700; color:var(--ink-soft); margin-bottom:6px; }
.adm-portal .aad-rev-list { list-style:none; margin:0 0 12px; padding:0; display:flex; flex-direction:column; gap:8px; }
.adm-portal .aad-rev-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.adm-portal .aad-rev-id { font-size:13px; color:var(--ink); display:flex; flex-direction:column; }
.adm-portal .aad-rev-state { font-size:11px; color:var(--ink-dim); text-transform:capitalize; }
.adm-portal .aad-assign-row { display:flex; gap:8px; }
.adm-portal .aad-input {
  flex:1; min-width:0; height:34px; padding:0 10px; border:1px solid var(--line);
  border-radius:4px; font-family:var(--font-sans); font-size:13px; background:#fff;
}
.adm-portal .aad-btn {
  height:34px; padding:0 14px; border:1px solid var(--line); background:#fff;
  border-radius:4px; cursor:pointer; font-family:var(--font-sans);
  font-size:13px; font-weight:600; color:var(--ink-soft); white-space:nowrap;
}
.adm-portal .aad-btn:hover:not(:disabled) { background:var(--bg-soft); color:var(--ink); border-color:var(--line-strong); }
.adm-portal .aad-btn.primary { background:var(--ink); border-color:var(--ink); color:#fff; }
.adm-portal .aad-btn.primary:hover:not(:disabled) { background:var(--accent, #3213b7); border-color:var(--accent, #3213b7); }
.adm-portal .aad-btn.ghost { border-color:transparent; background:transparent; color:var(--ink-dim); }
.adm-portal .aad-btn.sm { height:28px; padding:0 10px; font-size:12px; }
.adm-portal .aad-btn:disabled { opacity:0.5; cursor:not-allowed; }
.adm-portal .aad-decision-btns { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
.adm-portal .aad-btn.decision { height:38px; justify-content:center; }
.adm-portal .aad-btn.decision.active { outline:2px solid var(--accent, #3213b7); outline-offset:1px; }
.adm-portal .aad-textarea {
  width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:4px;
  padding:8px 10px; font-family:var(--font-sans); font-size:13px; resize:vertical; min-height:64px;
}
.adm-portal .aad-decision-foot { display:flex; align-items:center; gap:12px; margin-top:10px; }
.adm-portal .aad-foot-hint { font-size:12px; }
.adm-portal .aad-current-rationale { font-size:13px; color:var(--ink); margin:0 0 12px; line-height:1.5; }
.adm-portal .aad-inline-error {
  margin-top:10px; padding:8px 10px; border-radius:4px; font-size:12.5px;
  background:#fdecec; border:1px solid #f3c2c4; color:#b3262b;
}
.adm-portal .aad-banner {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:10px 14px; border-radius:4px; font-size:13px; margin-bottom:16px; font-family:var(--font-sans);
}
.adm-portal .aad-banner.is-ok { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .aad-banner.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .aad-banner-x { background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; }
.adm-portal .aad-history { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.adm-portal .aad-history-row { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; }
.adm-portal .aad-history-status { color:var(--ink); text-transform:capitalize; }
.adm-portal .aad-history-when { font-size:12px; }
`;
