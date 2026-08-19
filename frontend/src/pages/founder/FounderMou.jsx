// The MOU tab — a 3-step wizard (Your details / Review / Sign) that ends in
// a read-only Signed + Download view once founder_mou has a row. A track
// can require MORE THAN ONE agreement (agreements.TRACK_AGREEMENTS — TIR
// signs Facility AND Collaboration); GET /founder/mou returns the list in
// `agreements` and this component renders from that list only. Nothing
// here hardcodes which document a track needs: one card, one download
// action, one field set per entry in `agreements`, however many that is.
import { useEffect, useRef, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";
import Stepper from "./components/Stepper.jsx";

const STEP_LABELS = ["Your details", "Review", "Sign"];
const MAX_COLLABORATORS = 3;

function emptyCollaborator(fields) {
  const c = {};
  for (const f of fields) c[f.key] = "";
  return c;
}

function isCollaboratorEmpty(c) {
  return Object.values(c).every((v) => !String(v || "").trim());
}

function isCollaboratorComplete(c, fields) {
  return fields.every((f) => String(c[f.key] || "").trim());
}

// Not started / Incomplete / (Signed, handled entirely outside this — see
// the empty-state table in the plan's Global Constraints): each has to read
// differently because the cause is different, not just the label.
function collaboratorStatus(collaborators, fields) {
  if (!collaborators.length || !fields.length) return "not_started";
  if (collaborators.every(isCollaboratorEmpty)) return "not_started";
  return collaborators.every((c) => isCollaboratorComplete(c, fields)) ? "complete" : "incomplete";
}

// pydantic (FastAPI) validation errors arrive as a raw list under `detail`
// when a CollaboratorIn field fails — e.g. the PAN regex. Each entry's
// `loc` is ["body", "collaborators", <index>, <field>]; `msg` is prefixed
// "Value error, " for a raised ValueError (the PAN validator's own
// message). Pulling this apart is what lets a mistyped PAN point at the
// exact field instead of a bare "Request failed".
function pydanticFieldErrors(details) {
  const out = {};
  if (!Array.isArray(details)) return out;
  for (const d of details) {
    const loc = Array.isArray(d?.loc) ? d.loc : [];
    if (loc[0] === "body" && loc[1] === "collaborators" && typeof loc[2] === "number" && loc[3]) {
      out[`${loc[2]}.${loc[3]}`] = String(d.msg || "").replace(/^Value error,\s*/i, "") || "This value isn't valid.";
    }
  }
  return out;
}

// Every /founder/mou* error arrives as detail.code (see routers/founder.py
// + services/founder_mou.py + services/agreements.py). The API client
// (lib/api.js) renders a bare "Request failed" for any detail object with
// no `message` key, so every code reachable from this screen needs its own
// line here — a founder signing a legal document should never see a
// generic failure they can't act on.
function mouErrorCopy(err) {
  switch (err?.code) {
    case "acknowledgements_required":
      return "Please confirm every acknowledgement before signing.";
    case "mou_already_signed":
      return "This MOU was already signed — showing the signed copy.";
    case "invalid_signature":
      return err.message || "That signature couldn't be processed. Clear the pad and sign again.";
    case "invalid_collaborators":
      return err.message || "Check the collaborator details above and try again.";
    case "mou_not_signed":
      return "Nothing has been signed yet, so there's nothing to download.";
    case "agreement_not_signed":
      return "That document wasn't part of what was signed.";
    case "unknown_agreement":
      return "That document isn't one of your track's agreements.";
    case "network_error":
    case "timeout":
      return "Couldn't reach the server. Check your connection and try again.";
    case "http_422":
      return "Some of the details above need fixing — see the highlighted field.";
    default:
      return err?.message && err.message !== "Request failed"
        ? err.message
        : "Something went wrong. Please try again.";
  }
}

export default function FounderMou({ me, onSigned }) {
  const [mou, setMou] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);

  const [collaborators, setCollaborators] = useState([]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const [signerName, setSignerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState(null);
  const [hasInk, setHasInk] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [acked, setAcked] = useState([]);
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const [downloadErrors, setDownloadErrors] = useState({});

  // ── Live embedded PDF preview (Review + Sign steps) ────────────────────
  // Which document tab is showing, the current object URL the <iframe>
  // points at, and an unobtrusive loading/error state around it. Lifted up
  // here (not local to a step) so the fetched document survives moving
  // between Review and Sign.
  const [activeSlug, setActiveSlug] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const objectUrlRef = useRef(null);
  const requestSeqRef = useRef(0);
  const prevActiveSlugRef = useRef(null);
  const prevStepRef = useRef(0);

  const fields = mou?.agreements?.[0]?.fields || [];

  useEffect(() => {
    founderApi.getMou().then((m) => {
      setMou(m);
      setSignerName(m.signer_name || "");
    }).catch(setLoadError);
  }, []);

  // Seed one empty collaborator block once the field schema is known.
  // Local state only — nothing is persisted server-side until sign time
  // (see the plan's "Out of scope: draft persistence").
  useEffect(() => {
    if (mou && !mou.signed && fields.length && collaborators.length === 0) {
      setCollaborators([emptyCollaborator(fields)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mou, fields.length]);

  // Default the active document tab to the track's first required
  // agreement once the catalog is known. Data-driven — never a hardcoded
  // slug — so a track with one agreement (VIP) or two (TIR) both "just
  // work" with zero branching here.
  useEffect(() => {
    if (mou?.agreements?.length && !activeSlug) {
      setActiveSlug(mou.agreements[0].slug);
    }
  }, [mou, activeSlug]);

  // Revoke the last object URL on unmount — this page can re-render a
  // 16-page PDF many times over a signing session; a leaked blob URL per
  // edit is a real memory bug.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // The live preview's object URL is dead weight once signed — the Signed
  // panel embeds the real signed PDF via its own presigned-URL fetch, not
  // this blob. Revoke it rather than leaving it dangling for the rest of
  // the component's lifetime.
  useEffect(() => {
    if (mou?.signed && objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setPdfUrl(null);
    }
  }, [mou?.signed]);

  // The live embedded PDF itself. Fires on the Review and Sign steps only
  // (there's nothing to show while still on "Your details"); debounced
  // ~700ms so a 16-page re-render doesn't happen on every keystroke, but
  // switching document tabs or moving between steps refreshes immediately
  // rather than waiting out the debounce. Every fetch is tagged with a
  // sequence number and its own AbortController — a response that arrives
  // after a newer request has already been kicked off is discarded rather
  // than overwriting what's on screen (the out-of-order bug this project
  // has already shipped once).
  useEffect(() => {
    if (!mou || mou.signed) return;
    if (step === 0 || !activeSlug) return;

    const slugChanged = prevActiveSlugRef.current !== activeSlug;
    const stepChanged = prevStepRef.current !== step;
    prevActiveSlugRef.current = activeSlug;
    prevStepRef.current = step;
    const firstPaint = pdfUrl === null;
    const delay = firstPaint || slugChanged || stepChanged ? 0 : 700;

    const seq = ++requestSeqRef.current;
    const controller = new AbortController();
    setPdfLoading(true);

    const timer = setTimeout(async () => {
      try {
        const signaturePng =
          step === 2 && hasInk ? canvasRef.current?.toDataURL("image/png") : null;
        const blob = await founderApi.previewMouPdf(activeSlug, {
          collaborators: collaboratorsPayload(),
          signerName: step === 2 ? signerName.trim() : "",
          signaturePng,
          signal: controller.signal,
        });
        if (seq !== requestSeqRef.current) return; // superseded — never overwrite a newer preview
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPdfUrl(url);
        setPdfError(null);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setPdfError(mouErrorCopy(e));
      } finally {
        if (seq === requestSeqRef.current) setPdfLoading(false);
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug, step, JSON.stringify(collaborators), signerName, hasInk, strokeCount, mou]);

  // signature pad — unchanged mechanics from the pre-rewrite component,
  // just gated on the Sign step instead of "unsigned".
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !mou || mou.signed || step !== 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return; // jsdom (no optional `canvas` pkg) returns null in tests
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#242424";
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const start = (e) => { drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasInk(true); e.preventDefault(); };
    // A completed stroke, not every pointer-move, is what triggers the live
    // preview to re-fetch with the updated signature — otherwise a single
    // signing gesture would fire dozens of PDF re-renders.
    const end = () => { if (drawing.current) setStrokeCount((n) => n + 1); drawing.current = false; };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [mou, step]);

  const go = (i) => { setStep(i); setFurthest((f) => Math.max(f, i)); };

  const updateField = (i, key, value) => {
    setCollaborators((prev) => prev.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
    setFieldErrors((prev) => {
      if (!(`${i}.${key}` in prev)) return prev;
      const next = { ...prev };
      delete next[`${i}.${key}`];
      return next;
    });
  };
  // Adding/removing a block only ever touches the array — every other
  // collaborator's object reference (and typed values) is left alone.
  const addCollaborator = () => {
    setCollaborators((prev) => (prev.length >= MAX_COLLABORATORS ? prev : [...prev, emptyCollaborator(fields)]));
  };
  const removeCollaborator = (i) => {
    setCollaborators((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  };

  const collaboratorsPayload = () =>
    collaborators.map((c) => Object.fromEntries(fields.map((f) => [f.key, String(c[f.key] || "").trim()])));

  const status = collaboratorStatus(collaborators, fields);

  // Validates the collaborator details BEFORE leaving the Details step —
  // same server-side check (CollaboratorIn, e.g. the PAN regex) the
  // signing endpoint itself enforces, just run early via the PDF preview
  // endpoint so a bad field is caught here rather than after advancing.
  // The rendered PDF itself is discarded; the live-preview effect above
  // fetches the one actually shown once we land on the Review step.
  const goToReview = async () => {
    setReviewError(null);
    setFieldErrors({});
    setReviewBusy(true);
    try {
      const slug = mou?.agreements?.[0]?.slug;
      await founderApi.previewMouPdf(slug, { collaborators: collaboratorsPayload() });
      go(1);
    } catch (e) {
      const fe = pydanticFieldErrors(e?.details);
      if (Object.keys(fe).length) setFieldErrors(fe);
      setReviewError(mouErrorCopy(e));
    } finally {
      setReviewBusy(false);
    }
  };

  const ackList = mou?.acknowledgements || [];
  const allAcked = ackList.length > 0 && ackList.every((a) => acked.includes(a.id));
  const toggleAck = (id) => setAcked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const sign = async () => {
    if (!signerName.trim() || !hasInk || !allAcked) return;
    setBusy(true); setSignError(null); setFieldErrors({});
    try {
      const png = canvasRef.current.toDataURL("image/png");
      await founderApi.signMou(signerName.trim(), png, acked, collaboratorsPayload());
      const fresh = await founderApi.getMou();
      setMou(fresh);
      onSigned?.();
    } catch (e) {
      if (e?.code === "mou_already_signed") {
        // Someone/something else already signed this application (or a
        // double-submit raced itself) — refetch and land on the real
        // signed state rather than a dead-end error banner.
        try {
          const fresh = await founderApi.getMou();
          setMou(fresh);
          if (fresh.signed) return;
        } catch { /* fall through to the generic error below */ }
      }
      const fe = pydanticFieldErrors(e?.details);
      if (Object.keys(fe).length) { setFieldErrors(fe); go(0); }
      setSignError(mouErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (slug) => {
    const key = slug || "_default";
    setDownloadErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const { url } = await founderApi.mouSignedUrl(slug);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setDownloadErrors((prev) => ({ ...prev, [key]: e?.code || "download_failed" }));
    }
  };

  if (loadError && !mou) return <ErrorState error={loadError} />;
  if (!mou) return <Loading label="Loading your agreements…" />;

  if (mou.signed) {
    return <SignedPanel mou={mou} onDownload={download} downloadErrors={downloadErrors} />;
  }

  const doneCount = Math.min(furthest + 1, STEP_LABELS.length);

  return (
    <div className="fj-onboarding">
      <Stepper
        steps={STEP_LABELS}
        current={step}
        furthest={furthest}
        onGo={go}
        eyebrow="Onboarding · Sign your agreements"
        progressLabel={`${doneCount} of ${STEP_LABELS.length} steps`}
      />

      <div className="fj-wizard-body">
        {step === 0 && (
          <DetailsStep
            fields={fields}
            collaborators={collaborators}
            status={status}
            fieldErrors={fieldErrors}
            onFieldChange={updateField}
            onAdd={addCollaborator}
            onRemove={removeCollaborator}
            onReview={goToReview}
            reviewBusy={reviewBusy}
            reviewError={reviewError}
          />
        )}

        {step === 1 && (
          <ReviewStep
            agreements={mou.agreements || []}
            activeSlug={activeSlug}
            onSelectSlug={setActiveSlug}
            pdfUrl={pdfUrl}
            pdfLoading={pdfLoading}
            pdfError={pdfError}
            onBack={() => go(0)}
            onSign={() => go(2)}
          />
        )}

        {step === 2 && (
          <SignStep
            agreements={mou.agreements || []}
            activeSlug={activeSlug}
            onSelectSlug={setActiveSlug}
            pdfUrl={pdfUrl}
            pdfLoading={pdfLoading}
            pdfError={pdfError}
            ackList={ackList}
            acked={acked}
            toggleAck={toggleAck}
            allAcked={allAcked}
            signerName={signerName}
            setSignerName={setSignerName}
            canvasRef={canvasRef}
            clearPad={clearPad}
            sign={sign}
            busy={busy}
            hasInk={hasInk}
            error={signError}
            onBack={() => go(1)}
          />
        )}
      </div>
    </div>
  );
}

// ============ STEP 0 · YOUR DETAILS ============
function DetailsStep({ fields, collaborators, status, fieldErrors, onFieldChange, onAdd, onRemove, onReview, reviewBusy, reviewError }) {
  const statusLabel = status === "not_started" ? "Not started" : status === "incomplete" ? "Incomplete" : null;
  return (
    <div className="fj-wizard">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span className="eyebrow eyebrow-rule">Your details</span>
        {statusLabel && (
          <span className={`fp-mou-status fp-mou-status-${status}`} style={{ color: status === "incomplete" ? "var(--accent-amber)" : "var(--ink-dim)" }}>
            {statusLabel}
          </span>
        )}
      </div>
      <h1 className="fj-h1">Who's party to these agreements?</h1>
      <p className="fj-help">
        Enter party details for 1–3 collaborators — name, PAN, parent's name (s/o, d/o), and
        address. The same details feed every agreement your track requires.
      </p>

      {collaborators.map((c, i) => (
        <div className="card" style={{ marginBottom: 16, padding: 18 }} key={i}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span className="ttl">Collaborator {i + 1}</span>
            {collaborators.length > 1 && (
              <button type="button" className="btn-ghost" onClick={() => onRemove(i)}>
                Remove collaborator
              </button>
            )}
          </div>
          {fields.map((f) => {
            // id/htmlFor is unique per block so each label really points at
            // its own input; the visible TEXT repeats across collaborators
            // deliberately (it's the backend catalog's label, unchanged) —
            // the "Collaborator N" heading above each block is what
            // disambiguates them for a sighted reader.
            const id = `${f.key}-${i}`;
            const err = fieldErrors[`${i}.${f.key}`];
            return (
              <div style={{ marginTop: 10 }} key={f.key}>
                <label className="lbl" htmlFor={id}>{f.label}</label>
                <input
                  id={id}
                  className="inp"
                  value={c[f.key] || ""}
                  onChange={(e) => onFieldChange(i, f.key, e.target.value)}
                />
                {err && <div style={{ color: "var(--accent-coral)", fontSize: 12.5, marginTop: 4 }}>{err}</div>}
              </div>
            );
          })}
        </div>
      ))}

      {collaborators.length < MAX_COLLABORATORS && (
        <button type="button" className="btn" onClick={onAdd}>Add another collaborator</button>
      )}

      {reviewError && <div className="fj-inline-error" role="alert" style={{ marginTop: 14 }}>{reviewError}</div>}

      <div className="fj-actions">
        <button className="btn btn-primary" onClick={onReview} disabled={reviewBusy}>
          {reviewBusy ? "Preparing…" : "Review"}
        </button>
      </div>
    </div>
  );
}

// ============ Shared: document tabs + embedded PDF viewer ============
// Data-driven from the backend's `agreements` list (never a hardcoded
// track check) — TIR's two agreements get two tabs, VIP's one gets none
// (nothing to switch between). Used by both the Review and Sign steps so
// the fetched document survives moving between them.
function DocTabs({ agreements, active, onChange }) {
  if (agreements.length <= 1) return null;
  return (
    <div className="fj-doc-tabs" role="tablist" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      {agreements.map((a) => (
        <button
          key={a.slug}
          type="button"
          role="tab"
          aria-selected={active === a.slug}
          className={active === a.slug ? "btn btn-primary" : "btn-ghost"}
          onClick={() => onChange(a.slug)}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

function AgreementPreview({ agreements, activeSlug, onSelectSlug, pdfUrl, pdfLoading, pdfError }) {
  const activeName = agreements.find((a) => a.slug === activeSlug)?.name || "your agreement";
  return (
    <div className="card" style={{ marginBottom: 16, padding: 12 }}>
      <DocTabs agreements={agreements} active={activeSlug} onChange={onSelectSlug} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 18, marginBottom: 6 }}>
        {pdfLoading && (
          <span className="fj-doc-updating" aria-live="polite" style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>
            Updating…
          </span>
        )}
      </div>
      {pdfError && <div className="fj-inline-error" role="alert" style={{ marginBottom: 8 }}>{pdfError}</div>}
      {pdfUrl ? (
        <iframe
          src={pdfUrl}
          title={`${activeName} preview`}
          style={{ width: "100%", height: "70vh", minHeight: 420, border: "1px solid var(--line-strong)", borderRadius: 2 }}
        />
      ) : (
        !pdfError && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-dim)" }}>
            Preparing your document…
          </div>
        )
      )}
    </div>
  );
}

// ============ STEP 1 · REVIEW ============
function ReviewStep({ agreements, activeSlug, onSelectSlug, pdfUrl, pdfLoading, pdfError, onBack, onSign }) {
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">Review before signing</span>
      <h1 className="fj-h1">Review each agreement</h1>
      <p className="fj-help">
        These are the {agreements.length === 1 ? "document" : "documents"} your track requires,
        rendered live from what you just entered. Read them through before continuing to sign.
      </p>

      <AgreementPreview
        agreements={agreements}
        activeSlug={activeSlug}
        onSelectSlug={onSelectSlug}
        pdfUrl={pdfUrl}
        pdfLoading={pdfLoading}
        pdfError={pdfError}
      />

      <div className="fj-actions">
        <button className="btn-ghost" type="button" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" type="button" onClick={onSign}>Continue to sign</button>
      </div>
    </div>
  );
}

// ============ STEP 2 · SIGN ============
function SignStep({
  agreements, activeSlug, onSelectSlug, pdfUrl, pdfLoading, pdfError,
  ackList, acked, toggleAck, allAcked, signerName, setSignerName, canvasRef, clearPad, sign, busy, hasInk, error, onBack,
}) {
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">Sign to accept</span>
      <h1 className="fj-h1">Sign your agreements</h1>
      <p className="fj-help">
        Your signature appears in the document below as soon as you draw it.
      </p>

      <AgreementPreview
        agreements={agreements}
        activeSlug={activeSlug}
        onSelectSlug={onSelectSlug}
        pdfUrl={pdfUrl}
        pdfLoading={pdfLoading}
        pdfError={pdfError}
      />

      <div className="panel">
        <div className="panel-h">Sign to accept</div>

        <fieldset className="mou-acks">
          <legend className="lbl">Acknowledgements — please confirm each of the following</legend>
          {ackList.map((a, i) => (
            <label className="mou-ack" key={a.id}>
              <input type="checkbox" checked={acked.includes(a.id)} onChange={() => toggleAck(a.id)} />
              <span className="mou-ack-num">{i + 1}.</span>
              <span className="mou-ack-text">{a.text}</span>
            </label>
          ))}
          {!allAcked && (
            <div className="mou-ack-hint">
              All {ackList.length} acknowledgements must be confirmed before you can sign.
            </div>
          )}
        </fieldset>

        <label className="lbl">Your full legal name</label>
        <input className="inp" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Your full name" />
        <div className="sigpad" style={{ marginTop: 14, border: "1px solid var(--line-strong)", borderRadius: 2 }}>
          <canvas id="sigpad" ref={canvasRef} width={520} height={180} />
        </div>
        {error && <div style={{ color: "var(--accent-coral)", marginTop: 8 }}>{error}</div>}
        <div className="row-actions" style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button className="btn-ghost" type="button" onClick={onBack}>← Back</button>
          <button className="btn" onClick={clearPad} type="button">Clear</button>
          <button
            className="btn btn-primary"
            onClick={sign}
            disabled={busy || !signerName.trim() || !hasInk || !allAcked}
          >
            {busy ? "Signing…" : "Sign & submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ SIGNED + DOWNLOAD ============
// After signing, the same embedded-document experience continues: the
// final signed PDF (with the real signature already in it) shown in the
// page, still individually downloadable per agreement. The signed PDF is
// served from Supabase Storage as a presigned URL (GET /founder/mou/signed-url)
// — no auth header needed to load it, so the <iframe> points at it directly
// rather than going through the blob-fetch path the live preview uses.
function SignedPanel({ mou, onDownload, downloadErrors }) {
  const agreements = mou.agreements || [];
  const [activeSlug, setActiveSlug] = useState(agreements[0]?.slug || null);
  const [embedUrl, setEmbedUrl] = useState(null);
  const [embedError, setEmbedError] = useState(null);

  useEffect(() => {
    if (!activeSlug) return;
    let cancelled = false;
    setEmbedUrl(null);
    setEmbedError(null);
    founderApi.mouSignedUrl(activeSlug)
      .then((r) => { if (!cancelled) setEmbedUrl(r.url); })
      .catch((e) => { if (!cancelled) setEmbedError(mouErrorCopy(e)); });
    return () => { cancelled = true; };
  }, [activeSlug]);

  const activeName = agreements.find((a) => a.slug === activeSlug)?.name || "your agreement";

  // A signature recorded before the agreements changed retrieves none of the
  // documents now on offer. Rendering the normal panel produced "Agreements
  // signed" above a row per document reading "Not part of what you signed" —
  // each true, together nonsense. Say what actually happened instead, and
  // offer nothing to download rather than a list that only fails.
  if (mou.signature_is_legacy) {
    return (
      <div>
        <span className="eyebrow eyebrow-rule">Onboarding · Your agreements</span>
        <div className="signed">
          <div className="top"><span className="ttl">Signed under a previous version</span></div>
          <div className="sub">
            {mou.signer_name} signed
            {mou.signed_at ? ` on ${new Date(mou.signed_at).toLocaleDateString()}` : ""} under an
            earlier version of the agreements, so the current documents aren't available to
            download here. Your cohort tabs stay unlocked. ARTPARK will be in touch if the
            agreements need re-signing.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Onboarding · Your agreements</span>
      <div className="signed">
        <div className="top"><span className="ttl">Agreements signed ✓</span></div>
        <div className="sub">
          Signed by {mou.signer_name}{mou.signed_at ? ` on ${new Date(mou.signed_at).toLocaleDateString()}` : ""}.
          Your cohort tabs are unlocked.
        </div>

        {agreements.length > 0 && (
          <div className="card" style={{ margin: "14px 0", padding: 12 }}>
            <DocTabs agreements={agreements} active={activeSlug} onChange={setActiveSlug} />
            {embedError ? (
              <div style={{ padding: 24, color: "var(--ink-dim)" }}>{embedError}</div>
            ) : embedUrl ? (
              <iframe
                src={embedUrl}
                title={`${activeName} — signed`}
                style={{ width: "100%", height: "70vh", minHeight: 420, border: "1px solid var(--line-strong)", borderRadius: 2 }}
              />
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-dim)" }}>Loading your document…</div>
            )}
          </div>
        )}

        <div className="frame" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agreements.map((a) => (
            <div key={a.slug} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>{a.name}</span>
              {downloadErrors[a.slug] === "agreement_not_signed" ? (
                <span style={{ color: "var(--ink-dim)" }}>Not part of what you signed</span>
              ) : (
                <button className="btn btn-primary" onClick={() => onDownload(a.slug)}>
                  Download {a.name}
                </button>
              )}
            </div>
          ))}
          {!agreements.length && (
            <button className="btn btn-primary" onClick={() => onDownload()}>Download signed MOU</button>
          )}
        </div>
      </div>
    </div>
  );
}
