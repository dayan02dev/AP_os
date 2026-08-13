// The assumption-stack card — Approach step 2 (Experiments). Faithful port
// of TIR Onboarding.dc.html's showExperiments card markup + renderVals()
// `experimentsView` (trackMeta/testTypeMeta/tierMeta/locked).
//
// `onChange(field, value)` is called both on select onChange (immediate)
// and on textarea onBlur (matches the rest of the founder portal's
// blur-to-save convention, e.g. FounderOrganization.jsx) — the parent owns
// optimistic state + the PATCH call.
const TRACK_META = {
  technical: { label: "Technical", color: "var(--artblue)" },
  commercial: { label: "Commercial", color: "var(--accent-violet)" },
};

const TEST_TYPES = [
  { value: "literature", label: "Literature / prior art", tier: 1 },
  { value: "simulation", label: "Simulation / first-principles", tier: 1 },
  { value: "expert", label: "Expert / supplier call", tier: 2 },
  { value: "customer", label: "Customer conversation", tier: 2 },
  { value: "retro", label: "Retrospective data", tier: 2 },
  { value: "breadboard", label: "Breadboard experiment", tier: 3 },
  { value: "prototype", label: "Prototype / pilot", tier: 4 },
];

const TIER_META = {
  1: { label: "₹", color: "var(--accent-green)" },
  2: { label: "₹₹", color: "var(--accent-green)" },
  3: { label: "₹₹₹", color: "var(--accent-amber)" },
  4: { label: "₹₹₹₹", color: "var(--accent-coral)" },
};

export default function ExperimentCard({ exp, rank, onChange, onRemove }) {
  const track = TRACK_META[exp.track] || TRACK_META.technical;
  const testMeta = TEST_TYPES.find((t) => t.value === exp.test_type) || TEST_TYPES[0];
  const tier = TIER_META[testMeta.tier];
  const locked = exp.status !== "not-started";

  const onSelect = (field, cast = (v) => v) => (e) => onChange(field, cast(e.target.value));
  const onBlurText = (field) => (e) => onChange(field, e.target.value);

  return (
    <div className="card fj-exp-card" style={{ borderTopColor: track.color }}>
      <div className="fj-exp-head">
        <span className="fj-exp-rank" style={{ background: track.color }}>{rank}</span>
        <span className="fj-exp-tag" style={{ color: track.color, borderColor: track.color }}>
          {track.label}
        </span>
        <span className="fj-exp-cost">
          Test cost <span style={{ color: tier.color }}>{tier.label}</span>
        </span>
        <span className="fj-exp-spacer" />
        <label className="fj-exp-select-label">
          Gate
          <select value={String(exp.gate)} onChange={onSelect("gate", Number)}>
            <option value="1">Gate 1 · M2</option>
            <option value="2">Gate 2 · M4</option>
            <option value="3">Gate 3 · M6</option>
          </select>
        </label>
        <label className="fj-exp-select-label">
          Test
          <select value={exp.test_type} onChange={onSelect("test_type")}>
            {TEST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="fj-exp-select-label">
          Risk
          <select value={exp.risk} onChange={onSelect("risk")}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="fj-exp-select-label">
          Status
          <select value={exp.status} onChange={onSelect("status")}>
            <option value="not-started">Not started</option>
            <option value="running">Running</option>
            <option value="validated">Validated</option>
            <option value="invalidated">Invalidated</option>
          </select>
        </label>
        <a
          href="#"
          className="fj-exp-remove"
          onClick={(e) => { e.preventDefault(); onRemove(); }}
        >
          Remove
        </a>
      </div>

      <div className="fj-exp-body">
        <div className="fj-exp-2col">
          <label className="fj-exp-field">
            <span>Riskiest assumption</span>
            <textarea
              className="apply-textarea"
              defaultValue={exp.assumption || ""}
              onBlur={onBlurText("assumption")}
              placeholder="If this is false, the venture doesn't work because…"
            />
          </label>
          <label className="fj-exp-field">
            <span>Falsifiable hypothesis</span>
            <textarea
              className="apply-textarea"
              defaultValue={exp.hypothesis || ""}
              onBlur={onBlurText("hypothesis")}
              placeholder="We believe that… as measured by…"
            />
          </label>
        </div>
        <label className="fj-exp-field">
          <span>The cheapest test that could settle it</span>
          <textarea
            className="apply-textarea fj-exp-test"
            defaultValue={exp.test || ""}
            onBlur={onBlurText("test")}
            placeholder="Literature, a call, a simulation, a breadboard — the smallest thing that gives you the answer…"
          />
        </label>
        <div className="fj-exp-criteria">
          <div className="fj-exp-criteria-head">
            <span>Criteria — locked before you run</span>
            {locked ? (
              <span className="fj-exp-locked-chip">Locked · test in progress</span>
            ) : (
              <span className="fj-exp-unlocked-hint">
                Set these before the test starts — they can't be softened later.
              </span>
            )}
          </div>
          <div className="fj-exp-2col">
            <label className="fj-exp-field">
              <span className="pass">Pass criteria</span>
              <textarea
                className="apply-textarea fj-exp-crit"
                disabled={locked}
                defaultValue={exp.pass_criteria || ""}
                onBlur={onBlurText("pass_criteria")}
                placeholder="Passes if…"
              />
            </label>
            <label className="fj-exp-field">
              <span className="kill">Kill / invalidate criteria</span>
              <textarea
                className="apply-textarea fj-exp-crit"
                disabled={locked}
                defaultValue={exp.kill_criteria || ""}
                onBlur={onBlurText("kill_criteria")}
                placeholder="Invalidated if…"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
