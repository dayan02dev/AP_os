// AppDrawer — slide-in detail panel for a single application.
//
// Visual contract: ARTPARK design system §5.6 + §6.6.
// On open, fetches GET /leadership/applications/{id} for the full detail
// payload (ai_screening, reviews, reviewer_assignments, status_history).
// Footer: a single "Review application" action that opens the full review page.

import { useEffect, useRef, useState } from "react";
import { trackLabel, relabelDisplayId } from "../../../lib/trackLabel.js";
import { useNavigate } from "react-router-dom";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { fmtRelative } from "../../../lib/timeFmt.js";
import { bucketFor } from "./statusBuckets.js";
import AISummaryBlock from "./AISummaryBlock.jsx";
import Collapsible from "./Collapsible.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusInline({ statusId, label }) {
  return (
    <span className="lp-chip">
      <span className={`lp-status-dot lp-status-${bucketFor(statusId)}`} />
      <span style={{ textTransform: "capitalize" }}>{label || statusId}</span>
    </span>
  );
}

function renderProblemSolution(application) {
  if (!application) return null;
  const fields = Object.entries(application).filter(
    ([k, v]) =>
      typeof v === "string" &&
      v.trim() !== "" &&
      (k.startsWith("problem_") || k.startsWith("solution_")),
  );
  if (fields.length === 0) {
    return (
      <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
        No problem or solution text on file.
      </p>
    );
  }
  return (
    <dl className="def">
      {fields.map(([k, v]) => (
        <div key={k} className="def-row" style={{ gridTemplateColumns: "180px 1fr" }}>
          <dt>{k.replace(/_/g, " ")}</dt>
          <dd style={{ lineHeight: 1.55 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ComponentBars({ aiScreening }) {
  const components = [
    { key: "score_problem",    label: "Problem impact" },
    { key: "score_completeness", label: "Completeness & depth" },
    { key: "score_tech",       label: "Technical depth" },
    { key: "score_founders",   label: "Behavioural signal" },
    { key: "score_commitment", label: "Commitment" },
  ];
  return (
    <div>
      {components.map((c) => {
        const v = aiScreening?.[c.key];
        const pct = typeof v === "number" ? (v / 10) * 100 : 0;
        return (
          <div key={c.key} className="bar-row">
            <span className="bar-label">{c.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="bar-value">
              {typeof v === "number" ? v.toFixed(1) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AppDrawer({ row, onClose, statusLabelById, onDecided }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [rejectErr, setRejectErr] = useState(null);
  const panelRef = useRef(null);

  const handleReject = async () => {
    const reason = window.prompt(
      `Reject ${row.name || "this application"}?\n\nOptional reason (leave blank to reject without a note):`,
    );
    if (reason === null) return; // cancelled
    setRejecting(true);
    setRejectErr(null);
    try {
      await leadershipApi.decide(row.id, { decision: "rejected", rationale: reason || undefined });
      if (onDecided) onDecided();
      else onClose();
    } catch (e) {
      setRejectErr(e?.message || "Reject failed.");
      setRejecting(false);
    }
  };

  useEffect(() => {
    if (!row) return undefined;
    let cancelled = false;
    if (reloadKey === 0) {
      setDetail(null);
      setError(null);
      setLoading(true);
    }
    leadershipApi.getApplication(row.id)
      .then((d) => { if (!cancelled) { setDetail(d); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err?.message || "Failed to load detail."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [row, reloadKey]);

  useEffect(() => {
    if (!row) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [row, onClose]);

  if (!row) return null;

  const application = detail?.application || null;
  const aiScreening = detail?.ai_screening || null;
  const reviews = detail?.reviews || [];
  const assignments = detail?.reviewer_assignments || [];
  const history = detail?.status_history || [];
  const statusLabel = statusLabelById?.[row.status] || row.status;
  const fullName =
    detail?.founder?.name || application?.basic_full_name || row.founder?.name
    || row.basic_full_name || "—";
  const email = application?.basic_email || row.basic_email || "";
  const org =
    detail?.founder?.affiliation || application?.basic_org
    || row.founder?.affiliation || row.basic_org || "";
  const displayId = detail?.display_id || row.display_id || "";
  const projectName = detail?.project_name || row.project_name || "";

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="eyebrow">
              {displayId
                ? `${relabelDisplayId(displayId)} · ${trackLabel(row.track)}`
                : `${trackLabel(row.track)} · ${row.id?.slice(0, 8)}`}
            </span>
            <h2 id="drawer-title">
              {projectName || fullName}
            </h2>
            <div className="meta">
              <span>
                <StatusInline statusId={row.status} label={statusLabel} />
              </span>
              <span>{fullName}</span>
              {org && <span>{org}</span>}
              {email && <span>{email}</span>}
              <span>
                Submitted {fmtRelative(row.submitted_at || row.created_at)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ×
          </button>
        </header>

        {error && (
          <div style={{ padding: "var(--s-4) var(--s-6)" }}>
            <div className="inline-error">{error}</div>
          </div>
        )}

        <div className="drawer-body">
          <section className="drawer-section">
            <span className="section-eyebrow">AI score</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s-3)" }}>
              <strong
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 44,
                  color: aiScreening?.score_overall != null ? "var(--artblue)" : "var(--ink-dim)",
                  lineHeight: 1,
                }}
              >
                {aiScreening?.score_overall != null ? aiScreening.score_overall.toFixed(1) : "—"}
              </strong>
              <span style={{ color: "var(--ink-dim)", fontSize: 14 }}>
                / 10 overall
              </span>
            </div>
            {loading && !detail ? (
              <div className="inline-loading">Loading score…</div>
            ) : aiScreening ? (
              <>
                <ComponentBars aiScreening={aiScreening} />
                {aiScreening.summary && (
                  <div style={{ marginTop: "var(--s-3)" }}>
                    <span className="section-eyebrow">AI summary</span>
                    <div style={{ marginTop: "var(--s-2)" }}>
                      <AISummaryBlock aiScreening={aiScreening} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                Not scored yet — AI screening hasn't completed for this application.
              </p>
            )}
          </section>

          <div className="lp-drawer-accordion">
            <Collapsible label="Problem & solution">
            {loading && !application ? (
              <div className="inline-loading">Loading…</div>
            ) : (
              renderProblemSolution(application)
            )}
            </Collapsible>

            <Collapsible label="Reviewer assignments" hint={assignments.length}>
            {loading && !detail ? (
              <div className="inline-loading">Loading…</div>
            ) : assignments.length === 0 ? (
              <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                No reviewers assigned yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
                {assignments.map((a) => {
                  const dotCls = a.state === "completed" ? "green"
                    : a.state === "declined" ? "coral"
                    : a.state === "accepted" ? "green" : "amber";
                  return (
                    <li
                      key={a.id || `${a.reviewer_user_id}-${a.assigned_at}`}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "var(--s-3) var(--s-4)",
                        background: "var(--paper-soft)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-sharp)",
                        gap: "var(--s-3)",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 14 }}>
                          {a.reviewer_user_id?.slice(0, 8) || "—"}
                        </strong>
                        <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 2 }}>
                          Assigned {fmtDate(a.assigned_at)}
                        </div>
                      </div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, textTransform: "capitalize" }}>
                        <span className={`dot ${dotCls}`} />
                        {a.state || "pending"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            </Collapsible>

            <Collapsible label="Reviews" hint={reviews.length}>
            {loading && !detail ? (
              <div className="inline-loading">Loading…</div>
            ) : reviews.length === 0 ? (
              <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                No reviews submitted yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
                {reviews.map((r) => (
                  <li
                    key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
                    style={{
                      padding: "var(--s-3) var(--s-4)",
                      background: "var(--paper-soft)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-sharp)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong style={{ fontSize: 14 }}>
                        {r.reviewer_user_id?.slice(0, 8) || "—"}
                      </strong>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
                        {fmtDate(r.submitted_at)}
                      </span>
                    </div>
                    {r.score_overall != null && (
                      <div style={{ marginTop: 6, fontSize: 14 }}>
                        <strong>{r.score_overall.toFixed(1)}</strong> / 10
                        {r.recommendation && <> · {r.recommendation}</>}
                      </div>
                    )}
                    {r.strengths && (
                      <p style={{ margin: "var(--s-2) 0 0", fontSize: 13, lineHeight: 1.55 }}>
                        <span style={{ color: "var(--ink-dim)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 6 }}>
                          Strengths
                        </span>
                        {r.strengths}
                      </p>
                    )}
                    {r.concerns && (
                      <p style={{ margin: "var(--s-2) 0 0", fontSize: 13, lineHeight: 1.55 }}>
                        <span style={{ color: "var(--ink-dim)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 6 }}>
                          Concerns
                        </span>
                        {r.concerns}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            </Collapsible>

            <Collapsible label="Status history" hint={history.length}>
            {loading && !detail ? (
              <div className="inline-loading">Loading…</div>
            ) : history.length === 0 ? (
              <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                No status changes yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
                {history.map((h) => (
                  <li
                    key={h.id || `${h.changed_at}-${h.to_status}`}
                    style={{
                      padding: "var(--s-3) var(--s-4)",
                      background: "var(--paper-soft)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-sharp)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 14 }}>
                        <span style={{ color: "var(--ink-dim)", textTransform: "capitalize" }}>
                          {h.from_status || "—"}
                        </span>
                        <span style={{ margin: "0 8px", color: "var(--ink-dim)" }}>→</span>
                        <strong style={{ textTransform: "capitalize" }}>{h.to_status}</strong>
                      </span>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
                        {fmtDate(h.changed_at)}
                      </span>
                    </div>
                    {h.reason && (
                      <p style={{ margin: "var(--s-2) 0 0", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.55 }}>
                        {h.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            </Collapsible>
          </div>
        </div>

        <footer className="drawer-footer">
          {rejectErr && (
            <span style={{ color: "var(--bad)", fontSize: 12, marginRight: "auto", alignSelf: "center" }}>
              {rejectErr}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleReject}
            disabled={rejecting}
            style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
          >
            {rejecting ? "Rejecting…" : "Reject application"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/leadership/applications/${row.track}/${row.id}/review`)}
          >
            Review application <span className="arrow">→</span>
          </button>
        </footer>
      </div>
    </>
  );
}
