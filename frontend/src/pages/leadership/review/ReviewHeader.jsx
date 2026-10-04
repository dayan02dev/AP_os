// ReviewHeader — sticky top bar for the review surface.
//
// Layout, left → right:
//   Back · App ID (mono) · Status chip · AI score chip · spacer
//   Prev / Next · Export PDF · Aside toggle · Close
//
// We do NOT compose this from the existing AdminLayout shell — the brief is
// explicit that the review page lives in its own top-only chrome, no left
// sidebar.

import { bucketFor } from "../components/statusBuckets.js";
import { statusLabel as labelOf } from "../pipelineStages.js";

// `label` is the gate-aware stage label from the dashboard list when known;
// otherwise the raw status goes through the shared leadership label map.
function StatusInline({ statusId, label }) {
  return (
    <span className="h-status">
      <span className={`lp-status-dot lp-status-${bucketFor(statusId)}`} />
      {label || labelOf(statusId)}
    </span>
  );
}

export default function ReviewHeader({
  appId,
  status,
  statusLabel,
  scoreOverall,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onToggleAside,
  asideCollapsed,
  onExport,
  canExport,
}) {
  const hasScore = typeof scoreOverall === "number" && Number.isFinite(scoreOverall);
  return (
    <header className="review-header">
      <button type="button" className="h-back" onClick={onBack} aria-label="Back to dashboard">
        ← Back
      </button>
      <span className="h-id">{appId}</span>
      {status && <StatusInline statusId={status} label={statusLabel} />}
      <span className={`h-score${hasScore ? "" : " is-empty"}`}>
        {hasScore ? scoreOverall.toFixed(1) : "—"}
        <span className="of">/ 10</span>
      </span>
      <span className="h-spacer" />
      <span className="h-nav" role="group" aria-label="Prev / Next application">
        <button type="button" onClick={onPrev} disabled={!hasPrev}>
          ← Prev
        </button>
        <button type="button" onClick={onNext} disabled={!hasNext}>
          Next →
        </button>
      </span>
      <button
        type="button"
        className="h-export"
        onClick={onExport}
        disabled={!canExport}
        title={canExport ? "Download the application as a PDF" : "Loading application…"}
      >
        Export PDF
      </button>
      <button
        type="button"
        className="h-toggle"
        onClick={onToggleAside}
        aria-label={asideCollapsed ? "Expand AI screening panel" : "Collapse AI screening panel"}
        title={asideCollapsed ? "Expand AI panel" : "Collapse AI panel"}
      >
        {asideCollapsed ? "[ ]" : "][ "}
      </button>
    </header>
  );
}
