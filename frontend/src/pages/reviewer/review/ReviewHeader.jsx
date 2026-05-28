// ReviewHeader — sticky top bar for the review surface.
//
// Reviewer variant. Trimmed from the leadership original:
//   - no h-score chip (reviewers see scoring controls in the aside, not in the bar)
//   - no h-toggle (aside is not collapsible in the reviewer surface)
//   - back button reads "← Inbox" instead of "← Back"
//
// Layout, left → right:
//   Back (Inbox) · App ID (mono) · Status chip · spacer
//   Prev / Next · Export PDF (stub)
//
// We do NOT compose this from the existing AdminLayout shell — the brief is
// explicit that the review page lives in its own top-only chrome, no left
// sidebar.

import { labelFor } from "../../../lib/statusMachine.js";

const STATUS_DOT_COLOR = {
  submitted:        "blue",
  ai_screening:     "amber",
  screening_failed: "coral",
  under_review:     "blue",
  evaluated:        "blue",
  shortlisted:      "green",
  interview:        "green",
  offered:          "green",
  onboarded:        "green",
  rejected:         "coral",
  waitlisted:       "amber",
  withdrawn:        "dim",
};

function StatusInline({ statusId }) {
  const dotCls = STATUS_DOT_COLOR[statusId] || "";
  return (
    <span className="h-status">
      <span className={`dot ${dotCls}`} />
      {labelFor(statusId)}
    </span>
  );
}

export default function ReviewHeader({
  appId,
  status,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}) {
  return (
    <header className="review-header">
      <button type="button" className="h-back" onClick={onBack} aria-label="Back to inbox">
        ← Inbox
      </button>
      <span className="h-id">{appId}</span>
      {status && <StatusInline statusId={status} />}
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
    </header>
  );
}
