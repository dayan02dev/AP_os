// ReviewHeader — sticky top bar for the review surface.
//
// Layout, left → right:
//   Back · App ID (mono) · Status chip · AI score chip · spacer
//   Prev / Next · Export PDF (stub) · Aside toggle · Close
//
// We do NOT compose this from the existing AdminLayout shell — the brief is
// explicit that the review page lives in its own top-only chrome, no left
// sidebar.

import { labelFor } from "../../../lib/statusMachine.js";
import { bucketFor } from "../components/statusBuckets.js";

function StatusInline({ statusId }) {
  return (
    <span className="h-status">
      <span className={`lp-status-dot lp-status-${bucketFor(statusId)}`} />
      {labelFor(statusId)}
    </span>
  );
}

export default function ReviewHeader({
  appId,
  status,
  scoreOverall,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onToggleAside,
  asideCollapsed,
}) {
  const hasScore = typeof scoreOverall === "number" && Number.isFinite(scoreOverall);
  return (
    <header className="review-header">
      <button type="button" className="h-back" onClick={onBack} aria-label="Back to dashboard">
        ← Back
      </button>
      <span className="h-id">{appId}</span>
      {status && <StatusInline statusId={status} />}
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
        aria-disabled="true"
        title="PDF export ships in Phase 1.5."
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
