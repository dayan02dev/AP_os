// Jury application detail — READ-ONLY. Replaces the old scoring JuryEval.
//
// A juror reads the full application + the AI baseline, then decides whether to
// pick this startup to mentor. There are NO score sliders, NO reviewer
// consensus, NO rubric, and NO lock countdown here — the only mutation a juror
// makes is toggling a pick (+ an optional note), and that state lives in the
// shell (JuryPortal) so it is shared with the queue, the pick bar, and My Picks.

import { useMemo } from "react";

import AiSections from "../../components/AiSections.jsx";
import FullApplication from "../../components/FullApplication.jsx";
import ProfilePills from "../../components/ProfilePills.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { juryApi } from "../../lib/juryApi.js";
import { LoadingState, ErrorState, Chip } from "./ui.jsx";

const keyOf = (id, track) => id + ":" + track;

export default function JuryAppView({
  track, appId, onBack, onOpen, picks = [], togglePick, setNote, queue = [],
}) {
  const { data: content, loading, error, reload } = useAsync(
    () => juryApi.getContent(track, appId),
    [track, appId],
  );

  const neighbors = useMemo(() => {
    if (!queue.length || !onOpen) return { prev: null, next: null };
    const idx = queue.findIndex((q) => String(q.id) === String(appId) && q.track === track);
    if (idx === -1) return { prev: null, next: null };
    return {
      prev: idx > 0 ? queue[idx - 1] : null,
      next: idx < queue.length - 1 ? queue[idx + 1] : null,
    };
  }, [queue, appId, track, onOpen]);

  if (loading)
    return (
      <div style={{ padding: "48px 0" }}>
        <LoadingState label="Loading application…" />
      </div>
    );
  if (error)
    return (
      <div style={{ padding: "48px 0" }}>
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  if (!content) return null;

  const myKey = keyOf(content.id, content.track);
  const mine = picks.find((p) => keyOf(p.application_id, p.application_track) === myKey);
  const picked = Boolean(mine);
  const pickDisabled = picks.length >= 3 && !picked;
  const aiBlock = content.ai;

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onBack(); }}
              style={{ color: "#4a4a52", textDecoration: "none" }}
            >
              My applications
            </a>
            <span style={{ margin: "0 8px", color: "#c8c8d0" }}>/</span>
            <span style={{ color: "#8a8a92" }}>{content.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>JURY · READ-ONLY APPLICATION</span>
          <h2 className="lp-section-title">
            {content.name} <span className="lp-muted">· {content.track === "tir" ? "TIR" : "VIP"}</span>
          </h2>
        </div>
        <div className="lp-section-actions">
          {(neighbors.prev || neighbors.next) && (
            <div className="os-row gap-sm">
              <button
                className="os-btn ghost sm"
                onClick={() => neighbors.prev && onOpen(neighbors.prev.track, neighbors.prev.id)}
                disabled={!neighbors.prev}
              >
                ← Prev application
              </button>
              <button
                className="os-btn ghost sm"
                onClick={() => neighbors.next && onOpen(neighbors.next.track, neighbors.next.id)}
                disabled={!neighbors.next}
              >
                Next application →
              </button>
            </div>
          )}
          <button className="os-btn secondary" onClick={onBack}>↩ My applications</button>
        </div>
      </div>

      <div className="os-stack" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* AI baseline + profile pills */}
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Application · {content.name}</div>
            <div className="os-row gap-sm" style={{ alignItems: "center" }}>
              <ProfilePills
                resumeFile={content.application?.resume_file}
                linkedinUrl={content.application?.linkedin_url}
                onOpenResume={async () => {
                  const rf = content.application.resume_file;
                  const { url } = await juryApi.fileSignedUrl(content.track, content.id, rf.storage_path);
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              />
              <Chip>{content.track === "tir" ? "TIR" : "VIP"}</Chip>
            </div>
          </div>
          <div className="os-stack">
            {content.aiSummary && (
              <div className="ps-ai-summary">
                <div className="ps-ai-label">AI summary</div>
                <p className="ps-ai-text">{content.aiSummary}</p>
              </div>
            )}
            <AiSections variant="dropdown" sections={content.aiSections} />
            {aiBlock && aiBlock.overall != null && (
              <div className="os-row between" style={{ alignItems: "center", marginTop: 4 }}>
                <span className="os-text-xs os-text-dim os-uppercase">AI overall</span>
                <span className="os-num-big" style={{ fontSize: 28, fontWeight: 800, color: "#2f6f62" }}>
                  {Number(aiBlock.overall).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Mentor pick — the only juror mutation on this screen */}
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Mentor pick</div>
            <span className="os-text-xs os-text-dim">{picks.length} / 3 chosen</span>
          </div>
          <div className="os-stack gap-sm">
            <button
              type="button"
              className={"jry-pick-big" + (picked ? " is-picked" : "")}
              disabled={pickDisabled}
              title={pickDisabled ? "You already have 3 picks" : ""}
              onClick={() => togglePick({ id: content.id, track: content.track })}
            >
              {picked ? "★ Picked to mentor" : "☆ Pick to mentor"}
            </button>
            <label className="jry-pickbar-note-label" htmlFor="jry-detail-note">
              Why this startup? (optional)
            </label>
            <textarea
              id="jry-detail-note"
              placeholder={picked ? "Add a short note on why you'd like to mentor this team…" : "Pick this startup to add a note."}
              value={mine?.note || ""}
              disabled={!picked}
              onChange={(e) => setNote(content.id, content.track, e.target.value)}
              style={{ width: "100%", minHeight: 70, resize: "vertical", fontSize: 13, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--line-strong, #c8c8d0)", fontFamily: "var(--font-sans)" }}
            />
          </div>
        </div>

        {/* Full application — shared read-only renderer */}
        <div className="os-card">
          <FullApplication
            track={content.track}
            application={content.application}
            applicationId={content.id}
            signedUrl={(id, path) => juryApi.fileSignedUrl(content.track, id, path)}
          />
        </div>
      </div>
    </div>
  );
}
