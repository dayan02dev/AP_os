// HistoryTab — vertical timeline of application_status_log rows. Newest at
// top. Server returns rows already sorted descending by changed_at; we trust
// that ordering rather than re-sort client-side.

import { statusLabel } from "../pipelineStages.js";

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Actor name: the backend's resolved name/email when it sends one, else a
// name the detail payload already knows (reviewers), else a short id.
function actorOf(h, actorNames) {
  if (h.changed_by_name) return h.changed_by_name;
  if (h.changed_by_email) return h.changed_by_email;
  if (!h.changed_by) return "system";
  return actorNames?.[h.changed_by] || h.changed_by.slice(0, 8);
}

export default function HistoryTab({ history, actorNames }) {
  if (!Array.isArray(history) || history.length === 0) {
    return <p className="ans-empty">No status changes yet.</p>;
  }
  return (
    <ol className="history-timeline" role="list">
      {history.map((h) => (
        <li
          key={h.id || `${h.changed_at}-${h.to_status}`}
          className="history-row"
        >
          <span className="move">
            <span className="from">{h.from_status ? statusLabel(h.from_status) : "—"}</span>
            <span className="arrow">→</span>
            <span className="to">{statusLabel(h.to_status)}</span>
            {(h.changed_by || h.changed_by_name) && (
              <span style={{ marginLeft: 12, color: "var(--ink-dim)", fontSize: 12 }}>
                by {actorOf(h, actorNames)}
              </span>
            )}
          </span>
          <span className="meta">{fmtWhen(h.changed_at)}</span>
          {h.reason && <span className="reason">{h.reason}</span>}
        </li>
      ))}
    </ol>
  );
}
