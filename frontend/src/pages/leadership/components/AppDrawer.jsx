// AppDrawer — slide-in detail view for one application.
// On open, renders header info from the row immediately, then fetches
// GET /leadership/applications/{id} for full detail (ai_screening, reviews,
// reviewer_assignments, status_history). The action buttons at the bottom
// are visible but no-op — Session 6 wires them.

import { useEffect, useRef, useState } from "react";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import ComponentBars from "./ComponentBars.jsx";
import StatusChip from "./StatusChip.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

function SectionTitle({ children }) {
  return <h4 className="lp-drawer-section-title eir-mono">{children}</h4>;
}

function renderProblemSolution(application) {
  if (!application) return null;
  // tir_applications uses problem_*/solution_* prefixes; sip_applications uses
  // its own. We render whatever non-null fields show up under those prefixes.
  const fields = Object.entries(application).filter(
    ([k, v]) =>
      typeof v === "string" &&
      v.trim() !== "" &&
      (k.startsWith("problem_") || k.startsWith("solution_"))
  );
  if (fields.length === 0) {
    return (
      <p className="lp-drawer-empty eir-mono">
        No problem/solution text on file yet.
      </p>
    );
  }
  return (
    <div className="lp-drawer-section-body">
      {fields.map(([k, v]) => (
        <p key={k}>
          <span className="eir-mono eir-dim" style={{ display: "block", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
            {k.replaceAll("_", " ")}
          </span>
          {v}
        </p>
      ))}
    </div>
  );
}

function noopAction() {
  alert("This action is wired in Session 6.");
}

export default function AppDrawer({ row, onClose, statusLabelById }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!row) return undefined;
    let cancelled = false;
    setDetail(null);
    setError(null);
    setLoading(true);
    leadershipApi
      .getApplication(row.id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load application detail.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  // Modal a11y: Escape closes, body scroll is locked while drawer is mounted,
  // and initial focus lands on the panel so keyboard users aren't stranded.
  useEffect(() => {
    if (!row) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [row, onClose]);

  if (!row) return null;

  const application = detail?.application || null;
  const aiScreening = detail?.ai_screening || null;
  const reviews = detail?.reviews || [];
  const assignments = detail?.reviewer_assignments || [];
  const history = detail?.status_history || [];

  const statusLabel = statusLabelById?.[row.status] || row.status;
  const fullName = application?.basic_full_name || row.basic_full_name || "—";
  const email = application?.basic_email || row.basic_email || "";
  const org = application?.basic_org || row.basic_org || "";
  const phone = application?.basic_phone || "";

  return (
    <div className="lp-drawer-back" onClick={onClose}>
      <div
        className="lp-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-drawer-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="lp-drawer-head">
          <div>
            <div className="eir-mono eir-dim">
              {row.id?.slice(0, 8)} · {(row.track || "").toUpperCase()}
            </div>
            <h3 className="lp-drawer-title" id="lp-drawer-title">{fullName}</h3>
            <div className="eir-mono eir-dim">
              {org ? `${org} · ` : ""}
              {email}
            </div>
          </div>
          <button
            type="button"
            className="lp-drawer-close eir-mono"
            onClick={onClose}
          >
            close ×
          </button>
        </div>

        <div className="lp-drawer-meta">
          <div>
            <span>Track</span>
            <div>{(row.track || "").toUpperCase()}</div>
          </div>
          <div>
            <span>Industry</span>
            <div>{row.industry?.label || "—"}</div>
          </div>
          <div>
            <span>Submitted</span>
            <div>{fmtDate(row.submitted_at || row.created_at)}</div>
          </div>
          <div>
            <span>Status</span>
            <div>
              <StatusChip statusId={row.status} statusLabel={statusLabel} />
            </div>
          </div>
        </div>

        {error && <div className="lp-error">Error: {error}</div>}

        <div className="lp-drawer-section">
          <SectionTitle>Applicant</SectionTitle>
          <div className="lp-drawer-section-body">
            <p>
              <strong>{fullName}</strong>
              <br />
              {email && (
                <>
                  <span className="eir-mono eir-dim">{email}</span>
                  <br />
                </>
              )}
              {phone && <span className="eir-mono eir-dim">{phone}</span>}
              {!phone && !email && <span className="eir-dim">No contact info on file.</span>}
            </p>
            {loading && !application && (
              <div className="lp-loading">loading detail…</div>
            )}
          </div>
        </div>

        <div className="lp-drawer-section">
          <SectionTitle>Problem &amp; Solution</SectionTitle>
          {loading && !application ? (
            <div className="lp-loading">loading…</div>
          ) : (
            renderProblemSolution(application)
          )}
        </div>

        <div className="lp-drawer-section lp-drawer-score">
          <div className="lp-drawer-score-head">
            <span className="eir-mono eir-dim">AI score</span>
            {aiScreening?.score_overall != null ? (
              <span className="lp-drawer-score-n">
                {aiScreening.score_overall.toFixed(1)}
                <span className="eir-dim">/10</span>
              </span>
            ) : (
              <span className="eir-mono eir-dim">—</span>
            )}
          </div>
          {loading && !detail ? (
            <div className="lp-loading">loading score…</div>
          ) : aiScreening ? (
            <>
              <ComponentBars scores={aiScreening} />
              {aiScreening.summary && (
                <p className="lp-drawer-section-body" style={{ marginTop: 8 }}>
                  <span
                    className="eir-mono eir-dim"
                    style={{
                      display: "block",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Summary
                  </span>
                  {aiScreening.summary}
                </p>
              )}
            </>
          ) : (
            <p className="lp-drawer-empty eir-mono">
              Not scored yet — AI screening hasn&rsquo;t completed for this
              application.
            </p>
          )}
        </div>

        <div className="lp-drawer-section">
          <SectionTitle>Reviews ({reviews.length})</SectionTitle>
          {loading && !detail ? (
            <div className="lp-loading">loading…</div>
          ) : reviews.length === 0 ? (
            <p className="lp-drawer-empty eir-mono">No reviews yet.</p>
          ) : (
            <ul className="lp-drawer-list">
              {reviews.map((r) => (
                <li className="lp-drawer-list-item" key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}>
                  <div className="lp-drawer-list-item-head">
                    <span className="eir-mono">
                      reviewer · {r.reviewer_user_id?.slice(0, 8) || "—"}
                    </span>
                    <span className="eir-mono eir-dim">
                      {fmtDate(r.submitted_at)}
                    </span>
                  </div>
                  <div>
                    <strong>{r.score_overall != null ? r.score_overall.toFixed(1) : "—"}</strong>
                    /10
                    {r.recommendation && <> · {r.recommendation}</>}
                  </div>
                  {r.strengths && <p style={{ margin: "4px 0 0" }}>Strengths: {r.strengths}</p>}
                  {r.concerns && <p style={{ margin: "4px 0 0" }}>Concerns: {r.concerns}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lp-drawer-section">
          <SectionTitle>Reviewer assignments ({assignments.length})</SectionTitle>
          {loading && !detail ? (
            <div className="lp-loading">loading…</div>
          ) : assignments.length === 0 ? (
            <p className="lp-drawer-empty eir-mono">No reviewers assigned yet.</p>
          ) : (
            <ul className="lp-drawer-list">
              {assignments.map((a) => (
                <li className="lp-drawer-list-item" key={a.id || `${a.reviewer_user_id}-${a.assigned_at}`}>
                  <div className="lp-drawer-list-item-head">
                    <span className="eir-mono">
                      reviewer · {a.reviewer_user_id?.slice(0, 8) || "—"}
                    </span>
                    <span className="eir-mono eir-dim">
                      assigned {fmtDate(a.assigned_at)}
                    </span>
                  </div>
                  <div className="eir-mono eir-dim">
                    {a.declined_at && <>declined {fmtDate(a.declined_at)} · </>}
                    {a.completed_at && <>completed {fmtDate(a.completed_at)}</>}
                    {!a.declined_at && !a.completed_at && <>in progress</>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lp-drawer-section">
          <SectionTitle>Status history ({history.length})</SectionTitle>
          {loading && !detail ? (
            <div className="lp-loading">loading…</div>
          ) : history.length === 0 ? (
            <p className="lp-drawer-empty eir-mono">No status changes yet.</p>
          ) : (
            <ul className="lp-drawer-list">
              {history.map((h) => (
                <li className="lp-drawer-list-item" key={h.id || `${h.changed_at}-${h.to_status}`}>
                  <div className="lp-drawer-list-item-head">
                    <span className="eir-mono">
                      {h.from_status || "∅"} → <strong>{h.to_status}</strong>
                    </span>
                    <span className="eir-mono eir-dim">
                      {fmtDate(h.changed_at)}
                    </span>
                  </div>
                  {h.reason && <div>Reason: {h.reason}</div>}
                  {h.changed_by && (
                    <div className="eir-mono eir-dim">
                      by {h.changed_by.slice(0, 8)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lp-drawer-actions">
          <button
            type="button"
            className="lp-drawer-action-btn is-primary"
            onClick={noopAction}
          >
            Change status
          </button>
          <button
            type="button"
            className="lp-drawer-action-btn"
            onClick={noopAction}
          >
            Assign reviewer
          </button>
          <button
            type="button"
            className="lp-drawer-action-btn"
            onClick={noopAction}
          >
            View scoring
          </button>
          <p className="lp-drawer-actions-hint">
            (Session 6 wires these actions)
          </p>
        </div>
      </div>
    </div>
  );
}
