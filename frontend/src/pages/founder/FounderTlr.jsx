// TLR evaluation — the ARTPARK Innovation Readiness (AIR) scorecard.
// Phase 1 ships the route and an empty state; Phase 2 replaces this body with
// the five-step wizard (Overview / Technology / Commercial / Evidence /
// Scorecard). See docs/superpowers/specs/2026-08-15-vip-onboarding-design.md §4.
export default function FounderTlr() {
  return (
    <>
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Cohort management · TLR evaluation</div>
        <h1 className="eir-os-view-title">ARTPARK Innovation Readiness</h1>
        <p className="eir-os-view-sub">
          Assess your venture across six transversal levers — three technology,
          three commercial — and submit the evidence for each level you claim.
        </p>
      </header>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h">Coming next</div>
        <p style={{ padding: 16, margin: 0 }}>
          The assessment opens here shortly.
        </p>
      </div>
    </>
  );
}
