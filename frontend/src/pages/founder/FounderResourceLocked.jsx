// "Not released yet" screen for a Founders Resources tab. Deliberately
// distinct copy from FounderLocked.jsx: that component means "sign your MOU
// first" (conditional, unlocks as a group); this one means "this business
// relationship isn't real yet" (server-driven, per item, no MOU relationship
// at all). No "Go to Sign MOU" CTA here — there is nothing to sign.
export default function FounderResourceLocked({ label }) {
  return (
    <div className="panel" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 30 }}>🔒</div>
      <h2 style={{ fontFamily: "var(--font-display)", marginTop: 10 }}>{label} isn't open yet</h2>
      <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
        This part of Founders resources is still being set up. Check back soon — nothing to do here yet.
      </p>
    </div>
  );
}
