// Numbered-circle stepper used by the Approach 6-step wizard and the
// Organization 3-step wizard. Faithful port of TIR Onboarding.dc.html's
// renderVals() `steps`/`orgSteps` computation:
//   active  -> filled artblue circle + glow
//   done    -> filled green circle + checkmark, connector to it greens
//   default -> outlined circle, dim label
// Plus the sticky eyebrow/progress-label header and the thin progress bar.
export default function Stepper({ steps, current, furthest, onGo, eyebrow, progressLabel }) {
  const total = steps.length;
  return (
    <div className="fj-stepper-wrap">
      <div className="fj-stepper-head">
        <div className="fj-stepper-top">
          <span className="eyebrow">{eyebrow}</span>
          <span className="fj-stepper-progress-label">{progressLabel}</span>
        </div>
        <div className="fj-stepper-row">
          {steps.map((step, i) => {
            const label = typeof step === "string" ? step : step.label;
            const active = i === current;
            const done = i < furthest && !active;
            return (
              <button
                type="button"
                key={label}
                className="fj-step-btn"
                onClick={() => onGo(i)}
              >
                {i > 0 && (
                  <div className={`fj-step-conn${i <= furthest ? " is-done" : ""}`} />
                )}
                <span
                  className={`fj-step-circle${active ? " is-active" : done ? " is-done" : ""}`}
                >
                  {done ? "✓" : String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`fj-step-label${active ? " is-active" : done ? " is-done" : ""}`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="apply-progress">
        <div className="bar" style={{ width: `${((current + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}
