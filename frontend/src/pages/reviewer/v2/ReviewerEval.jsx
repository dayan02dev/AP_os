// Reviewer evaluation screen — ported from REVIEWER-UI/os/reviewer.jsx
// (ReviewerEval loader + ReviewerEvalForm + RubricModal).
//
// Seam wiring (plan Task 12 rule 2):
//   * content  ← reviewerApi.getContent(track, appId)
//                 { id, applicationId, track, name, aiSummary, fields[],
//                   sections[], attachments[], evaluation (raw review row|null),
//                   assignment { assignment_id, assigned_at } }
//   * AI numeric block ← content.ai (the content endpoint serves the full
//                 {overall,conf,problem,solution,tech,founders,commit} block,
//                 or null if the app was never AI-scored). Used for the
//                 AI-baseline panel AND the client-side |score−AI|>1.0
//                 disagreement gate. Sourced from the content response so a
//                 deep link works even when the app isn't in the active queue.
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

import AiSections from "../../../components/AiSections.jsx";
import FullApplication from "../../../components/FullApplication.jsx";
import ProfilePills from "../../../components/ProfilePills.jsx";
import { useAsync } from "../../../hooks/useAsync.js";
import { reviewerApi } from "../../../lib/reviewerApi.js";
import { trackLabel } from "../../../lib/trackLabel.js";
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

// ── Loader ─────────────────────────────────────────────────────────────
export default function ReviewerEval({ track, appId, onBack, onOpen }) {
  const { data: content, loading, error, reload } = useAsync(
    () => reviewerApi.getContent(track, appId),
    [track, appId],
  );
  // AI numeric block is served by the content endpoint itself (content.ai) —
  // no queue lookup, so deep links work regardless of queue membership.
  const aiBlock = content ? content.ai : null;

  // Separate concern: fetch the reviewer's queue ONCE only to resolve the
  // current app's position so the header can offer Prev/Next navigation
  // through the ordered queue. This is intentionally NOT used for the AI block
  // (that stays sourced from content.ai above) — queue rows carry only a
  // summary `ai`, and a deep-linked app may not be in the queue at all.
  const { data: queue } = useAsync(() => reviewerApi.getQueue(), []);
  const neighbors = useMemo(() => {
    if (!queue || !onOpen) return { prev: null, next: null, hasPosition: false };
    // Queue row click opens /reviewer/eval/{track}/{row.id}, so the route
    // appId matches row.id.
    const idx = queue.findIndex((q) => String(q.id) === String(appId));
    if (idx === -1) return { prev: null, next: null, hasPosition: false };
    return {
      prev: idx > 0 ? queue[idx - 1] : null,
      next: idx < queue.length - 1 ? queue[idx + 1] : null,
      hasPosition: true,
    };
  }, [queue, appId, onOpen]);

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
      onPrev={neighbors.prev && onOpen ? () => onOpen(neighbors.prev.track, neighbors.prev.id) : null}
      onNext={neighbors.next && onOpen ? () => onOpen(neighbors.next.track, neighbors.next.id) : null}
      showNav={neighbors.hasPosition}
    />
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
function ReviewerEvalForm({ content, aiBlock, onBack, onPrev, onNext, showNav }) {
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
  // Disagreement reasons are no longer collected in the UI (the backend no
  // longer requires them). The state is retained as a constant `{}`-style value
  // so the eval→payload/patch mapping keeps emitting `disagree_with_ai`.
  const [disagreements] = useState(initial.disagreements);
  const [reviewId, setReviewId] = useState(initial.reviewId);
  const [submitted, setSubmitted] = useState(initial.status === "submitted");
  const [reopened, setReopened] = useState(false);
  const [expiresAt, setExpiresAt] = useState(initial.editWindowExpiresAt);

  // Local UI-only state.
  const [showRubric, setShowRubric] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [viewApp, setViewApp] = useState(false);
  const [flagInput, setFlagInput] = useState("");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [fieldErrors, setFieldErrors] = useState({ notes: false, dimensions: [] });

  const expired = false; // edit lock removed 2026-06-29 — reviewers edit anytime

  const lockedSubmitted = submitted && !reopened;
  const editable = !lockedSubmitted && !expired;

  const setScore = (k) => (v) => setScores((prev) => ({ ...prev, [k]: v }));
  const overall = weightedOverall(scores);

  const addFlag = () => {
    const t = flagInput.trim();
    if (!t || flags.length >= MAX_FLAGS) return;
    setFlags((prev) => [...prev, t]);
    setFlagInput("");
  };
  const removeFlag = (i) => setFlags((prev) => prev.filter((_, j) => j !== i));

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

  // ── Explicit "Save draft" ────────────────────────────────────────────
  // Flushes the current evaluation immediately using the SAME path the
  // debounced autosave uses (POST draft if no review yet, else PATCH).
  // Reuses the shared saveState ("Saving…/✓ Saved") indicator.
  const saveDraftNow = async () => {
    if (!editable || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (!reviewIdRef.current) {
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
      if (err?.status === 409 && err?.details?.review_id) {
        setReviewId(err.details.review_id);
      }
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────
  const validateForSubmit = () => {
    const errs = { notes: false, dimensions: [] };
    if (!notes.trim()) errs.notes = true;
    setFieldErrors(errs);
    return !errs.notes;
  };

  const applyServerError = (err) => {
    if (err?.code === "notes_required") {
      setFieldErrors((p) => ({ ...p, notes: true }));
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
    return (
      <div>
        {/* Pinned below the sticky 60px topbar so the back button stays reachable
            while scrolling, without overlapping the logo / role line. */}
        <div
          style={{
            position: "fixed", top: 60, left: 0, right: 0, zIndex: 29,
            height: 48, boxSizing: "border-box",
            display: "flex", alignItems: "center", padding: "0 20px",
            background: "var(--paper, #fff)",
            borderBottom: "1px solid var(--line, #e3e3e8)",
            boxShadow: "0 2px 8px rgba(15,23,42,0.06)",
          }}
        >
          <button className="os-btn ghost sm" onClick={() => setViewApp(false)}>
            ← Back to evaluation
          </button>
        </div>
        {/* Spacer offsets the fixed back bar so the first section isn't hidden. */}
        <div style={{ height: 48 }} aria-hidden="true" />
        <FullApplication
          track={content.track}
          application={content.application}
          applicationId={content.id}
          signedUrl={(id, path) => reviewerApi.fileSignedUrl(content.track, id, path)}
        />
      </div>
    );
  }

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
          {/* Top line — navigate between applications in the queue. Hidden on
              deep links where the current app isn't in the reviewer's queue. */}
          {showNav && (
            <div className="os-row gap-sm">
              <button className="os-btn ghost sm" onClick={onPrev} disabled={!onPrev}>
                ← Prev application
              </button>
              <button className="os-btn ghost sm" onClick={onNext} disabled={!onNext}>
                Next application →
              </button>
            </div>
          )}
          {/* Bottom line — actions for the current application */}
          <div className="os-row gap-sm" style={{ alignItems: "center" }}>
            <button className="os-btn secondary" onClick={onBack}>↩ My queue</button>
            {editable && saveState !== "idle" && (
              <span className="saved" style={{ opacity: saveState === "saving" ? 0.5 : 1 }}>
                {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ Save failed" : "✓ Saved"}
              </span>
            )}
            {lockedSubmitted ? (
              <>
                <Chip tone="green">Submitted ✓</Chip>
                <button className="os-btn" onClick={reopenForEdit}>Re-open to edit</button>
              </>
            ) : (
              <>
                <button className="os-btn ghost" disabled={!editable} onClick={saveDraftNow}>
                  Save draft
                </button>
                <button
                  className="os-btn"
                  disabled={!editable || !notes.trim()}
                  title={!notes.trim() ? "Add notes to submit" : ""}
                  onClick={submitEval}
                >
                  {submitted ? "Re-submit evaluation →" : "Submit evaluation →"}
                </button>
              </>
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
              <div className="os-row gap-sm" style={{ alignItems: "center" }}>
                <ProfilePills
                  alsoInTrack={content.also_in_track ? trackLabel(content.also_in_track) : null}
                  resumeFile={content.application?.resume_file}
                  linkedinUrl={content.application?.linkedin_url}
                  onOpenResume={async () => {
                    const rf = content.application.resume_file;
                    const { url } = await reviewerApi.fileSignedUrl(
                      content.track, content.id, rf.storage_path,
                    );
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                />
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

              <AiSections variant="dropdown" sections={content.aiSections} />

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

            {DIM_KEYS.map((k) => (
              <div key={k} style={{ marginBottom: 16 }}>
                <Slider
                  label={CRIT_LABELS[k]}
                  kind={k}
                  value={scores[k]}
                  onChange={setScore(k)}
                  disabled={!editable}
                />
              </div>
            ))}

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
