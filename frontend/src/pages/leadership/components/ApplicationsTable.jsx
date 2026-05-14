// ApplicationsTable — paginated, sortable list of applications.
// `applications` is the `applications` array from GET /leadership/applications,
// which has been narrowed to a flat row shape (no per-track joins).
//
// Sorting is client-side over the currently-loaded page; pagination via
// limit/offset is owned by the parent (LeadershipDashboard).

import { useMemo } from "react";

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

function scoreTier(score) {
  if (score >= 8) return "high";
  if (score >= 6) return "mid";
  if (score >= 4) return "low";
  return "weak";
}

function ScorePill({ score }) {
  if (score === null || score === undefined) {
    return <span className="eir-mono eir-dim">—</span>;
  }
  const tier = scoreTier(score);
  return (
    <span className={`lp-score lp-score-${tier}`}>
      <span className="lp-score-bar">
        <span
          className="lp-score-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, score * 10))}%` }}
        />
      </span>
      <span className="eir-mono lp-score-n">{score.toFixed(1)}</span>
    </span>
  );
}

function StatusChip({ statusId, statusLabel }) {
  const bucket = STATUS_BUCKET[statusId] || "open";
  return (
    <span className={`lp-chip lp-chip-${bucket}`}>
      <span className={`lp-status-dot lp-status-${bucket}`} />
      {statusLabel || statusId}
    </span>
  );
}

function relTimeFromIso(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function ApplicationsTable({
  applications,
  total,
  statusLabelById,
  sort,
  setSort,
  onOpen,
  limit,
  offset,
  setOffset,
}) {
  const sorted = useMemo(() => {
    const [key, dir] = sort;
    const mul = dir === "asc" ? 1 : -1;
    const accessor = (row) => {
      switch (key) {
        case "ai_score_overall":
          // Sort nulls to the bottom regardless of direction.
          return row.ai_score_overall === null || row.ai_score_overall === undefined
            ? mul === 1 ? Infinity : -Infinity
            : row.ai_score_overall;
        case "industry":
          return row.industry?.label || "";
        case "status":
          return statusLabelById?.[row.status] || row.status || "";
        case "submitted_at":
          return row.submitted_at ? Date.parse(row.submitted_at) : 0;
        default:
          return row[key];
      }
    };
    return [...applications].sort((a, b) => {
      const A = accessor(a);
      const B = accessor(b);
      if (typeof A === "number" && typeof B === "number") return (A - B) * mul;
      return String(A || "").localeCompare(String(B || "")) * mul;
    });
  }, [applications, sort, statusLabelById]);

  const headBtn = (key, label, align) => (
    <button
      type="button"
      className={`lp-th eir-mono ${align === "right" ? "is-right" : ""} ${sort[0] === key ? "is-on" : ""}`}
      onClick={() =>
        setSort(
          sort[0] === key
            ? [key, sort[1] === "asc" ? "desc" : "asc"]
            : [key, "desc"]
        )
      }
    >
      {label}
      <span className="lp-th-arrow">
        {sort[0] === key ? (sort[1] === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  const pageEnd = Math.min(total ?? sorted.length, (offset ?? 0) + (limit ?? sorted.length));
  const canPrev = (offset ?? 0) > 0;
  const canNext = pageEnd < (total ?? 0);

  return (
    <div className="lp-table-wrap">
      <div className="lp-table">
        <div className="lp-tr lp-tr-head">
          <div className="lp-td lp-td-id">{headBtn("id", "ID")}</div>
          <div className="lp-td lp-td-project">
            {headBtn("basic_full_name", "Founder / project")}
          </div>
          <div className="lp-td lp-td-founder">
            {headBtn("basic_org", "Organization")}
          </div>
          <div className="lp-td lp-td-ind">
            {headBtn("industry", "Industry")}
          </div>
          <div className="lp-td lp-td-stage">{headBtn("track", "Track")}</div>
          <div className="lp-td lp-td-score">
            {headBtn("ai_score_overall", "AI score", "right")}
          </div>
          <div className="lp-td lp-td-status">{headBtn("status", "Status")}</div>
          <div className="lp-td lp-td-sub">
            {headBtn("submitted_at", "Submitted")}
          </div>
        </div>
        {sorted.map((a) => (
          <button
            type="button"
            className="lp-tr lp-tr-row"
            key={a.id}
            onClick={() => onOpen(a)}
          >
            <div className="lp-td lp-td-id eir-mono">
              {a.id ? a.id.slice(0, 8) : ""}
            </div>
            <div className="lp-td lp-td-project" title={a.basic_full_name || ""}>
              <span className="lp-project-title">
                {a.basic_full_name || <span className="eir-dim">—</span>}
              </span>
              <span className="lp-project-meta eir-mono eir-dim">
                {a.basic_email || ""}
              </span>
            </div>
            <div className="lp-td lp-td-founder">
              <span className="lp-founder">
                {a.basic_org || <span className="eir-dim">—</span>}
              </span>
            </div>
            <div className="lp-td lp-td-ind">
              {a.industry?.label || <span className="eir-dim">—</span>}
            </div>
            <div className="lp-td lp-td-stage eir-mono">
              {(a.track || "").toUpperCase()}
            </div>
            <div className="lp-td lp-td-score">
              <ScorePill score={a.ai_score_overall} />
            </div>
            <div className="lp-td lp-td-status">
              <StatusChip
                statusId={a.status}
                statusLabel={statusLabelById?.[a.status] || a.status}
              />
            </div>
            <div className="lp-td lp-td-sub eir-mono eir-dim">
              {relTimeFromIso(a.submitted_at || a.created_at)}
            </div>
          </button>
        ))}
        {sorted.length === 0 && (
          <div className="lp-table-empty eir-mono eir-dim">
            no applications match the current filters
          </div>
        )}
        {sorted.length > 0 && (
          <div
            className="lp-table-more eir-mono eir-dim"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
            }}
          >
            <span>
              showing {(offset ?? 0) + 1}–{pageEnd} of {total ?? sorted.length}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="eir-chip-btn eir-mono"
                disabled={!canPrev}
                onClick={() => setOffset(Math.max(0, (offset ?? 0) - (limit ?? 50)))}
              >
                ← prev
              </button>
              <button
                type="button"
                className="eir-chip-btn eir-mono"
                disabled={!canNext}
                onClick={() => setOffset((offset ?? 0) + (limit ?? 50))}
              >
                next →
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
