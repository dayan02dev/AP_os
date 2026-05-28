// ScoreHistogram — 10-bucket histogram (0–1, 1–2, …, 9–10) of overall AI
// scores. Receives an array of numbers; empty array → render a placeholder.

export default function ScoreHistogram({ scores }) {
  if (!scores || scores.length === 0) {
    return (
      <p className="lp-placeholder">
        No AI scores yet — applications haven&rsquo;t been scored. The
        histogram will appear once the AI screener has run.
      </p>
    );
  }

  const buckets = Array.from({ length: 10 }, (_, i) => ({
    lo: i,
    hi: i + 1,
    n: 0,
  }));
  scores.forEach((s) => {
    const idx = Math.min(9, Math.max(0, Math.floor(s)));
    buckets[idx].n += 1;
  });

  const max = Math.max(...buckets.map((b) => b.n));
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)].toFixed(1);
  const mean = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);

  return (
    <div className="lp-hist">
      <div className="lp-hist-grid">
        {buckets.map((b, i) => {
          const h = max ? (b.n / max) * 100 : 0;
          const isPeak = max > 0 && b.n === max;
          return (
            <div className="lp-hist-col" key={i}>
              <div className="lp-hist-bar-wrap">
                <span className="lp-hist-bar-n eir-mono">{b.n}</span>
                <div
                  className={`lp-hist-bar ${isPeak ? "is-peak" : ""}`}
                  style={{ height: `${h}%` }}
                />
              </div>
              <div className="lp-hist-label eir-mono">
                {b.lo}–{b.hi}
              </div>
            </div>
          );
        })}
      </div>
      <div className="lp-hist-foot eir-mono">
        <span>
          mean <strong>{mean}</strong>
        </span>
        <span className="eir-dim">·</span>
        <span>
          median <strong>{median}</strong>
        </span>
        <span className="eir-dim">·</span>
        <span>n = {scores.length}</span>
      </div>
    </div>
  );
}
