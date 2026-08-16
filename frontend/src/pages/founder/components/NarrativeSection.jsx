// One MIS section's free-text prompts (spec §5, e.g. §1 Executive Summary,
// §4 Commercial & Customer Traction). Presentational only, no `founderApi`
// import — the caller (FounderMis.jsx, Task 7) owns the actual
// `putMisNarrative` PUT and its debounce-on-blur timing; this component
// only reports `onChange(fieldId, value)` upward, with `value` already
// normalised (a real string, or `null` for empty — never `""`, matching the
// "API validates, never coerces" constraint).
//
// `fields`/prompts come entirely from `bundle.catalog.narrative_fields`
// (server-owned) — nothing here is hardcoded.
//
// A field id absent from `values` (never yet touched) is not an ambiguous
// empty state the way E5-E21 are: a blank narrative field has exactly one
// meaning, "not answered yet." So this renders a plain empty textarea, no
// special copy.
//
// Uncontrolled by design (`defaultValue`, not `value`), matching
// ExperimentCard.jsx's established blur-commit idiom: typing never fires
// `onChange`, only blurring an actually-changed value does.
export default function NarrativeSection({ fields, values, disabled, onChange }) {
  const vals = values || {};

  const handleBlur = (fieldId) => (e) => {
    if (disabled) return;
    const raw = e.target.value;
    const trimmed = raw.trim();
    onChange(fieldId, trimmed === "" ? null : raw);
  };

  return (
    <div className="mis-narrative-section">
      {(fields || []).map((f) => (
        <div className="mis-narrative-field" key={f.id}>
          <label className="mis-narrative-prompt" htmlFor={`mis-narrative-${f.id}`}>
            {f.prompt}
          </label>
          <textarea
            id={`mis-narrative-${f.id}`}
            defaultValue={vals[f.id] ?? ""}
            disabled={disabled}
            onBlur={handleBlur(f.id)}
          />
        </div>
      ))}
    </div>
  );
}
