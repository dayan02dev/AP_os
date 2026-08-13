// Shared atoms for the Founder Portal tabs.

export function fmtINR(n) {
  const v = Math.round(Number(n) || 0);
  return "₹" + v.toLocaleString("en-IN");
}

// Lakh formatter — matches the mockup's fmtL exactly (TIR Onboarding.dc.html
// renderVals(): `v => "₹" + ((v||0)/100000).toFixed(2).replace(/\.?0+$/, "") + "L"`).
// 540000 -> "₹5.4L", 923000 -> "₹9.23L", 0 -> "₹0L".
export function fmtL(n) {
  const v = (Number(n) || 0) / 100000;
  return "₹" + v.toFixed(2).replace(/\.?0+$/, "") + "L";
}

export function sum(rows, field) {
  return (rows || []).reduce((a, r) => a + (Number(r?.[field]) || 0), 0);
}

export function lineTotal(row) {
  return (Number(row?.qty) || 0) * (Number(row?.unit_cost) || 0);
}

export function Loading({ label = "Loading…" }) {
  return <div className="fp-state" style={{ padding: 40, color: "var(--ink-dim)" }}>{label}</div>;
}

export function ErrorState({ error }) {
  return (
    <div className="fp-state" style={{ padding: 40, color: "var(--accent-coral)" }}>
      {error?.message || "Something went wrong."}
    </div>
  );
}

export function Tile({ k, v, s, children }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
      {children}
    </div>
  );
}
