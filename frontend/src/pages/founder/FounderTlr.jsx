// TLR evaluation — the ARTPARK Innovation Readiness (AIR) scorecard.
// Five-step wizard (spec §4.4): Overview -> Technology -> Commercial ->
// Evidence -> Scorecard. One GET /founder/air bundle drives everything;
// nothing about the framework (lever names, question text, option text,
// criteria, document names) is hardcoded here — it all comes from
// `bundle.catalog` and `bundle.levers`, both server-owned, so a wording
// change in the catalog needs no frontend deploy.
//
// Autosave mirrors FounderApproach.jsx: optimistic local update, fire the
// PUT, replace state with whatever comes back. AIR's PUT is unusual in that
// its response is the *whole* assessment bundle (see founder_air.put_lever),
// not just the touched lever — so on success we simply setBundle(response)
// and every derived field (claimed_level, criteria, required_document,
// rollups) re-derives server-side in one shot, exactly as the ladder rule
// requires (see LeverPanel.jsx's header comment for why that ladder makes a
// single-lever recompute insufficient).
import { useState, useEffect, useRef } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState, Tile } from "./ui.jsx";
import Stepper from "./components/Stepper.jsx";
import AirBar from "./components/AirBar.jsx";
import LeverPanel from "./components/LeverPanel.jsx";
import EvidenceRow from "./components/EvidenceRow.jsx";

const STEP_LABELS = ["Overview", "Technology", "Commercial", "Evidence", "Scorecard"];
const TOTAL_STEPS = STEP_LABELS.length;

const FAMILY_LABEL = { technology: "Technology / R&D", commercial: "Product / Engineering" };

// The wizard has exactly two lever-family steps — that's structural, not
// something a catalog change should be able to add a third of. A lever
// outside these two is still real data, though: it must be surfaced (see
// `unknownFamilyLevers` below), never silently dropped, and must never
// block submit — it can't be answered here, so holding it against
// `missing` forever would be a dead end for the founder.
const KNOWN_FAMILIES = ["technology", "commercial"];

// founder_air.py raises every error as `detail={"code": …}`, and api.js's
// _buildError sets message to the literal string "Request failed" whenever
// detail is an object without its own `message` key — so every one of
// these reads identically today. Map the codes we know about to copy that
// actually explains what happened; anything unrecognised (including a
// genuine network error, which has no `code` at all) falls through to the
// generic sentence.
const AIR_ERROR_COPY = {
  no_document_required: "This lever doesn't ask for a document at that level — nothing to upload.",
  unsupported_media: "That file type isn't supported. Upload a PDF, PNG, JPEG, DOCX or XLSX.",
  too_large: "That file is larger than the 25 MB upload limit.",
  air_already_submitted: "This round was already submitted elsewhere — refreshing to the latest state.",
  air_incomplete: "Every lever needs a claimed level before this round can be submitted.",
  invalid_option: "That isn't a valid answer for this question.",
  signed_url_failed: "Couldn't generate a download link. Try again in a moment.",
};

function describeActionError(err) {
  const copy = err?.code && AIR_ERROR_COPY[err.code];
  if (copy) return copy;
  if (err?.message && err.message !== "Request failed") return err.message;
  return "Something went wrong saving that change.";
}

export default function FounderTlr() {
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Monotonically increasing per dispatched mutation that returns a bundle
  // (lever PUT — answers and criteria both go through the same call —
  // plus evidence upload). Captured before the request fires; a response
  // is applied only if no newer one has been dispatched since. AIR fires a
  // PUT per radio click, so two responses landing out of order is the
  // normal rhythm here, not an edge case — without this, the STALE
  // response can overwrite the founder's later answer.
  const genRef = useRef(0);

  useEffect(() => {
    founderApi.getAir().then(setBundle).catch(setError);
  }, []);

  const go = (i) => {
    const clamped = Math.max(0, Math.min(TOTAL_STEPS - 1, i));
    setStep(clamped);
    setFurthest((f) => Math.max(f, clamped));
  };
  const next = () => go(step + 1);
  const back = () => go(step - 1);

  if (error) return <ErrorState error={error} />;
  if (!bundle) return <Loading label="Loading your AIR assessment…" />;

  const { round, levers } = bundle;
  const disabled = round.status !== "draft";
  const unknownFamilyLevers = levers.filter((l) => !KNOWN_FAMILIES.includes(l.family));

  // Pulls the truth back from the server after a mutation the optimistic
  // update can't safely repair locally: a delete or upload that failed
  // server-side (F8), or an autosave rejected because the round was
  // submitted elsewhere (F7) — in that case this is what flips every
  // input to read-only, since `disabled` is derived from `round.status`.
  const refetchBundle = () => founderApi.getAir().then(setBundle).catch(() => {});

  // Every lever field is written together — the endpoint persists all four
  // columns on every call (q1/q2/q3_option, criteria_checked), so a partial
  // patch would blank whatever this call omitted. Reading the current row
  // out of `bundle` (a render-scoped closure, always fresh) rather than via
  // a setState updater keeps that whole-payload guarantee simple: no risk of
  // building the PUT body from a stale updater-callback snapshot.
  const patchLever = (leverKey, fieldPatch) => {
    const current = levers.find((l) => l.lever === leverKey);
    if (!current) return;
    const nextLever = { ...current, ...fieldPatch };
    const payload = {
      q1_option: nextLever.q1_option,
      q2_option: nextLever.q2_option,
      q3_option: nextLever.q3_option,
      criteria_checked: nextLever.criteria_checked || [],
    };
    setBundle((prev) => ({
      ...prev,
      levers: prev.levers.map((l) => (l.lever === leverKey ? nextLever : l)),
    }));
    const gen = ++genRef.current;
    founderApi
      .putAirLever(leverKey, payload)
      .then((b) => {
        if (gen !== genRef.current) return; // superseded by a newer request
        setActionError(null);
        setBundle(b);
      })
      .catch((err) => {
        setActionError(err);
        // A round submitted elsewhere 409s every subsequent autosave with
        // this code. Refetch so the UI flips to read-only instead of
        // staying editable while quietly failing to save anything.
        if (err?.code === "air_already_submitted") refetchBundle();
      });
  };

  const onAnswer = (leverKey) => (qId, optionId) => patchLever(leverKey, { [`${qId}_option`]: optionId });

  const onToggleCriterion = (leverKey) => (criterion) => {
    const current = levers.find((l) => l.lever === leverKey);
    const checked = current?.criteria_checked || [];
    const nextChecked = checked.includes(criterion)
      ? checked.filter((c) => c !== criterion)
      : [...checked, criterion];
    patchLever(leverKey, { criteria_checked: nextChecked });
  };

  const onUpload = (leverKey) => (airLevel, file) => {
    const gen = ++genRef.current;
    founderApi
      .uploadAirEvidence(leverKey, airLevel, file)
      .then((b) => {
        if (gen !== genRef.current) return;
        setActionError(null);
        setBundle(b);
      })
      .catch((err) => {
        setActionError(err);
        refetchBundle();
      });
  };

  // Deletion doesn't need a lever key — evidence row ids are unique across
  // the whole bundle — so one shared handler serves every EvidenceRow.
  const onDelete = (rowId) => {
    setBundle((prev) => ({
      ...prev,
      levers: prev.levers.map((l) => ({ ...l, evidence: (l.evidence || []).filter((e) => e.id !== rowId) })),
    }));
    founderApi
      .delAirEvidence(rowId)
      .then(() => setActionError(null))
      .catch((err) => {
        setActionError(err);
        // The optimistic removal above has no rollback path, so a delete
        // that fails server-side would otherwise make the document vanish
        // from screen while it survives on the server — and AIR evidence
        // is exactly what ARTPARK verifies against. Refetch the truth.
        refetchBundle();
      });
  };

  // onDownload hands us an id, not a URL — fetch the signed URL and open it,
  // same as FounderMou.jsx's `download()`.
  const onDownload = async (rowId) => {
    try {
      const { url } = await founderApi.airEvidenceSignedUrl(rowId);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setActionError(err);
    }
  };

  const onSubmit = () => {
    founderApi.submitAir().then((b) => {
      setActionError(null);
      setBundle(b);
    }).catch((err) => setActionError(err));
  };

  const doneCount = Math.min(furthest + 1, TOTAL_STEPS);

  return (
    <div className="fj-onboarding">
      <Stepper
        steps={STEP_LABELS}
        current={step}
        furthest={furthest}
        onGo={go}
        eyebrow={`AIR evaluation · ${round.round_label}`}
        progressLabel={`${doneCount} of ${TOTAL_STEPS} steps`}
      />

      {actionError && (
        <div className="fj-inline-error" role="alert">
          {describeActionError(actionError)}
        </div>
      )}

      {unknownFamilyLevers.length > 0 && (
        <div className="fj-inline-warning" role="status">
          This round includes {unknownFamilyLevers.length === 1 ? "a lever" : "levers"} the
          wizard doesn't have a step for yet: {unknownFamilyLevers.map((l) => l.name).join(", ")}.
          Contact ARTPARK — {unknownFamilyLevers.length === 1 ? "it" : "they"} won't block
          submitting the rest of this round.
        </div>
      )}

      <div className="fj-wizard-body">
        {step === 0 && <OverviewStep levers={levers} round={round} onNext={next} />}

        {step === 1 && (
          <LeverFamilyStep
            family="technology"
            title="Technology readiness"
            help="Three levers score how far your engineering has been de-risked, from a documented idea through to sustained commercial operation."
            catalog={bundle.catalog}
            levers={levers}
            disabled={disabled}
            onAnswer={onAnswer}
            onToggleCriterion={onToggleCriterion}
            onBack={back}
            onNext={next}
            nextLabel="Commercial levers"
          />
        )}

        {step === 2 && (
          <LeverFamilyStep
            family="commercial"
            title="Commercial readiness"
            help="Three levers score how far the commercial case has been proven, from a validated problem through to a mature service organisation."
            catalog={bundle.catalog}
            levers={levers}
            disabled={disabled}
            onAnswer={onAnswer}
            onToggleCriterion={onToggleCriterion}
            onBack={back}
            onNext={next}
            nextLabel="Upload evidence"
          />
        )}

        {step === 3 && (
          <EvidenceStep
            catalog={bundle.catalog}
            levers={levers}
            disabled={disabled}
            onUpload={onUpload}
            onDelete={onDelete}
            onDownload={onDownload}
            onBack={back}
            onNext={next}
          />
        )}

        {step === 4 && (
          <ScorecardStep
            bundle={bundle}
            onSubmit={onSubmit}
            onBack={back}
          />
        )}
      </div>
    </div>
  );
}

// ============ STEP 01 · OVERVIEW ============
function OverviewStep({ levers, round, onNext }) {
  const technology = levers.filter((l) => l.family === "technology");
  const commercial = levers.filter((l) => l.family === "commercial");
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">TLR evaluation · {round.round_label}</span>
      <h1 className="fj-h1 lg">ARTPARK Innovation Readiness</h1>
      <p className="fj-help lg">
        AIR is ARTPARK's stage-gate scorecard for your venture. Six levers, each scored
        1 through 9, split across two families — how far the technology has been
        de-risked, and how far the commercial case has been proven. The goal is not a
        perfect score everywhere; it is an honest, evidenced picture of where you
        actually stand, quarter over quarter.
      </p>

      <div className="fj-welcome-cards">
        <div className="card fj-welcome-card" style={{ borderColor: "var(--line-strong)" }}>
          <span className="eyebrow" style={{ color: "var(--artblue)" }}>{FAMILY_LABEL.technology}</span>
          <ul className="fj-arrow-list">
            {technology.map((l) => (
              <li key={l.lever}><span className="fj-arrow">→</span><span>{l.name}</span></li>
            ))}
          </ul>
        </div>
        <div className="card fj-welcome-card" style={{ borderColor: "var(--line-strong)" }}>
          <span className="eyebrow" style={{ color: "var(--accent-violet)" }}>{FAMILY_LABEL.commercial}</span>
          <ul className="fj-arrow-list">
            {commercial.map((l) => (
              <li key={l.lever}><span className="fj-arrow">→</span><span>{l.name}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="eyebrow">How the ladder works</span>
        <p className="fj-help">
          Each lever is scored by three questions that build on each other like a ladder.
          A later question only lifts your level once every question before it is
          answered at its own top option — so a great answer on question three still
          scores nothing if question one is left behind. The wizard always names which
          question is holding a lever back.
        </p>
        <p className="fj-help">
          For the level you claim, tick the measurement criteria it asks for and upload
          the qualifying document. Once every lever has a level, submit the round — an
          ARTPARK reviewer then confirms or adjusts each one.
        </p>
      </div>

      <div className="fj-actions lg">
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Start with Technology</span><span className="arrow">→</span>
        </a>
        <span className="hint">Answers autosave as you go.</span>
      </div>
    </div>
  );
}

// ============ STEP 02/03 · TECHNOLOGY / COMMERCIAL ============
function LeverFamilyStep({ family, title, help, catalog, levers, disabled, onAnswer, onToggleCriterion, onBack, onNext, nextLabel }) {
  const familyLevers = levers.filter((l) => l.family === family);
  return (
    <div className="fj-wizard" style={{ maxWidth: 960 }}>
      <span className="eyebrow eyebrow-rule">{FAMILY_LABEL[family] || family}</span>
      <h1 className="fj-h1">{title}</h1>
      <p className="fj-help">{help}</p>

      <div className="fj-air-lever-list">
        {familyLevers.map((lever) => (
          <div className="fj-air-lever-block" key={lever.lever}>
            <div className="fj-air-lever-block-head">
              <span className="fj-air-lever-block-name">{lever.name}</span>
              <span className="fj-air-lever-block-level">
                {lever.claimed_level == null ? "AIR —" : `AIR ${lever.claimed_level}`}
              </span>
            </div>
            <LeverPanel
              lever={lever}
              questions={catalog.questions[lever.lever] || []}
              disabled={disabled}
              onAnswer={onAnswer(lever.lever)}
              onToggleCriterion={onToggleCriterion(lever.lever)}
            />
          </div>
        ))}
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>{nextLabel}</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 04 · EVIDENCE ============
function EvidenceStep({ catalog, levers, disabled, onUpload, onDelete, onDownload, onBack, onNext }) {
  return (
    <div className="fj-wizard" style={{ maxWidth: 960 }}>
      <span className="eyebrow eyebrow-rule">Evidence</span>
      <h1 className="fj-h1">Upload your qualifying documents.</h1>
      <p className="fj-help">
        Each lever names one document for the level you've claimed. Lower levels'
        documents are offered as optional backfill — useful if you already have them,
        never required.
      </p>

      <div className="fj-air-lever-list">
        {levers.map((lever) => (
          <EvidenceRow
            key={lever.lever}
            lever={lever}
            documents={catalog.documents[lever.lever] || {}}
            disabled={disabled}
            onUpload={onUpload(lever.lever)}
            onDelete={onDelete}
            onDownload={onDownload}
          />
        ))}
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Review your scorecard</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 05 · SCORECARD ============
function ScorecardStep({ bundle, onSubmit, onBack }) {
  const { levers, rollups, round } = bundle;
  const technology = levers.filter((l) => l.family === "technology");
  const commercial = levers.filter((l) => l.family === "commercial");
  const claimed = rollups.claimed;
  // A lever outside technology/commercial has no step where it can ever be
  // answered (F9) — holding it against `missing` would block submit
  // forever with no way out for the founder. It's already surfaced
  // separately, above the stepper.
  const missing = levers.filter((l) => l.claimed_level == null && KNOWN_FAMILIES.includes(l.family));

  return (
    <div className="fj-wizard" style={{ maxWidth: 960 }}>
      <span className="eyebrow eyebrow-rule">Scorecard</span>
      <h1 className="fj-h1">Where your venture stands today.</h1>
      <p className="fj-help">
        Verified levels are set by ARTPARK once you submit — every lever shows as
        claimed-only until then, which is expected for a round in progress, not a
        missing feature.
      </p>

      <div className="fj-air-rollups">
        <Tile k="Technology AIR" v={claimed.technology ?? "—"} />
        <Tile k="Commercial AIR" v={claimed.commercial ?? "—"} />
        <Tile k="Overall AIR" v={claimed.overall ?? "—"} />
      </div>

      <div className="fj-air-scorecard-group">
        <span className="eyebrow" style={{ color: "var(--artblue)" }}>{FAMILY_LABEL.technology}</span>
        {technology.map((l) => (
          <AirBar key={l.lever} name={l.name} claimed={l.claimed_level} verified={l.verified_level} />
        ))}
      </div>
      <div className="fj-air-scorecard-group">
        <span className="eyebrow" style={{ color: "var(--accent-violet)" }}>{FAMILY_LABEL.commercial}</span>
        {commercial.map((l) => (
          <AirBar key={l.lever} name={l.name} claimed={l.claimed_level} verified={l.verified_level} />
        ))}
      </div>

      {round.status === "draft" ? (
        <div className="fj-air-submit-gate">
          <button type="button" className="btn btn-primary" disabled={missing.length > 0} onClick={onSubmit}>
            Submit assessment
          </button>
          {missing.length > 0 && (
            <p className="fj-air-outstanding">
              Still need a level: {missing.map((l) => l.name).join(", ")}.
            </p>
          )}
        </div>
      ) : (
        <div className="fj-air-submitted-badge">
          <span className="dot green" />
          <div>
            <div className="tt">Submitted</div>
            <div className="ss">
              {round.submitted_at
                ? `Submitted ${new Date(round.submitted_at).toLocaleDateString()} · awaiting ARTPARK verification.`
                : "Awaiting ARTPARK verification."}
            </div>
          </div>
        </div>
      )}

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
      </div>
    </div>
  );
}
