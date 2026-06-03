import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { reviewerApiV2 } from "../../lib/reviewerApiV2.js";
import { useAsync } from "./components/useAsync.js";
import { LoadingState, ErrorState, Chip } from "./components/atoms.jsx";
import ScoreBar from "./components/ScoreBar.jsx";
import Slider from "./components/Slider.jsx";
import FullApplicationView from "./components/FullApplicationView.jsx";
import { RUBRIC, RUBRIC_COMPACT, RUBRIC_VERSION } from "./data/rubric.js";

const CRIT_LABELS = {
  problem:  "Problem Statement Impact and Importance",
  solution: "Completeness, Depth of Solution",
  tech:     "Technical Depth",
  founders: "Professional Profile of Founder",
  commit:   "Commitment to be fully available",
};

// ── Rubric modal (hardcoded, Q5) ──────────────────────────────────────────
function RubricModal({ onClose, track }) {
  const cohort = track === "sip" ? "VIP" : "TIR";
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
          <div className="rubric">
            <p className="rubric-intro">Score each dimension 0–10 using the anchors below.</p>
            {Object.entries(RUBRIC).map(([k, v]) => (
              <div className="rubric-cat" key={k}>
                <div className="rubric-cat-name">{v.name}</div>
                <div className="rubric-anchors">
                  {v.anchors.map(([n, d]) => {
                    const tier = +n >= 8 ? "hi" : +n >= 6 ? "mid" : +n >= 4 ? "lo" : "weak";
                    return (
                      <div className="rubric-anchor" key={n}>
                        <span className={"rubric-score rubric-" + tier}>{n}</span>
                        <span className="rubric-desc">{d}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="rubric-cat">
              <div className="rubric-cat-name">Notes</div>
              <ul className="rubric-notes">
                <li>Score independently of the AI baseline.</li>
                <li>Notes are recommended — capture what stood out.</li>
                <li>Flag any inconsistency you spot — admin will reconcile.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rubric download helper ────────────────────────────────────────────────
function downloadRubricMd() {
  let md = `# scoring.md — TIR 2026 reviewer rubric\n_${RUBRIC_VERSION}_\n\nScore each of 5 dimensions independently on a 0–10 scale. Anchors below.\n`;
  RUBRIC_COMPACT.forEach(([name, anchors]) => {
    md += "\n## " + name + "\n";
    anchors.forEach(([n, d]) => { md += "  " + n.padStart(2) + "  →  " + d + "\n"; });
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "scoring.md";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Inner form component ──────────────────────────────────────────────────
function ReviewerEvalForm({ application, evaluation, source, onBack, onPrev, onNext, queueLen }) {
  const s     = application;
  const appId = application.id;
  const MAX_FLAGS = 8;

  const [scores,    setScores]    = useState(evaluation.scores);
  const [reco,      setReco]      = useState(evaluation.recommendation || null);
  const [notes,     setNotes]     = useState(evaluation.notes || "");
  const [flags,     setFlags]     = useState(evaluation.flags || []);
  const [submitted, setSubmitted] = useState(evaluation.status === "submitted");
  const [reopened,  setReopened]  = useState(false);

  const [showRubric, setShowRubric] = useState(false);
  const [showAi,     setShowAi]     = useState(false);
  const [viewApp,    setViewApp]    = useState(false);
  const [flagInput,  setFlagInput]  = useState("");
  const [saveState,  setSaveState]  = useState("idle");
  const [secOpen,    setSecOpen]    = useState({});

  // Edit-window countdown — driven from evaluaton.editWindowExpiresAt in Phase 3.
  // For now (Phase 2 mock): start at 54 minutes.
  const [timeLeft, setTimeLeft] = useState(3240);
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const lockedSubmitted = submitted && !reopened;
  const editable        = !lockedSubmitted && timeLeft !== 0;
  const overall         = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;

  const setScore = (k) => (v) => setScores((prev) => ({ ...prev, [k]: v }));
  const addFlag  = () => {
    const t = flagInput.trim();
    if (!t || flags.length >= MAX_FLAGS) return;
    setFlags((prev) => [...prev, t]);
    setFlagInput("");
  };
  const removeFlag = (i) => setFlags((prev) => prev.filter((_, j) => j !== i));

  const payload = () => ({ scores, recommendation: reco, notes, flags });

  // Autosave debounce (800ms, matching prototype)
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!editable) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      reviewerApiV2.saveEvaluation(appId, payload(), source).then(() => setSaveState("saved"));
    }, 800);
    return () => clearTimeout(t);
  }, [scores, reco, notes, flags]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraftNow = () => {
    setSaveState("saving");
    reviewerApiV2.saveEvaluation(appId, payload(), source).then(() => {
      setSaveState("saved");
    });
  };
  const submitEval = () => {
    const wasAmend = submitted && reopened;
    reviewerApiV2.submitEvaluation(appId, payload(), source).then(() => {
      setSubmitted(true); setReopened(false);
      if (wasAmend) setSaveState("saved");
    });
  };
  const reopenForEdit = () => { setReopened(true); };

  // Collapsible AI section state (first section open by default)
  const psFields = (s.detail?.fields || []).filter((f) => !isFactField(f));

  if (viewApp) {
    return <FullApplicationView s={s} onBack={() => setViewApp(false)} />;
  }

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ color: "#4a4a52", textDecoration: "none" }}>
              {source === "history" ? "My history" : "My queue"}
            </a>
            <span style={{ margin: "0 8px", color: "#c8c8d0" }}>/</span>
            <span style={{ color: "#8a8a92" }}>{s.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>R-2 · ACTIVE EVALUATION</span>
          <h2 className="lp-section-title">{s.name} <span className="lp-muted">· scoring</span></h2>
          <div className="lp-section-sub">
            Read the application, then score each dimension 0–10.
          </div>
        </div>
        <div className="lp-section-actions">
          <div className="os-row gap-sm">
            <button className="os-btn ghost sm" onClick={onPrev} disabled={!onPrev}>← Prev</button>
            <button className="os-btn ghost sm" onClick={onNext} disabled={!onNext}>Next →</button>
          </div>
          <div className="os-row gap-sm" style={{ alignItems: "center" }}>
            <button className="os-btn secondary" onClick={onBack}>↩ My queue</button>
            {editable && saveState !== "idle" && (
              <span className="saved" style={{ opacity: saveState === "saving" ? 0.5 : 1 }}>
                {saveState === "saving" ? "Saving…" : "✓ Saved"}
              </span>
            )}
            <div className={"lp-edit-chip " + (timeLeft < 600 ? "red" : "amber")}>
              <span className="lp-edit-dot" />
              Edit window: {Math.floor(timeLeft / 60)} min remaining
            </div>
            {lockedSubmitted ? (
              <>
                <Chip tone="green">Submitted ✓</Chip>
                <button className="os-btn" disabled={timeLeft === 0} onClick={reopenForEdit}>
                  Re-open to edit
                </button>
              </>
            ) : (
              <>
                <button className="os-btn ghost" disabled={timeLeft === 0} onClick={saveDraftNow}>
                  Save draft
                </button>
                <button className="os-btn" disabled={timeLeft === 0} onClick={submitEval}>
                  {submitted ? "Re-submit →" : "Submit evaluation →"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        {/* LEFT — application content */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Application · {s.name}</div>
              <div className="os-row gap-sm">
                <Chip>{s.domain}</Chip>
                <Chip>{s.stage}</Chip>
                <Chip>TRL {s.trl}</Chip>
              </div>
            </div>
            <div className="os-stack">
              {s.detail?.aiSummary && (
                <div className="ps-ai-summary">
                  <div className="ps-ai-label">AI summary</div>
                  <p className="ps-ai-text">{s.detail.aiSummary}</p>
                </div>
              )}

              <div>
                <div className="ps-group-label">Problem &amp; solution</div>
                {(s.detail?.fields || []).some(isFactField) && (
                  <div className="ps-facts">
                    {(s.detail?.fields || []).filter(isFactField).map((f, i) => (
                      <div className="ps-fact" key={i}>
                        <span className="ps-fact-label">{f.label}</span>
                        <span className="ps-fact-value">{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="ps-sections">
                  {psFields.map((f, i) => {
                    const open = (f.label in secOpen) ? secOpen[f.label] : (i === 0);
                    const pts  = fieldBullets(f);
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
                            {pts.map((b, j) => <li key={j}>{b}</li>)}
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

          {/* AI baseline */}
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
                <div className="os-num-big" style={{ fontSize: 36, fontFamily: "var(--font-sans)", fontWeight: 800, letterSpacing: "-0.02em", color: "#242424" }}>
                  {s.ai.overall.toFixed(1)}
                </div>
                <div style={{ flex: 1 }}>
                  {["problem", "solution", "tech", "founders", "commit"].map((k) => (
                    <ScoreBar key={k} label={CRIT_LABELS[k]} kind={k} value={s.ai[k]} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="os-text-sm os-text-dim">
                AI scores are hidden. Click "Show AI Scores" to reveal them.
              </div>
            )}
            <div className="os-text-xs os-text-dim os-mt-sm">
              AI is a baseline. Score independently — variance is expected and welcome.
            </div>
          </div>
        </div>

        {/* RIGHT — scoring panel */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Your scores</div>
              <button className="os-btn sm ghost" onClick={() => setShowRubric(true)}>Open rubric →</button>
            </div>
            {["problem", "solution", "tech", "founders", "commit"].map((k) => (
              <div key={k} style={{ marginBottom: 16 }}>
                <Slider
                  label={CRIT_LABELS[k]}
                  kind={k}
                  value={scores[k]}
                  onChange={setScore(k)}
                />
              </div>
            ))}
            <hr className="os-divider" />
            <div className="os-row between">
              <span className="os-text-xs os-text-dim os-uppercase">Your overall</span>
              <span className="os-num-big" style={{ fontSize: 34, fontFamily: "var(--font-sans)", fontWeight: 800, letterSpacing: "-0.02em", color: "#3213b7" }}>
                {overall.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Recommendation</div>
            <div className="os-reco-group">
              {["yes", "maybe", "no"].map((r) => (
                <button
                  key={r}
                  className={"os-reco-btn " + r + (reco === r ? " active" : "")}
                  onClick={() => setReco(r)}
                  disabled={lockedSubmitted}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="os-card">
            <div className="os-row between os-mb-sm" style={{ alignItems: "center" }}>
              <div className="os-card-title">
                Notes <span className="os-text-dim" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(recommended)</span>
              </div>
              {!lockedSubmitted && saveState !== "idle" && (
                <span className="saved" style={{ fontSize: 11, opacity: saveState === "saving" ? 0.5 : 1 }}>
                  {saveState === "saving" ? "Saving…" : "✓ Saved"}
                </span>
              )}
            </div>
            <textarea
              className="notes-area"
              placeholder="What stood out in your assessment? Key strengths, concerns, or context behind your scores."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={lockedSubmitted}
            />
            <div className="os-text-xs os-text-dim os-mt-sm">Saved automatically as you type.</div>
          </div>

          <div className="os-card soft">
            <div className="os-row between os-mb-sm">
              <div className="os-card-title">Risk flags raised</div>
              <span className="os-text-xs os-text-dim">{flags.length} / {MAX_FLAGS}</span>
            </div>
            <div className="os-stack gap-sm">
              {flags.length === 0 && <div className="os-text-sm os-text-dim">No flags raised yet.</div>}
              {flags.map((f, i) => (
                <div key={i} className="os-row gap-sm" style={{ alignItems: "center" }}>
                  <span className="os-chip amber">⚐</span>
                  <span className="os-text-sm" style={{ flex: 1 }}>{f}</span>
                  <button
                    className="os-btn sm ghost"
                    style={{ padding: "2px 8px", lineHeight: 1 }}
                    onClick={() => removeFlag(i)}
                    disabled={lockedSubmitted}
                  >✕</button>
                </div>
              ))}
              {flags.length < MAX_FLAGS && !lockedSubmitted && (
                <div className="os-row gap-sm os-mt-sm" style={{ alignItems: "center" }}>
                  <input
                    className="os-input"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder="Add a short risk flag…"
                    maxLength={80}
                    value={flagInput}
                    onChange={(e) => setFlagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFlag(); } }}
                  />
                  <button className="os-btn sm ghost" onClick={addFlag} disabled={!flagInput.trim()}>
                    + Add flag
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showRubric && <RubricModal onClose={() => setShowRubric(false)} track={s.track} />}
    </div>
  );
}

// ── Field helpers (shared with FullApplicationView concepts) ─────────────
function fieldBullets(f) {
  if (Array.isArray(f.bullets)) return f.bullets.map(String);
  const text = String(f.value || "").trim();
  if (!text) return [];
  const protected_ = text
    .replace(/(\d)\.(\d)/g, "$1~D~$2")
    .replace(/(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Inc|Ltd|No|Fig|Rs|approx)\./gi, "$1~D~");
  return protected_
    .split(/(?<=[.!?])\s+(?=[A-Z₹"'(])/)
    .map((x) => x.replace(/~D~/g, ".").trim())
    .filter(Boolean);
}
function isFactField(f) {
  if (f.short === true) return true;
  if (Array.isArray(f.bullets)) return false;
  const v = String(f.value || "");
  return v.length <= 48 && !/[.!?]/.test(v);
}

// ── Loader wrapper ────────────────────────────────────────────────────────
export default function ReviewerV2EvaluationPage() {
  const { appId: idxParam } = useParams();
  const navigate = useNavigate();
  const idx = parseInt(idxParam, 10) || 0;
  const source = "queue";
  const QUEUE_N = 8;

  const { data, loading, error, reload } = useAsync(
    () => reviewerApiV2.getEvalScreen(idx, source),
    [idx, source],
  );

  const onBack = () => navigate("/reviewer-v2/inbox");
  const onPrev = idx > 0           ? () => navigate(`/reviewer-v2/eval/${idx - 1}`) : null;
  const onNext = idx < QUEUE_N - 1 ? () => navigate(`/reviewer-v2/eval/${idx + 1}`) : null;

  if (loading) return (
    <div className="lp-tab-content--full">
      <LoadingState label="Loading application…" />
    </div>
  );
  if (error) return (
    <div className="lp-tab-content--full">
      <ErrorState error={error} onRetry={reload} />
    </div>
  );

  return (
    <div className="lp-tab-content lp-tab-content--full">
      <ReviewerEvalForm
        key={data.application.id + ":" + source}
        application={data.application}
        evaluation={data.evaluation}
        source={source}
        onBack={onBack}
        onPrev={onPrev}
        onNext={onNext}
        queueLen={QUEUE_N}
      />
    </div>
  );
}
