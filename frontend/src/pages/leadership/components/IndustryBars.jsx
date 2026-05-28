// IndustryBars — horizontal bars showing how many apps each industry has.
// Driven directly by GET /leadership/stats → industry.industries, which is
// already sorted by `n` desc on the backend.

export default function IndustryBars({ industries, total, activeIndustry, onFilter }) {
  if (!industries || industries.length === 0) {
    return (
      <p className="lp-placeholder">
        No industry data yet — applications will populate this once they
        start being submitted.
      </p>
    );
  }
  const max = Math.max(1, ...industries.map((c) => c.n));
  return (
    <div className="lp-ind">
      {industries.map((c) => {
        const w = (c.n / max) * 100;
        const pct =
          typeof c.pct === "number"
            ? Math.round(c.pct)
            : total
              ? Math.round((c.n / total) * 100)
              : 0;
        const clickable = typeof onFilter === "function";
        const isActive = activeIndustry === c.id;
        const className = `lp-ind-row${isActive ? " is-on" : ""}`;
        const content = (
          <>
            <div className="lp-ind-label">{c.label}</div>
            <div className="lp-ind-bar-wrap">
              <div className="lp-ind-bar" style={{ width: `${w}%` }} />
              <span className="eir-mono lp-ind-n">
                <strong>{c.n}</strong>
                <span className="eir-dim"> · {pct}%</span>
              </span>
            </div>
          </>
        );
        return clickable ? (
          <button
            type="button"
            className={className}
            key={c.id}
            onClick={() => onFilter(isActive ? null : c.id)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: 14,
              alignItems: "center",
            }}
          >
            {content}
          </button>
        ) : (
          <div className={className} key={c.id}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
