// AdminVipAirDetail — one AIR round (spec §7: "opening a lever"): the three
// answers, ticked criteria and evidence (behind a signed URL) per lever, a
// verify-or-downgrade control per lever, and a "confirm all at claimed"
// action for the common case.
//
// verified_level is constrained client-side to 1..claimed_level (the
// <select> never renders an option above claimed) as a first line of
// defence; the backend still enforces the same rule server-side
// (422 verified_level_out_of_range) and that failure is mapped to real copy
// too, since the constraint alone cannot cover every path (e.g. a stale
// claimed_level after a concurrent edit).
//
// Verifying the assessment's last still-unverified lever flips it to
// `verified` and publishes the rollups (services/admin_vip_query.
// _finalize_if_complete) — that consequence is surfaced as a banner BEFORE
// the verifier acts, computed purely from this bundle's own lever list, no
// extra request needed.

import React, { useState } from "react";
import { adminVipApi } from "../../../../lib/adminVipApi.js";
import { useAsync } from "../ui.jsx";
import { LoadingState, ErrorState } from "../ui.jsx";
import { PageHead } from "../shell/osAtoms";
import { formatDateTime, levelText, vipErrorInfo } from "./vipCohortHelpers.js";

function bytesText(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function RollupTile({ label, claimed, verified }) {
  return (
    <div className="vipc-rollup-tile">
      <div className="lbl">{label}</div>
      <div>
        <span className="val">{levelText(verified)}</span>
        <span className="ghost">claimed {levelText(claimed)}</span>
      </div>
    </div>
  );
}

function QuestionAnswer({ question, optionId }) {
  if (!question) return null;
  const opt = optionId ? (question.options || []).find((o) => o.id === optionId) : null;
  return (
    <div className="vipc-answer-row">
      <div className="vipc-answer-q">{question.text}</div>
      {opt ? (
        <div className="vipc-answer-opt"><span className="lvl">AIR {opt.level}</span>{opt.text}</div>
      ) : (
        <div className="vipc-answer-opt os-text-dim">Not answered.</div>
      )}
    </div>
  );
}

function LeverCard({ lever, catalog, canWrite, roundOpen, assessmentId, onVerified }) {
  const questions = catalog.questions?.[lever.lever] || [];
  const [level, setLevel] = useState(String(lever.verified_level ?? lever.claimed_level ?? ""));
  const [note, setNote] = useState(lever.verifier_note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const isVerified = lever.verified_level != null;
  const options = [];
  for (let n = lever.claimed_level || 0; n >= 1; n -= 1) options.push(n);

  const submit = async () => {
    if (busy || !level) return;
    setBusy(true); setErr(null);
    try {
      await adminVipApi.verifyLever(assessmentId, lever.lever, {
        verified_level: Number(level),
        verifier_note: note.trim() ? note.trim() : null,
      });
      onVerified();
    } catch (e) {
      setErr(vipErrorInfo(e).message);
      setBusy(false);
    }
  };

  return (
    <div className="vipc-lever-card">
      <div className="vipc-lever-head">
        <div>
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>{lever.name}</div>
          <div className="os-text-xs os-text-dim">{lever.family === "technology" ? "Technology" : "Commercial"}</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="os-text-sm"><span className="os-text-dim">Claimed</span> <b>{levelText(lever.claimed_level)}</b></div>
          <div className="os-text-sm">
            <span className="os-text-dim">Verified</span>{" "}
            <b>{isVerified ? levelText(lever.verified_level) : "—"}</b>
          </div>
        </div>
      </div>
      <div className="vipc-lever-body">
        {["q1", "q2", "q3"].map((qid, i) => (
          <QuestionAnswer key={qid} question={questions[i]} optionId={lever[`${qid}_option`]} />
        ))}

        {lever.criteria && lever.criteria.length > 0 && (
          <div>
            <div className="vipc-answer-q" style={{ marginBottom: 6 }}>Measurement criteria — claimed level</div>
            <ul className="vipc-criteria-list">
              {lever.criteria.map((c) => {
                const checked = (lever.criteria_checked || []).includes(c);
                return (
                  <li key={c} className={"vipc-criteria-item" + (checked ? " checked" : "")}>
                    <span className="mark">{checked ? "✓" : "—"}</span>{c}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {lever.evidence && lever.evidence.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="vipc-answer-q">Evidence</div>
            {lever.evidence.map((e) => (
              <div key={e.id} className="vipc-evidence-item">
                <div>
                  {e.doc_label && <div className="os-text-xs os-text-dim">{e.doc_label}</div>}
                  {e.signed_url ? (
                    <a className="nm" style={{ cursor: "pointer" }} href={e.signed_url} target="_blank" rel="noopener noreferrer">
                      {e.filename}
                    </a>
                  ) : (
                    <span>{e.filename}</span>
                  )}
                  <div className="os-text-xs os-text-dim">{bytesText(e.size_bytes)} · {formatDateTime(e.uploaded_at)}</div>
                </div>
                {!e.signed_url && (
                  <span className="os-text-xs" style={{ color: "var(--bad)" }}>Link unavailable — retry</span>
                )}
              </div>
            ))}
          </div>
        )}

        {canWrite && roundOpen && lever.claimed_level != null && (
          <div className="vipc-verify-form">
            <div>
              <label htmlFor={`level-${lever.lever}`}>Verified level — {lever.name}</label>
              <select
                id={`level-${lever.lever}`}
                aria-label={`Verified level — ${lever.name}`}
                className="os-input"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {options.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor={`note-${lever.lever}`}>Verifier note — {lever.name}</label>
              <input
                id={`note-${lever.lever}`}
                aria-label={`Verifier note — ${lever.name}`}
                className="os-input os-w-100"
                placeholder="Optional — required in spirit for a downgrade"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button
              className="os-btn sm"
              style={{ background: "#3213b7", color: "#fff" }}
              aria-label={`Verify lever — ${lever.name}`}
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Saving…" : isVerified ? "Update verification" : "Verify lever"}
            </button>
          </div>
        )}
        {err && <div className="vipc-banner error">{err}</div>}
      </div>
    </div>
  );
}

function ConfirmAllModal({ hasExistingDecisions, onClose, onConfirm, busy, error }) {
  return (
    <div className="os-modal-backdrop" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4 }}>
        <div className="os-modal-head" style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Confirm all at claimed</div>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="os-text-sm">
            This confirms every lever of this round at its own claimed level.
          </div>
          {hasExistingDecisions && (
            <div className="vipc-banner warn">
              This will overwrite the verification decision(s) already made on this round —
              including any downgrade — with each lever's claimed level.
            </div>
          )}
          {error && <div className="vipc-banner error">{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={onConfirm} disabled={busy}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminVipAirDetail({ assessmentId, canWrite, onBack, onChanged }) {
  const { data, loading, error, reload } = useAsync(
    () => adminVipApi.getAirAssessment(assessmentId), [assessmentId],
  );
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState(null);

  if (loading) return <LoadingState label="Loading this AIR round…" />;
  if (error) {
    return (
      <div>
        <PageHead breadcrumb={[{ label: "AIR verification queue", onClick: onBack }]} eyebrow="VIP COHORT · AIR" title="Round" />
        <ErrorState error={{ message: vipErrorInfo(error).message }} onRetry={reload} />
      </div>
    );
  }

  const { catalog, round, levers, rollups, startup } = data;
  const verifiedCount = levers.filter((l) => l.verified_level != null).length;
  const remaining = levers.length - verifiedCount;
  const roundOpen = round.status === "submitted";
  const hasExistingDecisions = verifiedCount > 0;

  const onVerified = () => { reload(); onChanged?.(); };

  const confirmAll = async () => {
    setConfirmBusy(true); setConfirmErr(null);
    try {
      await adminVipApi.confirmAllLevers(assessmentId);
      setConfirmAllOpen(false);
      onVerified();
    } catch (e) {
      setConfirmErr(vipErrorInfo(e).message);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div>
      <PageHead
        breadcrumb={[{ label: "AIR verification queue", onClick: onBack }]}
        eyebrow="VIP COHORT · AIR"
        title={startup}
        sub={`${round.round_label} · Submitted ${formatDateTime(round.submitted_at)}`}
        actions={roundOpen && canWrite ? [
          <button key="confirm-all" className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={() => setConfirmAllOpen(true)}>
            Confirm all at claimed
          </button>,
        ] : undefined}
      />

      {round.status === "verified" && (
        <div className="vipc-banner info">
          This round is fully verified. Its rollups are published and no further changes are accepted here.
        </div>
      )}
      {roundOpen && remaining === 1 && (
        <div className="vipc-banner warn">
          One lever left. Verifying it will complete this round — status flips to Verified and the rollups publish.
        </div>
      )}

      <div className="vipc-rollup-row">
        <RollupTile label="Technology" claimed={rollups.claimed.technology} verified={rollups.verified.technology} />
        <RollupTile label="Commercial" claimed={rollups.claimed.commercial} verified={rollups.verified.commercial} />
        <RollupTile label="Overall" claimed={rollups.claimed.overall} verified={rollups.verified.overall} />
      </div>

      {levers.map((l) => (
        <LeverCard
          key={l.lever}
          lever={l}
          catalog={catalog}
          canWrite={canWrite}
          roundOpen={roundOpen}
          assessmentId={assessmentId}
          onVerified={onVerified}
        />
      ))}

      {confirmAllOpen && (
        <ConfirmAllModal
          hasExistingDecisions={hasExistingDecisions}
          busy={confirmBusy}
          error={confirmErr}
          onClose={() => { setConfirmAllOpen(false); setConfirmErr(null); }}
          onConfirm={confirmAll}
        />
      )}
    </div>
  );
}

export default AdminVipAirDetail;
