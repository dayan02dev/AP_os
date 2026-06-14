// Reviewer evaluation screen — ported from REVIEWER-UI/os/reviewer.jsx
// (ReviewerEval loader + ReviewerEvalForm + FullApplicationView + RubricModal).
//
// Seam wiring (plan Task 12 rule 2):
//   * content  ← reviewerApi.getContent(track, appId)
//                 { id, applicationId, track, name, aiSummary, fields[],
//                   sections[], attachments[], evaluation (raw review row|null),
//                   assignment { assignment_id, assigned_at } }
//   * AI numeric block ← reviewerApi.getQueue() row matched by appId
//                 (the content endpoint exposes aiSummary but not the numeric
//                 dimension scores; the queue row carries `ai{}`). Used for the
//                 AI-baseline panel AND the client-side |score−AI|>1.0
//                 disagreement gate.
//   * first save  → submitReview({...payload, draft:true})  (POST; captures id)
//   * later saves → patchReview(reviewId, {...patch})        (PATCH)
//   * submit      → patchReview(reviewId, {...patch, draft:false})
//                   (or submitReview({...payload, draft:false}) if no draft yet)
//   * rubric      → reviewerApi.getRubric(track)
//
// Countdown (rule 3): derived from editWindowExpiresAt (server locked_at) vs
// Date.now(), ticking locally. Expired → fields locked, Submit disabled,
// Re-open hidden. No review yet / draft → no lock, fields open.

import { useEffect, useMemo, useRef, useState } from "react";

import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import {
  LoadingState,
  ErrorState,
  Chip,
  ScoreBar,
  Slider,
  CRIT_LABELS,
  DIM_KEYS,
  weightedOverall,
  reviewRowToEvaluation,
  evaluationToPayload,
  evaluationToPatch,
} from "./ui.jsx";

const MAX_FLAGS = 8;
const HIGH_VARIANCE = 1.0;

// ── Loader ─────────────────────────────────────────────────────────────
export default function ReviewerEval({ track, appId, onBack }) {
  const { data: content, loading, error, reload } = useAsync(
    () => reviewerApi.getContent(track, appId),
    [track, appId],
  );
  // AI numeric block lives on the queue row (content has only aiSummary).
  const { data: queue } = useAsync(() => reviewerApi.getQueue(), []);
  const aiBlock = useMemo(() => {
    const row = (queue || []).find((q) => q.id === appId && q.track === track);
    return row ? row.ai : null;
  }, [queue, appId, track]);

  if (loading)
    return (
      <div style={{ padding: "48px 0" }}>
        <LoadingState label="Loading application…" />
      </div>
    );
  if (error)
    return (
      <div style={{ padding: "48px 0" }}>
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  if (!content) return null;

  // Remount per application → isolated form state.
  return (
    <ReviewerEvalForm
      key={track + ":" + appId}
      content={content}
      aiBlock={aiBlock}
      onBack={onBack}
    />
  );
}

// ── Full application view (founder-form style) ──────────────────────────
function FullApplicationView({ content, onBack }) {
  const PURPLE = "#3213b7";
  const eyebrowMono = { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.18em" };
  const pill = {
    fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", fontWeight: 600,
    color: PURPLE, border: "1px solid #ccc2f0", background: "#ece9fb", padding: "4px 11px", borderRadius: 999,
  };
  const answerBox = {
    background: "#fff", border: "1px solid var(--line)", borderRadius: 8,
    padding: "18px 22px", fontSize: 16, lineHeight: 1.62, color: "var(--ink)",
  };
  const sections = (content.sections || []).filter((s) => (s.questions || []).length > 0);
  const total = String(sections.length).padStart(2, "0");

  return (
    <div style={{ maxWidth: 840, margin: "0 auto" }}>
      <div className="os-row between" style={{ marginBottom: 32 }}>
        <button className="os-btn ghost sm" onClick={onBack}>← Back to review</button>
        <span className="os-text-dim os-uppercase" style={{ ...eyebrowMono }}>
          {content.name} · full application
        </span>
      </div>

      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: 56 }}>
          <div className="os-row between" style={{ marginBottom: 18 }}>
            <span style={eyebrowMono}>
              <span style={{ background: "#aafcf0", color: "#3213b7", padding: "2px 7px", fontWeight: 700 }}>SECTION</span>
              <span className="os-text-dim" style={{ marginLeft: 8 }}>{sec.num}</span>
            </span>
            <span className="os-text-dim" style={eyebrowMono}>OF {total}</span>
          </div>

          <div style={{ fontSize: 72, fontWeight: 800, color: PURPLE, lineHeight: 1, fontFamily: "var(--font-display)" }}>
            {sec.num}
          </div>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: "10px 0 0", letterSpacing: "-0.02em", color: "var(--ink)" }}>
            {sec.title}
          </h2>

          <div style={{ marginTop: 24 }}>
            {sec.questions.map((q, qi) => (
              <div key={qi} style={{ borderTop: "1px solid var(--line)", padding: "28px 0" }}>
                <div className="os-row between" style={{ marginBottom: 12 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: PURPLE }}>
                    {String(qi + 1).padStart(2, "0")} →
                  </span>
                </div>
                <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.01em", lineHeight: 1.3, color: "var(--ink)" }}>
                  {q.prompt}
                </h3>
                <div style={{ marginTop: 16 }}>
                  <div style={answerBox}>{q.answer}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {(content.attachments || []).length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div className="ps-group-label">Attachments</div>
          <div className="os-stack gap-sm">
            {content.attachments.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="os-btn secondary"
                style={{ justifyContent: "space-between" }}
              >
                <span>{a.name}</span>
                <span className="os-chip green">{(a.kind || "file").toUpperCase()} ↗</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 28, marginBottom: 48 }}>
        <button className="os-btn" onClick={onBack}>← Back to review</button>
      </div>
    </div>
  );
}

// ── Rubric modal (fed by reviewerApi.getRubric(track)) ──────────────────
function RubricModal({ onClose, track }) {
  const cohort = track === "sip" ? "VIP" : "TIR";
  const { data, loading, error, reload } = useAsync(() => reviewerApi.getRubric(track), [track]);
  // Backend rubric shape (rubric.py): { dimensions: [{ key, name, weight,
  // anchors: { "10": "...", "8": "...", ... } }], notes: [] }. The anchors are
  // an OBJECT keyed by score — normalise to entries sorted high→low here.
  const dims = (data && data.dimensions) || [];
  const notes = (data && data.notes) || [];
  const anchorEntries = (anchors) =>
    Object.entries(anchors || {})
      .map(([score, desc]) => ({ score, desc }))
      .sort((a, b) => Number(b.score) - Number(a.score));

  return (
    <div className="os-modal-backdrop" onClick={onClose}>
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="os-modal-head">
          <div>
            <div className="os-text-xs os-text-dim os-uppercase">{cohort} 2026 rubric</div>
            <div className="os-h1" style={{ fontSize: 22 }}>Reviewer rubric</div>
          </div>
          <button className="os-btn ghost" onClick={onClose}>Close ✕</button>
        </div>
        <div className="os-modal-body">
          {loading && <LoadingState label="Loading rubric…" />}
          {error && <ErrorState error={error} onRetry={reload} />}
          {!loading && !error && (
            <div className="rubric">
              <p className="rubric-intro">Score each dimension 0–10 using the anchors below.</p>
              {dims.map((v) => (
                <div className="rubric-cat" key={v.key || v.name}>
                  <div className="rubric-cat-name">{v.name}</div>
                  <div className="rubric-anchors">
                    {anchorEntries(v.anchors).map((a) => {
                      const n = String(a.score);
                      const tier = +n >= 8 ? "hi" : +n >= 6 ? "mid" : +n >= 4 ? "lo" : "weak";
                      return (
                        <div className="rubric-anchor" key={n}>
                          <span className={"rubric-score rubric-" + tier}>{n}</span>
                          <span className="rubric-desc">{a.desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {notes.length > 0 && (
                <div className="rubric-cat">
                  <div className="rubric-cat-name">Notes</div>
                  <ul className="rubric-notes">
                    {notes.map((nt, i) => <li key={i}>{nt}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Eval form ───────────────────────────────────────────────────────────
function ReviewerEvalForm({ content, aiBlock, onBack }) {
  // The application object the form reads from. We adapt the content payload
  // to the fields the prototype referenced (name/track/id/assignmentId for the
  // payload; sections/attachments for the full view; ai for the baseline panel).
  const application = {
    id: content.id,
    applicationId: content.applicationId,
    track: content.track,
    assignmentId: content.assignment?.assignment_id,
    name: content.name,
  };

  const initial = reviewRowToEvaluation(content.evaluation);

  const [scores, setScores] = useState(initial.scores);
  const [reco, setReco] = useState(initial.recommendation);
  const [notes, setNotes] = useState(initial.notes);
  const [flags, setFlags] = useState(initial.flags);
  const [disagreements, setDisagreements] = useState(initial.disagreements);
  const [reviewId, setReviewId] = useState(initial.reviewId);
  const [submitted, setSubmitted] = useState(initial.status === "submitted");
  const [reopened, setReopened] = useState(false);
  const [expiresAt, setExpiresAt] = useState(initial.editWindowExpiresAt);

  // Local UI-only state.
  const [showRubric, setShowRubric] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [secOpen, setSecOpen] = useState({});
  const [viewApp, setViewApp] = useState(false);
  const [flagInput, setFlagInput] = useState("");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [fieldErrors, setFieldErrors] = useState({ notes: false, dimensions: [] });

  // Countdown — only meaningful once a review is locked (submitted_at stamped).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const expiryMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const secondsLeft = expiryMs ? Math.max(0, Math.floor((expiryMs - now) / 1000)) : null;
  const expired = expiryMs != null && now > expiryMs;

  const lockedSubmitted = submitted && !reopened;
  const editable = !lockedSubmitted && !expired;

  const setScore = (k) => (v) => setScores((prev) => ({ ...prev, [k]: v }));
  const setDisagreement = (k) => (e) =>
    setDisagreements((prev) => ({ ...prev, [k]: e.target.value }));
  const overall = weightedOverall(scores);

  const addFlag = () => {
    const t = flagInput.trim();
    if (!t || flags.length >= MAX_FLAGS) return;
    setFlags((prev) => [...prev, t]);
    setFlagInput("");
  };
  const removeFlag = (i) => setFlags((prev) => prev.filter((_, j) => j !== i));

  // Dimensions where |reviewer − AI| > 1.0 (need a written reason on submit).
  const highVarianceDims = useMemo(() => {
    if (!aiBlock) return [];
    return DIM_KEYS.filter((k) => {
      const av = aiBlock[k];
      const rv = scores[k];
      return typeof av === "number" && typeof rv === "number" && Math.abs(rv - av) > HIGH_VARIANCE;
    });
  }, [aiBlock, scores]);

  const currentEval = { scores, recommendation: reco, notes, flags, disagreements };

  // ── Autosave (debounced 800 ms) ──────────────────────────────────────
  const firstRun = useRef(true);
  const reviewIdRef = useRef(reviewId);
  reviewIdRef.current = reviewId;
  const savingRef = useRef(false);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    if (!editable) return undefined;
    setSaveState("saving");
    const t = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        if (!reviewIdRef.current) {
          // No draft yet → POST a draft and capture the new review id.
          const res = await reviewerApi.submitReview(
            evaluationToPayload(currentEval, { application, draft: true }),
          );
          const newId = res?.review?.id;
          if (newId) setReviewId(newId);
        } else {
          await reviewerApi.patchReview(
            reviewIdRef.current,
            evaluationToPatch(currentEval, {}),
          );
        }
        setSaveState("saved");
      } catch (err) {
        // A draft already exists (e.g. created in another tab) — recover its id
        // from the 409 body and switch to PATCH on the next save.
        if (err?.status === 409 && err?.details?.review_id) {
          setReviewId(err.details.review_id);
        }
        setSaveState("error");
      } finally {
        savingRef.current = false;
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, reco, notes, flags, disagreements, editable]);

  // ── Submit ───────────────────────────────────────────────────────────
  const validateForSubmit = () => {
    const errs = { notes: false, dimensions: [] };
    if (!notes.trim()) errs.notes = true;
    for (const k of highVarianceDims) {
      if (!(disagreements[k] || "").trim()) errs.dimensions.push(k);
    }
    setFieldErrors(errs);
    return !errs.notes && errs.dimensions.length === 0;
  };

  const applyServerError = (err) => {
    if (err?.code === "notes_required") {
      setFieldErrors((p) => ({ ...p, notes: true }));
    } else if (err?.code === "disagreement_reason_required") {
      const dims = (err.details && err.details.dimensions) || [];
      setFieldErrors((p) => ({ ...p, dimensions: dims }));
    } else if (err?.status === 423 || err?.code === "review_locked") {
      // Edit window closed server-side — lock the UI.
      setExpiresAt((cur) => cur || new Date(Date.now() - 1000).toISOString());
    }
  };

  const submitEval = async () => {
    if (!validateForSubmit()) return;
    setSaveState("saving");
    try {
      if (reviewId) {
        const res = await reviewerApi.patchReview(
          reviewId,
          evaluationToPatch(currentEval, { draft: false }),
        );
        if (res?.editWindowExpiresAt) setExpiresAt(res.editWindowExpiresAt);
      } else {
        const res = await reviewerApi.submitReview(
          evaluationToPayload(currentEval, { application, draft: false }),
        );
        if (res?.review?.id) setReviewId(res.review.id);
        if (res?.editWindowExpiresAt) setExpiresAt(res.editWindowExpiresAt);
      }
      setSubmitted(true);
      setReopened(false);
      setSaveState("saved");
      setFieldErrors({ notes: false, dimensions: [] });
    } catch (err) {
      setSaveState("error");
      // If a draft already exists, retry the submit as a PATCH on its id.
      if (err?.status === 409 && err?.details?.review_id) {
        const id = err.details.review_id;
        setReviewId(id);
        try {
          const res = await reviewerApi.patchReview(id, evaluationToPatch(currentEval, { draft: false }));
          if (res?.editWindowExpiresAt) setExpiresAt(res.editWindowExpiresAt);
          setSubmitted(true);
          setReopened(false);
          setSaveState("saved");
          setFieldErrors({ notes: false, dimensions: [] });
          return;
        } catch (err2) {
          applyServerError(err2);
          return;
        }
      }
      applyServerError(err);
    }
  };

  const reopenForEdit = () => setReopened(true);

  if (viewApp) {
    return <FullApplicationView content={content} onBack={() => setViewApp(false)} />;
  }

  const longFields = (content.fields || []).filter((f) => Array.isArray(f.bullets));
  const factFields = (content.fields || []).filter((f) => !Array.isArray(f.bullets));

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBack();
              }}
              style={{ color: "#4a4a52", textDecoration: "none" }}
            >
              My queue
            </a>
            <span style={{ margin: "0 8px", color: "#c8c8d0" }}>/</span>
            <span style={{ color: "#8a8a92" }}>{application.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>R-2 · ACTIVE EVALUATION</span>
          <h2 className="lp-section-title">
            {application.name} <span className="lp-muted">· scoring</span>
          </h2>
          <div className="lp-section-sub">
            Read the application, then score each dimension 0–10. Notes are required to submit.
          </div>
        </div>
        <div className="lp-section-actions">
          <div className="os-row gap-sm" style={{ alignItems: "center" }}>
            <button className="os-btn secondary" onClick={onBack}>↩ My queue</button>
            {editable && saveState !== "idle" && (
              <span className="saved" style={{ opacity: saveState === "saving" ? 0.5 : 1 }}>
                {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ Save failed" : "✓ Saved"}
              </span>
            )}
            {secondsLeft != null && (
              <div className={"lp-edit-chip " + (secondsLeft < 600 ? "red" : "amber")}>
                <span className="lp-edit-dot" />
                {expired ? "Edit window closed" : `Edit window: ${Math.floor(secondsLeft / 60)} min remaining`}
              </div>
            )}
            {lockedSubmitted ? (
              <>
                <Chip tone="green">Submitted ✓</Chip>
                {!expired && (
                  <button className="os-btn" onClick={reopenForEdit}>Re-open to edit</button>
                )}
              </>
            ) : (
              <button
                className="os-btn"
                disabled={!editable || !notes.trim()}
                title={!notes.trim() ? "Add notes to submit" : ""}
                onClick={submitEval}
              >
                {submitted ? "Re-submit evaluation →" : "Submit evaluation →"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        {/* LEFT — application */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Application · {application.name}</div>
              <div className="os-row gap-sm">
                <Chip>{application.track === "tir" ? "TIR" : "VIP"}</Chip>
              </div>
            </div>
            <div className="os-stack">
              {content.aiSummary && (
                <div className="ps-ai-summary">
                  <div className="ps-ai-label">AI summary</div>
                  <p className="ps-ai-text">{content.aiSummary}</p>
                </div>
              )}

              <div>
                <div className="ps-group-label">Application detail</div>

                {factFields.length > 0 && (
                  <div className="ps-facts">
                    {factFields.map((f, i) => (
                      <div className="ps-fact" key={i}>
                        <span className="ps-fact-label">{f.label}</span>
                        <span className="ps-fact-value">{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ps-sections">
                  {longFields.map((f, i) => {
                    const open = f.label in secOpen ? secOpen[f.label] : i === 0;
                    const pts = f.bullets || [];
                    return (
                      <div className={"ps-sec" + (open ? " is-open" : "")} key={i}>
                        <button
                          className="ps-sec-head"
                          aria-expanded={open}
                          onClick={() => setSecOpen((prev) => ({ ...prev, [f.label]: !open }))}
                        >
                          <span className="ps-sec-chev">{open ? "▾" : "▸"}</span>
                          <span className="ps-sec-label">{f.label}</span>
                          <span className="ps-sec-hint">{open ? "" : pts.length + " points"}</span>
                        </button>
                        {open && (
                          <ul className="ps-bullets">
                            {pts.map((b, j) => (
                              <li key={j}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <hr className="os-divider" />

              <button className="os-btn secondary os-w-100" onClick={() => setViewApp(true)}>
                View full application →
              </button>
            </div>
          </div>

          {aiBlock && (
            <div className="os-card soft">
              <div className="os-row between os-mb-sm">
                <div className="os-card-title">AI baseline (for reference only)</div>
                <button
                  className={"os-btn sm " + (showAi ? "ghost" : "highlight")}
                  onClick={() => setShowAi(!showAi)}
                >
                  {showAi ? "Hide AI Scores" : "Show AI Scores"}
                </button>
              </div>
              {showAi ? (
                <div className="os-row gap-lg">
                  <div
                    className="os-num-big"
                    style={{ fontSize: 36, fontFamily: "var(--font-sans)", fontWeight: 800, letterSpacing: "-0.02em", color: "#242424" }}
                  >
                    {aiBlock.overall != null ? Number(aiBlock.overall).toFixed(1) : "—"}
                  </div>
                  <div style={{ flex: 1 }}>
                    {DIM_KEYS.map((k) =>
                      typeof aiBlock[k] === "number" ? (
                        <ScoreBar key={k} label={CRIT_LABELS[k]} kind={k} value={aiBlock[k]} />
                      ) : null,
                    )}
                  </div>
                </div>
              ) : (
                <div className="os-text-sm os-text-dim">
                  AI scores are hidden. Click “Show AI Scores” to reveal them.
                </div>
              )}
              <div className="os-text-xs os-text-dim os-mt-sm">
                AI is a baseline. Score independently — variance is expected and welcome.
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — scoring */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Your scores</div>
              <button className="os-btn sm ghost" onClick={() => setShowRubric(true)}>Open rubric →</button>
            </div>

            {DIM_KEYS.map((k) => {
              const isHigh = highVarianceDims.includes(k);
              const needsReason = isHigh && fieldErrors.dimensions.includes(k);
              return (
                <div key={k} style={{ marginBottom: 16 }}>
                  <Slider
                    label={CRIT_LABELS[k]}
                    kind={k}
                    value={scores[k]}
                    onChange={setScore(k)}
                    disabled={!editable}
                  />
                  {isHigh && (
                    <div style={{ marginTop: 6 }}>
                      <input
                        className="os-input"
                        style={{
                          width: "100%",
                          fontSize: 12,
                          borderColor: needsReason ? "var(--bad)" : undefined,
                        }}
                        placeholder={`Your score differs from AI by >1 — explain why (${CRIT_LABELS[k]})`}
                        value={disagreements[k] || ""}
                        onChange={setDisagreement(k)}
                        disabled={!editable}
                      />
                      {needsReason && (
                        <div className="os-text-xs" style={{ color: "var(--bad)", marginTop: 3 }}>
                          A reason is required when your score differs from AI by more than 1.0.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <hr className="os-divider" />

            <div className="os-row between">
              <span className="os-text-xs os-text-dim os-uppercase">Your overall</span>
              <span
                className="os-num-big"
                style={{ fontSize: 34, fontFamily: "var(--font-sans)", fontWeight: 800, letterSpacing: "-0.02em", color: "#3213b7" }}
              >
                {overall.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Recommendation</div>
            <div className="os-reco-group">
              <button className={"os-reco-btn yes " + (reco === "yes" ? "active" : "")} disabled={!editable} onClick={() => setReco("yes")}>
                YES
              </button>
              <button className={"os-reco-btn maybe " + (reco === "maybe" ? "active" : "")} disabled={!editable} onClick={() => setReco("maybe")}>
                MAYBE
              </button>
              <button className={"os-reco-btn no " + (reco === "no" ? "active" : "")} disabled={!editable} onClick={() => setReco("no")}>
                NO
              </button>
            </div>
          </div>

          <div className="os-card">
            <div className="os-row between os-mb-sm" style={{ alignItems: "center" }}>
              <div className="os-card-title">
                Notes{" "}
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600, color: "var(--artblue)" }}>
                  (required)
                </span>
              </div>
            </div>
            <textarea
              className="notes-area"
              placeholder="What stood out in your assessment? Key strengths, concerns, or context behind your scores."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!editable}
              style={fieldErrors.notes ? { borderColor: "var(--bad)" } : undefined}
            />
            <div
              className="os-text-xs os-mt-sm"
              style={{ color: notes.trim() && !fieldErrors.notes ? "var(--ink-dim)" : "var(--artblue)" }}
            >
              {notes.trim() ? "Saved automatically as you type." : "Notes are required before you can submit."}
            </div>
          </div>

          <div className="os-card soft">
            <div className="os-row between os-mb-sm">
              <div className="os-card-title">Risk flags raised</div>
              <span className="os-text-xs os-text-dim">
                {flags.length} / {MAX_FLAGS}
              </span>
            </div>
            <div className="os-stack gap-sm">
              {flags.length === 0 && <div className="os-text-sm os-text-dim">No flags raised yet.</div>}
              {flags.map((f, i) => (
                <div key={i} className="os-row gap-sm" style={{ alignItems: "center" }}>
                  <span className="os-chip amber">⚐</span>
                  <span className="os-text-sm" style={{ flex: 1 }}>{f}</span>
                  {editable && (
                    <button
                      className="os-btn sm ghost"
                      style={{ padding: "2px 8px", lineHeight: 1 }}
                      title="Remove flag"
                      onClick={() => removeFlag(i)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {editable && flags.length < MAX_FLAGS ? (
                <div className="os-row gap-sm os-mt-sm" style={{ alignItems: "center" }}>
                  <input
                    className="os-input"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder="Add a short risk flag…"
                    maxLength={80}
                    value={flagInput}
                    onChange={(e) => setFlagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addFlag();
                      }
                    }}
                  />
                  <button className="os-btn sm ghost" onClick={addFlag} disabled={!flagInput.trim()}>
                    + Add flag
                  </button>
                </div>
              ) : flags.length >= MAX_FLAGS ? (
                <div className="os-text-xs os-text-dim os-mt-sm">Maximum of {MAX_FLAGS} flags reached.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showRubric && <RubricModal onClose={() => setShowRubric(false)} track={application.track} />}
    </div>
  );
}
