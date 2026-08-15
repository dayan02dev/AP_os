// MIS filling — monthly and quarterly reporting periods.
// Phase 1 ships the route and an empty state; Phase 3 replaces this body with
// the period list and the two forms. See
// docs/superpowers/specs/2026-08-15-vip-onboarding-design.md §5.
export default function FounderMis() {
  return (
    <>
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Cohort management · MIS filling</div>
        <h1 className="eir-os-view-title">Monthly and quarterly reporting</h1>
        <p className="eir-os-view-sub">
          Your monthly update and quarterly review, captured here and carried
          forward period to period.
        </p>
      </header>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h">Coming next</div>
        <p style={{ padding: 16, margin: 0 }}>
          Reporting periods open here shortly.
        </p>
      </div>
    </>
  );
}
