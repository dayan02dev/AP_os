// MetricCard — one of the five top-of-page summary tiles.
// Optional `split` renders a stacked bar pair (TIR / SIP); when present
// the `sub` prop is ignored.

export default function MetricCard({ kicker, value, sub, accent, split }) {
  return (
    <div className={`lp-metric ${accent ? "lp-metric-accent" : ""}`}>
      <div className="eir-mono lp-metric-kicker">{kicker}</div>
      <div className="lp-metric-value">{value}</div>
      {split && (
        <div className="lp-metric-split">
          {split.map((s) => (
            <div className="lp-metric-split-row" key={s.label}>
              <span className="eir-mono lp-metric-split-label">{s.label}</span>
              <span className="lp-metric-split-bar">
                <span
                  className="lp-metric-split-bar-fill"
                  style={{ width: `${s.pct}%` }}
                />
              </span>
              <span className="eir-mono lp-metric-split-n">{s.n}</span>
            </div>
          ))}
        </div>
      )}
      {sub && !split && (
        <div className="eir-mono eir-dim lp-metric-sub">{sub}</div>
      )}
    </div>
  );
}
