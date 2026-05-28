// ScoreSegmentInput — segmented 1-10 score control.
//
// Renders 10 buttons in a radiogroup. Keyboard:
//   ArrowRight — increment (wraps 10 → 1)
//   ArrowLeft  — decrement (wraps 1 → 10)
// From null/undefined, ArrowRight selects 1 and ArrowLeft selects 10.
//
// Visual styling lives in reviewer.css under `.score-seg`. The component
// emits only structural markup; no shadows, sharp corners per the design
// system.

import { useCallback } from "react";

export default function ScoreSegmentInput({ label, value, onChange, disabled }) {
  const onKeyDown = useCallback((e) => {
    if (disabled) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = value === null || value === undefined
        ? 1
        : (value === 10 ? 1 : value + 1);
      onChange(next);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = value === null || value === undefined
        ? 10
        : (value === 1 ? 10 : value - 1);
      onChange(next);
    }
  }, [value, onChange, disabled]);

  return (
    <div className="score-seg" role="radiogroup" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-pressed={value === n ? "true" : "false"}
          aria-checked={value === n}
          aria-label={`Score ${n} out of 10 for ${label}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          onKeyDown={onKeyDown}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
