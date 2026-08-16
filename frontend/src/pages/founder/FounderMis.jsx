// MIS filling — monthly and quarterly reporting periods (spec §5).
//
// One `GET /founder/mis` bundle drives the kind tabs and both periods
// lists; selecting a period fires one `GET /founder/mis/{kind}/{period_key}`
// that returns everything that period needs (catalog slice, rows, narrative,
// derived values) in a single read. Every section is dispatched purely from
// `bundle.catalog.sections` — nothing about section numbers, titles, hints,
// field lists or option labels is hardcoded (see the six section components
// this shell composes: PeriodPicker, NarrativeSection, MetricsGrid,
// EntriesTable, FinancialsGrid, HeadcountGrid).
//
// Autosave and request sequencing mirror FounderTlr.jsx (the AIR wizard):
// optimistic-free, server-truth-driven — every write's response replaces
// `bundle` wholesale, and a single monotonic `genRef` counter guards against
// an out-of-order response (an old period-switch or an old write) clobbering
// a newer one, the same shape AIR's per-lever PUTs need.
//
// IMPORTANT, discovered reading the frozen backend (not in the plan's own
// contract table): `putMisMetrics` and `putMisHeadcount` are NOT
// partial-field patches at the row level. `put_metrics`/`put_headcount` both
// `.upsert(rows, on_conflict=...)` with every listed column, unconditionally
// — so sending only the one changed field (e.g. `{metric_key, actual}`)
// would null out that row's `target`/`rag`/`commentary` (or
// `exited`/`remarks`) server-side the next time it saves. This shell always
// reads the row's current full state out of `bundle` and merges the one
// changed field into it before calling those two thunks — see
// `metricRowPayload`/`headcountRowPayload` below. `putMisFinancials` has no
// such trap: `amount` is the only writable column per (series, bucket), so
// a single-field payload IS already the whole row there.
import { useEffect, useRef, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";
import PeriodPicker from "./components/PeriodPicker.jsx";
import NarrativeSection from "./components/NarrativeSection.jsx";
import MetricsGrid from "./components/MetricsGrid.jsx";
import EntriesTable from "./components/EntriesTable.jsx";
import FinancialsGrid from "./components/FinancialsGrid.jsx";
import HeadcountGrid from "./components/HeadcountGrid.jsx";
import "../../styles/founder-mis.css";
import "../../styles/founder-mis-grids.css";

const KIND_LABELS = { monthly: "Monthly", quarterly: "Quarterly" };

// Mirrors `mis_catalog.SECTION_EXTRA_ENTRIES` — a fixed structural fact
// (which entries tables exist per template) rather than a behavioural rule,
// and already fully described in that module's own docstring; see the
// implementation plan's Task 7 note on why this is a narrow, deliberate
// exception to "nothing about the template is hardcoded." Today it is
// exactly one extra table: quarterly §9.2 "next_milestones", hanging off
// §9.1 "planned_vs_actual". The catalog supplies `entry_fields` for it but
// no SECTIONS row and therefore no title — mis-templates.md §9.2 names it
// "Top milestones for next quarter"; this is a hardcoded display label, not
// a hardcoded rule.
const SECTION_EXTRA_ENTRIES = { planned_vs_actual: ["next_milestones"] };
const EXTRA_ENTRIES_TITLE = { next_milestones: "Next-quarter milestones" };

// founder_mis.py raises every error as `detail={"code": …}`; api.js's
// _buildError sets message to the literal "Request failed" whenever detail
// has no own `message` — so every unmapped code reads identically. Map the
// ones this UI can actually hit to real copy, mirroring FounderTlr's
// AIR_ERROR_COPY/describeActionError. `mis_earlier_period_open` is
// deliberately absent here — it only ever happens on submit and gets its
// own dedicated banner (E23), never this generic one.
const MIS_ERROR_COPY = {
  mis_already_submitted: "This period was submitted elsewhere — refreshing.",
};

function describeActionError(err) {
  const copy = err?.code && MIS_ERROR_COPY[err.code];
  if (copy) return copy;
  if (err?.message && err.message !== "Request failed") return err.message;
  return "Something went wrong saving that change.";
}

// The earliest DRAFT period if any exist (exactly the period a founder must
// file next, per the in-order-submit rule); otherwise the most recent
// SUBMITTED period (nothing left to do — show the latest filed report);
// otherwise the first entry (shouldn't happen, defensive only). `periods`
// is already oldest-first (Global Constraint), so "earliest" is the first
// match scanning forward and "most recent" is the first match scanning
// backward — no date math needed.
function defaultPeriodKey(periods) {
  if (!periods || periods.length === 0) return null;
  const earliestDraft = periods.find((p) => p.status === "draft");
  if (earliestDraft) return earliestDraft.period_key;
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].status === "submitted") return periods[i].period_key;
  }
  return periods[0].period_key;
}

// Full current row, patched with the one field that just changed — see the
// file header on why metrics rows must always be sent whole.
function metricRowPayload(bundle, metricKey, field, value) {
  const current = (bundle.metrics || []).find((m) => m.metric_key === metricKey) || {};
  return {
    metric_key: metricKey,
    label: current.label ?? null,
    target: current.target ?? null,
    actual: current.actual ?? null,
    rag: current.rag ?? null,
    commentary: current.commentary ?? null,
    [field]: value,
  };
}

function headcountRowPayload(bundle, category, field, value) {
  const current = (bundle.headcount || []).find((h) => h.category === category) || {};
  return {
    category,
    current_count: current.current_count ?? null,
    exited: current.exited ?? null,
    remarks: current.remarks ?? null,
    [field]: value,
  };
}

function MisHeader() {
  return (
    <header className="eir-os-view-head">
      <div className="eir-mono eir-dim eir-os-crumb">Cohort management · MIS filling</div>
      <h1 className="eir-os-view-title">Monthly and quarterly reporting</h1>
      <p className="eir-os-view-sub">
        Your monthly update and quarterly review, captured here and carried
        forward period to period.
      </p>
    </header>
  );
}

export default function FounderMis() {
  const [index, setIndex] = useState(null);
  const [indexError, setIndexError] = useState(null);
  const [kind, setKind] = useState("monthly");
  const [selectedKey, setSelectedKey] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState(null);
  const [actionError, setActionError] = useState(null);
  // E23: the earlier period a blocked submit must be pointed at —
  // {period_key, label} — distinct from `actionError`, never rendered
  // through the generic banner.
  const [blocked, setBlocked] = useState(null);

  // Monotonically increasing per dispatched request that can replace
  // `bundle` (a period load, a section write, a submit, an E24 refetch). A
  // response is only applied if no newer one has been dispatched since —
  // MIS's autosave fires a PUT per blurred field, so two responses landing
  // out of order is the normal rhythm here, exactly as FounderTlr.jsx's
  // genRef guards for AIR's per-lever PUTs.
  const genRef = useRef(0);

  useEffect(() => {
    founderApi.getMis().then((idx) => {
      setIndex(idx);
      const initialKind = (idx.monthly && idx.monthly.length > 0)
        ? "monthly"
        : (idx.quarterly && idx.quarterly.length > 0) ? "quarterly" : "monthly";
      setKind(initialKind);
      const key = defaultPeriodKey(idx[initialKind]);
      setSelectedKey(key);
      loadPeriod(initialKind, key);
    }).catch(setIndexError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadPeriod(k, key) {
    if (!key) { setBundle(null); setPeriodLoading(false); return; }
    setBundle(null);
    setPeriodLoading(true);
    setPeriodError(null);
    const gen = ++genRef.current;
    founderApi.getMisPeriod(k, key).then((b) => {
      if (gen !== genRef.current) return;
      setBundle(b);
      setPeriodLoading(false);
    }).catch((err) => {
      if (gen !== genRef.current) return;
      setPeriodError(err);
      setPeriodLoading(false);
    });
  }

  // Pulls the truth back from the server after a write 409s
  // `mis_already_submitted` (E24) — the period was frozen elsewhere since
  // this page loaded, so the optimistic-free bundle we're holding is stale;
  // silent, matching FounderTlr's `refetchBundle`, so the UI just flips to
  // E22 rather than failing to save forever with no explanation.
  function refetchPeriod() {
    const gen = ++genRef.current;
    founderApi.getMisPeriod(kind, selectedKey).then((b) => {
      if (gen !== genRef.current) return;
      setBundle(b);
    }).catch(() => {});
  }

  function selectKind(k) {
    if (k === kind) return;
    setKind(k);
    setActionError(null);
    setBlocked(null);
    const key = defaultPeriodKey(index?.[k] || []);
    setSelectedKey(key);
    loadPeriod(k, key);
  }

  function selectPeriod(key) {
    setSelectedKey(key);
    setActionError(null);
    setBlocked(null);
    loadPeriod(kind, key);
  }

  function goToBlocked() {
    if (blocked) selectPeriod(blocked.period_key);
  }

  // Every write endpoint returns the whole period bundle — replace state
  // wholesale rather than merging, so `overdue`/`vs_last`/`needs_gap`/
  // `net_change` all re-derive server-side in one shot.
  function applyWrite(promise) {
    const gen = ++genRef.current;
    promise.then((b) => {
      if (gen !== genRef.current) return;
      setActionError(null);
      setBundle(b);
    }).catch((err) => {
      setActionError(err);
      if (err?.code === "mis_already_submitted") refetchPeriod();
    });
  }

  function onNarrativeChange(fieldId, value) {
    applyWrite(founderApi.putMisNarrative(kind, selectedKey, { [fieldId]: value }));
  }

  function onMetricsChange(metricKey, field, value) {
    const row = metricRowPayload(bundle, metricKey, field, value);
    applyWrite(founderApi.putMisMetrics(kind, selectedKey, [row]));
  }

  function onEntriesSave(sectionId, rows) {
    applyWrite(founderApi.putMisEntries(kind, selectedKey, sectionId, rows));
  }

  function onFinancialsChange(series, bucket, amount) {
    applyWrite(founderApi.putMisFinancials(kind, selectedKey, [{ series, bucket, amount }]));
  }

  function onHeadcountChange(category, field, value) {
    const row = headcountRowPayload(bundle, category, field, value);
    applyWrite(founderApi.putMisHeadcount(kind, selectedKey, [row]));
  }

  function onSubmit() {
    const gen = ++genRef.current;
    founderApi.submitMisPeriod(kind, selectedKey).then((b) => {
      if (gen !== genRef.current) return;
      setActionError(null);
      setBlocked(null);
      setBundle(b);
    }).catch((err) => {
      if (err?.code === "mis_earlier_period_open") {
        setBlocked({ period_key: err.details?.period_key, label: err.details?.label });
      } else {
        setActionError(err);
        if (err?.code === "mis_already_submitted") refetchPeriod();
      }
    });
  }

  if (indexError) return <ErrorState error={indexError} />;
  if (!index) return <Loading label="Loading your MIS reporting…" />;

  const monthlyPeriods = index.monthly || [];
  const quarterlyPeriods = index.quarterly || [];
  const isOnboarded = monthlyPeriods.length > 0 || quarterlyPeriods.length > 0;

  if (!isOnboarded) {
    // E1: application is `offered`, not yet `onboarded` — get_mis returns
    // empty calendars rather than guessing a start date. No tabs, no
    // period list.
    return (
      <div className="mis-shell">
        <MisHeader />
        <p className="hint" style={{ marginTop: 24 }}>
          MIS reporting opens once your venture is onboarded. Nothing is due yet.
        </p>
      </div>
    );
  }

  const periodsForKind = (index[kind] || []);
  const isFirstPeriod = periodsForKind.length > 0 && periodsForKind[0].period_key === selectedKey;
  const disabled = bundle ? bundle.period.status !== "draft" : false;

  return (
    <div className="mis-shell">
      <MisHeader />

      <div className="mis-kind-tabs" role="tablist">
        {["monthly", "quarterly"].map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`mis-kind-tab${kind === k ? " is-active" : ""}`}
            onClick={() => selectKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <PeriodPicker kind={kind} periods={periodsForKind} selectedKey={selectedKey} onSelect={selectPeriod} />

      {actionError && (
        <div className="fj-inline-error" role="alert">
          {describeActionError(actionError)}
        </div>
      )}

      {blocked && (
        <div className="mis-blocked-banner" role="alert">
          <span>Submit {blocked.label} first.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={goToBlocked}>
            Go to {blocked.label}
          </button>
        </div>
      )}

      {periodError && <ErrorState error={periodError} />}

      {!periodError && periodLoading && <Loading label="Loading this period…" />}

      {!periodError && !periodLoading && bundle && (
        <PeriodSections
          key={bundle.period.id}
          bundle={bundle}
          isFirstPeriod={isFirstPeriod}
          disabled={disabled}
          onNarrativeChange={onNarrativeChange}
          onMetricsChange={onMetricsChange}
          onEntriesSave={onEntriesSave}
          onFinancialsChange={onFinancialsChange}
          onHeadcountChange={onHeadcountChange}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

// Keyed by `bundle.period.id` in the parent so this whole subtree remounts
// on a genuine period switch (resetting NarrativeSection's uncontrolled
// textareas to the new period's values — it has no resync effect the way
// EntriesTable/FinancialsGrid/HeadcountGrid do) but NOT on a same-period
// write response (period.id unchanged), so an unrelated field mid-edit
// elsewhere on the page isn't disturbed by, say, a metrics autosave.
function PeriodSections({
  bundle, isFirstPeriod, disabled,
  onNarrativeChange, onMetricsChange, onEntriesSave, onFinancialsChange, onHeadcountChange, onSubmit,
}) {
  const sections = bundle.catalog.sections || [];
  return (
    <div className="mis-sections">
      {sections.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          bundle={bundle}
          isFirstPeriod={isFirstPeriod}
          disabled={disabled}
          onNarrativeChange={onNarrativeChange}
          onMetricsChange={onMetricsChange}
          onEntriesSave={onEntriesSave}
          onFinancialsChange={onFinancialsChange}
          onHeadcountChange={onHeadcountChange}
        />
      ))}
      <SubmitGate bundle={bundle} onSubmit={onSubmit} />
    </div>
  );
}

function SectionCard({
  section, bundle, isFirstPeriod, disabled,
  onNarrativeChange, onMetricsChange, onEntriesSave, onFinancialsChange, onHeadcountChange,
}) {
  const narrativeFields = bundle.catalog.narrative_fields?.[section.id] || [];
  const extraEntryIds = SECTION_EXTRA_ENTRIES[section.id] || [];

  return (
    <div className="mis-section-card" data-section-id={section.id}>
      <div className="mis-section-head">
        <span className="mis-section-number">Section {section.number}</span>
        <h3 className="mis-section-title">{section.title}</h3>
        {section.hint && <p className="hint">{section.hint}</p>}
      </div>

      <div className="mis-section-body">
        {section.type === "narrative" && (
          <NarrativeSection
            fields={narrativeFields}
            values={bundle.narrative}
            disabled={disabled}
            onChange={onNarrativeChange}
          />
        )}

        {section.type === "metrics" && (
          <MetricsGrid
            metrics={bundle.metrics}
            metricGroups={bundle.catalog.metric_groups}
            vsLast={bundle.derived.metrics.vs_last}
            isFirstPeriod={isFirstPeriod}
            disabled={disabled}
            onChange={onMetricsChange}
          />
        )}

        {section.type === "entries" && (
          <>
            <EntriesTable
              sectionId={section.id}
              title={section.title}
              fields={bundle.catalog.entry_fields?.[section.id] || []}
              rows={bundle.entries?.[section.id] || []}
              isFirstPeriod={isFirstPeriod}
              disabled={disabled}
              onSave={onEntriesSave}
            />
            {extraEntryIds.map((extraId) => (
              <EntriesTable
                key={extraId}
                sectionId={extraId}
                title={EXTRA_ENTRIES_TITLE[extraId] || extraId}
                fields={bundle.catalog.entry_fields?.[extraId] || []}
                rows={bundle.entries?.[extraId] || []}
                isFirstPeriod={isFirstPeriod}
                disabled={disabled}
                onSave={onEntriesSave}
              />
            ))}
            {narrativeFields.length > 0 && (
              <NarrativeSection
                fields={narrativeFields}
                values={bundle.narrative}
                disabled={disabled}
                onChange={onNarrativeChange}
              />
            )}
          </>
        )}

        {section.type === "financials" && (
          <>
            <FinancialsGrid
              financials={bundle.financials}
              financialSeries={bundle.catalog.financial_series}
              financialBuckets={bundle.catalog.financial_buckets}
              needsGap={bundle.derived.financials.needs_gap}
              disabled={disabled}
              onChange={onFinancialsChange}
            />
            {narrativeFields.length > 0 && (
              <NarrativeSection
                fields={narrativeFields}
                values={bundle.narrative}
                disabled={disabled}
                onChange={onNarrativeChange}
              />
            )}
          </>
        )}

        {section.type === "headcount" && (
          <>
            <HeadcountGrid
              headcount={bundle.headcount}
              headcountCategories={bundle.catalog.headcount_categories}
              derived={bundle.derived.headcount}
              isFirstPeriod={isFirstPeriod}
              disabled={disabled}
              onChange={onHeadcountChange}
            />
            {narrativeFields.length > 0 && (
              <NarrativeSection
                fields={narrativeFields}
                values={bundle.narrative}
                disabled={disabled}
                onChange={onNarrativeChange}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// No client-side completeness gate, ever (Formulas-not-to-invent #2):
// `submit_period` only checks period ordering, so Submit stays enabled
// through every section regardless of what's filled in.
function SubmitGate({ bundle, onSubmit }) {
  const { period } = bundle;
  if (period.status !== "draft") {
    return (
      <div className="mis-submit-gate is-submitted">
        <span className="dot green" />
        <div>
          <div className="tt">Submitted</div>
          <div className="ss">
            {period.submitted_at
              ? `Submitted ${new Date(period.submitted_at).toLocaleDateString()}.`
              : "Submitted."}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mis-submit-gate">
      <button type="button" className="btn btn-primary" onClick={onSubmit}>
        Submit {period.label}
      </button>
      <span className="hint">Nothing is required before submitting — send it whenever this period is ready.</span>
    </div>
  );
}
