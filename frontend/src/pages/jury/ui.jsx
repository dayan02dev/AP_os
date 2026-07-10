// Shared atoms for the Jury Portal (pick-3, read-only — NO scoring).
//
// Ported subset of reviewer/v2/ui.jsx: LoadingState / ErrorState / EmptyState /
// Chip / ScoreBar / initialsOf / COHORT_LABEL only. The scoring machinery
// (Slider, CRIT_LABELS, DIM_KEYS, weightedOverall, review↔evaluation adapters)
// is deliberately dropped — jurors pick applications, they do not score them.

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="rv-async rv-async-loading">
      <span className="rv-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="rv-async rv-async-error">
      <div className="os-text-sm" style={{ color: "var(--bad)", fontWeight: 600 }}>
        Couldn't load this data.
      </div>
      {error && error.message && (
        <div className="os-text-xs os-text-dim" style={{ marginTop: 4 }}>
          {error.message}
        </div>
      )}
      {onRetry && (
        <button className="os-btn ghost sm" style={{ marginTop: 12 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ label = "Nothing here yet." }) {
  return <div className="rv-async rv-async-empty os-text-dim">{label}</div>;
}

export function Chip({ children, tone = "", solid = false }) {
  return <span className={"os-chip " + tone + (solid ? " solid" : "")}>{children}</span>;
}

// Read-only score bar (AI baseline display only).
export function ScoreBar({ label, value, max = 10, kind = "", ticks = true }) {
  const safe = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(1, safe / max)) * 100;
  return (
    <div className={"os-scorebar " + kind}>
      <div className="os-scorebar-label">{label}</div>
      <div className="os-scorebar-track">
        <div className="os-scorebar-fill" style={{ width: pct + "%" }} />
        {ticks &&
          [2, 4, 6, 8].map((t) => (
            <div key={t} className="os-scorebar-tick" style={{ left: (t / max) * 100 + "%" }} />
          ))}
      </div>
      <div className="os-scorebar-val">{safe.toFixed(1)}</div>
    </div>
  );
}

export const COHORT_LABEL = "TIR + VIP cohort 2026";

export function initialsOf(name, email) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }
  const e = (email || "").trim();
  return e ? e.slice(0, 2).toUpperCase() : "JR";
}
