// Shared UI atoms for the reviewer-v2 portal.
// Ported from os/shell.jsx (Object.assign(window,...)) to named ES exports.

// ── Status / label chips ──────────────────────────────────────────────
export function Chip({ children, tone = "", solid = false }) {
  return (
    <span className={"os-chip " + tone + (solid ? " solid" : "")}>
      {children}
    </span>
  );
}

// ── Async state placeholders ──────────────────────────────────────────
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
      {error?.message && (
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

// ── Page header (eyebrow + title + actions) ───────────────────────────
export function PageHead({ eyebrow, title, sub, actions, breadcrumb }) {
  return (
    <div>
      {breadcrumb && (
        <div className="os-breadcrumb">
          {breadcrumb.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">/</span>}
              {b.onClick ? (
                <a href={b.href || "#"} onClick={(e) => { e.preventDefault(); b.onClick(); }}>
                  {b.label}
                </a>
              ) : b.href ? (
                <a href={b.href}>{b.label}</a>
              ) : (
                b.label
              )}
            </span>
          ))}
        </div>
      )}
      <div className="os-page-head">
        <div>
          {eyebrow && <div className="os-eyebrow">{eyebrow}</div>}
          <h1 className="os-h1" dangerouslySetInnerHTML={{ __html: title }} />
          {sub && <div className="os-sub">{sub}</div>}
        </div>
        {actions && <div className="os-row gap-sm">{actions}</div>}
      </div>
    </div>
  );
}

// ── Flag dot ──────────────────────────────────────────────────────────
export function FlagDot({ tone = "darkgreen", title: titleProp }) {
  return <span className={"os-flag-dot " + tone} title={titleProp} />;
}

// ── Variance badge ────────────────────────────────────────────────────
export function Variance({ value }) {
  const tone = value < 0.5 ? "low" : value < 1 ? "med" : "high";
  return <span className={"os-variance " + tone}>Δ {value.toFixed(1)}</span>;
}
