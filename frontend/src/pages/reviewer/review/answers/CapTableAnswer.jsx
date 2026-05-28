// CapTableAnswer — SIP sip_founders jsonb array.
//
// Each entry is { name, type, percent }. Renders a 3-column table:
// Shareholder | Type | %. Percent right-aligned, monospace tabular nums.

import EmptyAnswer from "./EmptyAnswer.jsx";

export default function CapTableAnswer({ value }) {
  if (!Array.isArray(value) || value.length === 0) return <EmptyAnswer />;
  return (
    <div className="ans-captable">
      <div className="row head">
        <span>Shareholder</span>
        <span>Type</span>
        <span className="pct">%</span>
      </div>
      {value.map((entry, idx) => {
        const name = entry?.name || "(unnamed)";
        const type = entry?.type || "—";
        const pct = entry?.percent;
        return (
          <div key={idx} className="row">
            <span>{name}</span>
            <span>{type}</span>
            <span className="pct">
              {typeof pct === "number" ? `${pct}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
