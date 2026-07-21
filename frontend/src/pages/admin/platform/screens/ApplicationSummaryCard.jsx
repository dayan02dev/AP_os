// ApplicationSummaryCard — the shared "Application · <name>" card used by the
// admin detail page AND the admin gate. Renders: profile pills (Résumé/LinkedIn)
// + domain/stage/TRL chips, the AI summary, the collapsible AI sections, a
// per-reviewer "Reviewer Notes" list, and a "View full application →" button.
// Self-contained: owns its Reviewer-Notes collapse state and builds the résumé
// signed-url opener from `startup` via leadershipApi.
import React, { useState } from "react";
import AiSections from "../../../../components/AiSections.jsx";
import ProfilePills from "../../../../components/ProfilePills";
import { Chip } from "../shell/osAtoms";
import { leadershipApi } from "../../../../lib/leadershipApi";
import { trackLabel } from "../../../../lib/trackLabel";

export default function ApplicationSummaryCard({ startup, onViewFullApplication }) {
  const s = startup || {};
  const [secOpen, setSecOpen] = useState({});

  const onOpenResume = async () => {
    const rf = s.application?.resume_file;
    if (!rf) return;
    const { url } = await leadershipApi.fileSignedUrl(s.id, rf.storage_path);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="os-card">
      <div className="os-card-head">
        <div className="os-card-title">Application · {s.name}</div>
        <div className="os-row gap-sm" style={{ alignItems: "center" }}>
          <ProfilePills
            alsoInTrack={s.alsoInTrack ? trackLabel(s.alsoInTrack) : null}
            resumeFile={s.application?.resume_file}
            linkedinUrl={s.application?.linkedin_url}
            onOpenResume={onOpenResume}
          />
          {s.domain && <Chip>{s.domain}</Chip>}
          {s.stage && <Chip>{s.stage}</Chip>}
          {s.trl && s.trl !== "—" && <Chip>TRL {s.trl}</Chip>}
        </div>
      </div>
      <div className="os-stack">
        {s.aiSummary && (
          <div className="ps-ai-summary">
            <div className="ps-ai-label">AI summary</div>
            <p className="ps-ai-text">{s.aiSummary}</p>
          </div>
        )}

        <AiSections variant="dropdown" sections={s.aiSections} />

        {s.reviews && s.reviews.length > 0 && (
          <div>
            <div className="ps-group-label">Reviewer Notes</div>
            <div className="ps-sections">
              {s.reviews.map((rv, i) => {
                const open = secOpen[`rev-${i}`] !== false;
                return (
                  <div className={"ps-sec" + (open ? " is-open" : "")} key={i}>
                    <button className="ps-sec-head" aria-expanded={open}
                      onClick={() => setSecOpen(prev => ({ ...prev, [`rev-${i}`]: !open }))}>
                      <span className="ps-sec-chev">{open ? "▾" : "▸"}</span>
                      <span className="ps-sec-label">Reviewer {i + 1} · {rv.reco || "—"}</span>
                      <span className="ps-sec-hint">{open ? "" : (rv.overall ? rv.overall.toFixed(1) : "—")}</span>
                    </button>
                    {open && rv.notes && (
                      <ul className="ps-bullets"><li>{rv.notes}</li></ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <hr className="os-divider" />

        <button className="os-btn secondary os-w-100" onClick={onViewFullApplication}>
          View full application →
        </button>
      </div>
    </div>
  );
}
