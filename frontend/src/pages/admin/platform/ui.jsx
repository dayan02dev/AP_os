// Shared atoms + helpers for the Admin Platform screens (T14–T20).
// Mirrors reviewer/v2/ui.jsx: LoadingState / ErrorState / EmptyState / Chip /
// ScoreBar live here so the per-tab screens import a single source of truth.
// useAsync is re-exported for convenience (same hook the reviewer portal uses).

export { useAsync } from "../../../hooks/useAsync.js";

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="adm-async adm-async-loading">
      <span className="adm-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="adm-async adm-async-error">
      <div className="os-text-sm" style={{ color: "var(--bad)", fontWeight: 600 }}>
        Couldn’t load this data.
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
  return <div className="adm-async adm-async-empty os-text-dim">{label}</div>;
}

export function Chip({ children, tone = "", solid = false }) {
  return <span className={"os-chip " + tone + (solid ? " solid" : "")}>{children}</span>;
}

// Read-only score bar (AI baseline display). Ported from the prototype shell.
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

export function initialsOf(name, email) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }
  const e = (email || "").trim();
  return e ? e.slice(0, 2).toUpperCase() : "AD";
}
