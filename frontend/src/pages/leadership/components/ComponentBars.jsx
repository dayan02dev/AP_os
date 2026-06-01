// ComponentBars — five-row weighted breakdown of the AI score.
// Used in two modes:
//   1. Dashboard tab: no per-component data available (list endpoint only
//      returns overall). Caller passes `placeholder` and we render hint copy.
//   2. AppDrawer: caller passes `scores` = { score_problem, score_completeness,
//      score_tech, score_founders, score_commitment }, each 0–10 or null.
//
// Keys match the ai_screening table columns; labels & weights mirror the
// prototype's design.

const KEYS = [
  { id: "score_problem",    label: "Problem Statement Impact and Importance", weight: 22 },
  { id: "score_completeness", label: "Completeness, Depth of Solution",      weight: 30 },
  { id: "score_tech",       label: "Technical Depth",                        weight: 22 },
  { id: "score_founders",   label: "Professional Profile of Founder",        weight: 14 },
  { id: "score_commitment", label: "Commitment to be fully available",       weight: 12 },
];

export default function ComponentBars({ scores, placeholder }) {
  if (placeholder) {
    return (
      <p className="lp-placeholder">
        Per-component averages will appear once apps have been AI-scored.
        Today the dashboard only ships overall scores from the list endpoint;
        component-level rollups land in a later session.
      </p>
    );
  }

  return (
    <div className="lp-comp">
      {KEYS.map((k) => {
        const raw = scores?.[k.id];
        const hasVal = typeof raw === "number" && Number.isFinite(raw);
        const display = hasVal ? raw.toFixed(1) : "—";
        const widthPct = hasVal ? Math.max(0, Math.min(100, raw * 10)) : 0;
        return (
          <div className="lp-comp-row" key={k.id}>
            <div className="lp-comp-row-head">
              <span className="lp-comp-label">{k.label}</span>
              <span className="eir-mono eir-dim lp-comp-weight">
                weight {k.weight}%
              </span>
              <span className="eir-mono lp-comp-avg">
                <strong>{display}</strong>/10
              </span>
            </div>
            <div className="lp-comp-track">
              <div
                className="lp-comp-fill"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
