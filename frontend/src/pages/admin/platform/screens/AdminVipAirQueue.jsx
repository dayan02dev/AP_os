// AdminVipAirQueue — the AIR verification queue (spec §7).
//
// Rows of (startup, lever, claimed level, submitted) — one row per lever
// still awaiting a verifier's decision, across every submitted VIP AIR
// round (GET /admin/platform/vip/air/queue). A verified lever drops off
// this list (services/admin_vip_query.fetch_air_queue), so the empty state
// here is a single honest "nothing waiting" message rather than a guess at
// why — it could mean every round is fully verified, or that none have
// been submitted yet, and this screen has no way to tell the two apart.
//
// Opening a row drills into AdminVipAirDetail for that assessment_id (every
// write is scoped by assessment_id, never "the current round" — Ruling 2),
// the same in-place drill-down AdminIiscRoster uses for AdminProfessorDetail.

import React, { useState } from "react";
import { adminVipApi } from "../../../../lib/adminVipApi.js";
import { useAsync } from "../ui.jsx";
import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";
import { PageHead } from "../shell/osAtoms";
import { formatDateTime, levelText } from "./vipCohortHelpers.js";
import { AdminVipAirDetail } from "./AdminVipAirDetail.jsx";

export function AdminVipAirQueue({ canWrite }) {
  const [openAssessmentId, setOpenAssessmentId] = useState(null);
  const { data, loading, error, reload } = useAsync(() => adminVipApi.getAirQueue(), []);

  if (openAssessmentId) {
    return (
      <AdminVipAirDetail
        assessmentId={openAssessmentId}
        canWrite={canWrite}
        onBack={() => setOpenAssessmentId(null)}
        onChanged={reload}
      />
    );
  }

  const rows = data?.rows || [];

  return (
    <div>
      <PageHead
        eyebrow="VIP COHORT · AIR"
        title="AIR verification <em>queue</em>"
        sub="Every lever still awaiting a verifier's decision, across every submitted AIR round."
      />

      {loading ? (
        <LoadingState label="Loading the AIR verification queue…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState label="Nothing waiting on verification right now — every submitted AIR round is fully verified, or none have been submitted yet." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="os-table">
            <thead>
              <tr>
                <th>Startup</th>
                <th>Round</th>
                <th>Lever</th>
                <th className="num">Claimed</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.assessment_id}:${r.lever}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setOpenAssessmentId(r.assessment_id)}
                >
                  <td>
                    <div className="startup">
                      <a className="nm" style={{ cursor: "pointer" }}>{r.startup}</a>
                    </div>
                  </td>
                  <td className="os-text-soft">{r.round_label}</td>
                  <td>
                    <a className="nm" style={{ cursor: "pointer" }}>{r.lever_name}</a>
                    <div className="os-text-xs os-text-dim" style={{ marginTop: 2 }}>
                      {r.family === "technology" ? "Technology" : "Commercial"}
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{levelText(r.claimed_level)}</td>
                  <td className="os-text-soft">{formatDateTime(r.submitted_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="os-btn sm secondary"
                      onClick={(e) => { e.stopPropagation(); setOpenAssessmentId(r.assessment_id); }}
                    >
                      Review round
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminVipAirQueue;
