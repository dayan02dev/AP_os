// One kind's ("monthly" or "quarterly") list of MIS reporting periods,
// oldest-first, matching the backend's in-order-submit rule
// (`mis_periods.py` / ruling P3-R7). Presentational only, no `founderApi`
// import — the caller (FounderMis.jsx, Task 7) owns fetching and selection
// state; this component only renders `periods` exactly as given and reports
// clicks upward through `onSelect`.
//
// `periods` must NEVER be sorted or reversed here — `getMis()` already
// returns both `monthly` and `quarterly` oldest-first
// (`mis_query._fetch_periods` sorts by `period_key` ascending), and a
// founder must file periods in that same order. Silently re-sorting would
// make an already-correct array look wrong the moment the caller passes one
// that doesn't happen to be date-sorted (e.g. a test fixture), so a test
// here proves order is preserved with a fixture that would look reversed if
// this component "fixed" it.
export default function PeriodPicker({ kind, periods, selectedKey, onSelect }) {
  if (!periods || periods.length === 0) {
    // E2: defensive-only state — shouldn't happen once onboarded, but must
    // render something sane rather than an empty list with no explanation.
    return (
      <div className="mis-period-list mis-period-list-empty">
        No {kind} periods yet — check back once your first one opens.
      </div>
    );
  }

  return (
    <div className="mis-period-list">
      {periods.map((p) => {
        const isSelected = p.period_key === selectedKey;
        const isOverdue = p.status === "draft" && p.overdue === true;
        return (
          <button
            type="button"
            key={p.period_key}
            data-period-key={p.period_key}
            className={`mis-period-chip${isSelected ? " is-selected" : ""}`}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(p.period_key)}
          >
            <span className="mis-period-label">{p.label}</span>
            {/* Mutually exclusive, in priority order: overdue is checked
                before submitted so a defect in the overdue condition can't
                silently hide behind the submitted branch (and vice versa) —
                see the mutation-check note in the test file. */}
            {isOverdue ? (
              <span className="mis-period-status is-overdue">Overdue</span>
            ) : p.status === "submitted" ? (
              <span className="mis-period-status is-submitted">Submitted</span>
            ) : p.status === "draft" ? (
              <span className="mis-period-status is-draft">Draft</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
