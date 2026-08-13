// My Picks — the juror's chosen startups (1-3) as cards with editable notes.
// Picks live in the shell (JuryPortal); this screen just presents them,
// resolving each against the queue rows for name / industry / AI score.

const keyOf = (id, track) => id + ":" + track;

function fmtSubmitted(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  }).replace(",", " ·") + " IST";
}

export default function JuryPicks({ picks = [], queue = [], setNote, submittedAt, onOpen }) {
  if (!picks.length) {
    return (
      <div className="lp-tab-content">
        <div className="jry-picks-empty">No picks yet — choose up to 3 from My Applications.</div>
      </div>
    );
  }

  const byKey = new Map(queue.map((q) => [keyOf(q.id, q.track), q]));
  const when = fmtSubmitted(submittedAt);

  return (
    <div className="lp-tab-content">
      {when && <div className="jry-picks-submitted">Submitted {when}</div>}
      <div className="jry-picks-grid">
        {picks.map((p) => {
          const row = byKey.get(keyOf(p.application_id, p.application_track));
          const trackLabel = p.application_track === "tir" ? "TIR" : "VIP";
          const meta = [
            row?.applicationId || trackLabel,
            row?.industry,
            row?.ai?.overall != null ? `AI ${Number(row.ai.overall).toFixed(1)}` : null,
          ].filter(Boolean).join(" · ");
          return (
            <div className="jry-pick-card" key={keyOf(p.application_id, p.application_track)}>
              <div>
                <div
                  className="jry-pick-card-name"
                  style={{ cursor: onOpen ? "pointer" : "default" }}
                  onClick={() => onOpen && onOpen(p.application_track, p.application_id)}
                >
                  {row?.name || "Application"}
                </div>
                <div className="jry-pick-card-meta">{meta}</div>
              </div>
              <div>
                <div className="jry-pick-card-note-label">Note</div>
                <textarea
                  placeholder="Why you'd like to mentor this team…"
                  value={p.note || ""}
                  onChange={(e) => setNote(p.application_id, p.application_track, e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
