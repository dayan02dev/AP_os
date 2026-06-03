// Ported from os/shell.jsx → ScoreBar
export default function ScoreBar({ label, value, max = 10, kind = "", ticks = true }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className={"os-scorebar " + kind}>
      <div className="os-scorebar-label">{label}</div>
      <div className="os-scorebar-track">
        <div className="os-scorebar-fill" style={{ width: pct + "%" }} />
        {ticks &&
          [2, 4, 6, 8].map((t) => (
            <div
              key={t}
              className="os-scorebar-tick"
              style={{ left: (t / max) * 100 + "%" }}
            />
          ))}
      </div>
      <div className="os-scorebar-val">{value.toFixed(1)}</div>
    </div>
  );
}
