// Stacked horizontal budget bar + legend — residency dashboard's "Total
// drawn" strip (payroll drawn / capital (BOM+equipment) / remaining).
export default function BudgetBar({ segments = [], total = 0 }) {
  return (
    <div className="fj-budget-bar-wrap">
      <div className="fj-budget-bar">
        {segments.map((s) => (
          <div
            key={s.label}
            style={{ width: total ? `${Math.max(0, (s.value / total) * 100)}%` : "0%", background: s.color }}
          />
        ))}
      </div>
      <div className="fj-budget-legend">
        {segments.map((s) => (
          <span key={s.label} className="fj-budget-legend-item">
            <span className="fj-budget-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
