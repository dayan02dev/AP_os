// Residency-dashboard stat tile: label + big value + optional meter + sub.
// Faithful to the mockup's 4-up tile row (derisking%/workplan/budget drawn/
// next milestone) — `dark` renders the card-black "Next milestone" variant.
export default function StatTile({ label, value, meter, sub, dark = false }) {
  return (
    <div className={`fj-stat-tile${dark ? " dark" : ""}`}>
      <span className="fj-stat-label">{label}</span>
      <div className="fj-stat-value">{value}</div>
      {meter && (
        <div className="fj-stat-meter">
          <div style={{ width: `${Math.max(0, Math.min(100, meter.value))}%`, background: meter.color }} />
        </div>
      )}
      {sub && <span className="fj-stat-sub">{sub}</span>}
    </div>
  );
}
