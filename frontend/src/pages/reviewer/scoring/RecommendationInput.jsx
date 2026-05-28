// RecommendationInput — segmented Yes / Maybe / No control for the reviewer's
// overall recommendation. Visual styling lives in reviewer.css under
// `.score-seg.is-rec`.

const OPTIONS = [
  { value: "yes",   label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no",    label: "No" },
];

export default function RecommendationInput({ value, onChange, disabled }) {
  return (
    <div className="score-seg is-rec" role="radiogroup" aria-label="Recommendation">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-pressed={value === opt.value ? "true" : "false"}
          aria-checked={value === opt.value}
          aria-label={`Recommendation ${opt.label}`}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
