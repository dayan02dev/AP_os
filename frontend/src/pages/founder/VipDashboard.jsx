// Process dashboard — VIP placeholder.
//
// FounderDashboard is TIR-only: it renders a "Residency dashboard" eyebrow,
// a "TIR · {cohort}" sub-line, and is fed by residency tables that are empty
// for a `sip` application. Routing a VIP founder there shows them the other
// programme's name over zeroed data, so this tab gets its own placeholder
// until the real VIP dashboard (AIR + MIS rollups) ships in Phase 4. See
// docs/superpowers/specs/2026-08-15-vip-onboarding-design.md §6. Shaped like
// FounderTlr.jsx / FounderMis.jsx: no state, no fetching.
export default function VipDashboard() {
  return (
    <>
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Dashboard reporting · Process dashboard</div>
        <h1 className="eir-os-view-title">Your programme dashboard</h1>
        <p className="eir-os-view-sub">
          This will summarise your TLR evaluation and MIS reporting once those
          are in use.
        </p>
      </header>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h">Coming next</div>
        <p style={{ padding: 16, margin: 0 }}>
          Your dashboard rollup opens here shortly.
        </p>
      </div>
    </>
  );
}
