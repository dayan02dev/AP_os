// StatusGrid — clickable grid of status cells, one per canonical status.
// `statusCounts` is the backend's stats.status_counts array, which is the
// source of truth for both the IDs and the labels. The bucket-color dot
// is derived from STATUS_BUCKET (see same map in ApplicationsTable).

const STATUS_BUCKET = {
  submitted:    "open",
  ai_screening: "review",
  under_review: "review",
  evaluated:    "review",
  shortlisted:  "advance",
  interview:    "advance",
  offered:      "decision",
  onboarded:    "decision",
  rejected:     "decision",
  waitlisted:   "decision",
  withdrawn:    "decision",
};

export default function StatusGrid({ statusCounts, onFilter, activeStatus }) {
  if (!statusCounts || statusCounts.length === 0) {
    return (
      <p className="lp-placeholder">
        No status data yet — applications will populate this once they
        start being submitted.
      </p>
    );
  }
  return (
    <div className="lp-status-grid">
      {statusCounts.map((s) => {
        const bucket = STATUS_BUCKET[s.id] || "open";
        const isActive = activeStatus === s.id;
        return (
          <button
            type="button"
            key={s.id}
            className={`lp-status-cell ${isActive ? "is-on" : ""}`}
            onClick={() => onFilter(isActive ? null : s.id)}
          >
            <span className={`lp-status-dot lp-status-${bucket}`} />
            <span className="lp-status-cell-label">{s.label}</span>
            <span className="eir-mono lp-status-cell-n">{s.n}</span>
          </button>
        );
      })}
    </div>
  );
}
