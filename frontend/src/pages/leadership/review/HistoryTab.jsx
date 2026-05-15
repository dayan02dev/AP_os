// HistoryTab — vertical timeline of application_status_log rows. Newest at
// top. Server returns rows already sorted descending by changed_at; we trust
// that ordering rather than re-sort client-side.

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

function shortActor(uid) {
  if (!uid) return "system";
  return uid.slice(0, 8);
}

export default function HistoryTab({ history }) {
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
            <span className="from">{h.from_status || "—"}</span>
            <span className="arrow">→</span>
            <span className="to">{h.to_status}</span>
            {h.changed_by && (
              <span style={{ marginLeft: 12, color: "var(--ink-dim)", fontSize: 12 }}>
                by {shortActor(h.changed_by)}
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
