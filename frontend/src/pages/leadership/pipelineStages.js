// Gate-aware pipeline stages for the leadership portal — the ONE label map the
// dashboard breakdown, the Status filter chips, the list rows, the drawer, the
// review page and the CSV all read, so an app reads the same everywhere.
//
// Stage ids mirror GET /leadership/stats → pipeline_breakdown.stages (contract
// C1). Labels match the admin dashboard buckets. The stages are mutually
// exclusive and sum to pipeline_breakdown.total.
//
// List rows carry the backend's `pipeline_stage` (same rules as the breakdown)
// and the list endpoint accepts the split stage keys (SERVER_STAGES) as
// `status`, so those filter server-side. Other multi-status stages are fetched
// unfiltered and narrowed client-side with `keep`. A row without
// pipeline_stage degrades to the coarser label instead of a wrong one.

import { labelFor } from "../../lib/statusMachine.js";
import { rowSelectionKey } from "./selectedStartups.js";

export const SELECTED_GREEN = "#2a8f5a";
const REJECTED_RED = "#b42318";

const decisionOf = (d) => String((d && typeof d === "object" ? d.decision : d) || "").toLowerCase();

// Final-round (Gate-2) reject. `null` = unknown (the row carries no
// gate2_decision field yet), so callers can fall back to a plain "Rejected".
export function isFinalReject(row) {
  if (!row || !("gate2_decision" in row)) return null;
  return decisionOf(row.gate2_decision) === "rejected";
}

// Selected = jury_review + every current IC memo signed. Prefer the backend's
// row flag; fall back to the client-computed key set.
export function isSelectedRow(row, ctx = {}) {
  if (typeof row?.final_selected === "boolean") return row.final_selected;
  return !!ctx.selectedKeys?.has(rowSelectionKey(row));
}

// `dot` is either a .lp-status-{dot} class bucket or a literal colour.
export const STAGES = [
  { id: "submitted",      label: "Submitted",         dot: "open",     statuses: ["submitted", "ai_screening", "screening_failed"] },
  { id: "under_review",   label: "Under review",      dot: "review",   statuses: ["under_review"] },
  { id: "reviewed",       label: "Reviewed",          dot: "review",   statuses: ["evaluated"] },
  { id: "gate1_rejected", label: "1st-gate rejected", color: REJECTED_RED, statuses: ["rejected"],
    keep: (row) => isFinalReject(row) !== true },
  { id: "final_pending",  label: "Final pending",     dot: "advance",  statuses: ["jury_review"],
    keep: (row, ctx) => !isSelectedRow(row, ctx) },
  { id: "final_rejected", label: "Final rejected",    color: REJECTED_RED, statuses: ["rejected"],
    // Unknown split → keep nothing rather than mislabel 1st-gate rejects.
    keep: (row) => isFinalReject(row) === true },
  { id: "final_selected", label: "Final selected",    color: SELECTED_GREEN, statuses: ["jury_review"],
    keep: (row, ctx) => isSelectedRow(row, ctx) },
  { id: "offered",        label: "Offered",           dot: "decision", statuses: ["offered"] },
  { id: "onboarded",      label: "Onboarded",         dot: "decision", statuses: ["onboarded"] },
  { id: "on_hold",        label: "On hold",           dot: "decision", statuses: ["on_hold"] },
  { id: "waitlisted",     label: "Waitlisted",        dot: "decision", statuses: ["waitlisted"] },
  { id: "withdrawn",      label: "Withdrawn",         dot: "decision", statuses: ["withdrawn"] },
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

// Stage keys GET /leadership/applications accepts as `status` (leadership.py
// _STAGE_FILTERS) — filtered on the row's pipeline_stage server-side.
const SERVER_STAGES = new Set(["reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"]);

// The backend's old overlay folds a shortlist decision into "accepted";
// treat that the same as the raw jury_review it stands for.
const rawStatus = (s) => (s === "accepted" ? "jury_review" : s);

// Human label for a raw status id outside the stage machinery (status history,
// review header before the row's stage is known).
export function statusLabel(status) {
  if (status === "jury_review" || status === "accepted") return "Final round";
  if (status === "evaluated") return "Reviewed";
  return labelFor(status);
}

// → { id, label, dot?, color? } for a list row (or anything with a status).
export function rowStage(row, ctx = {}) {
  // The backend's stage is built from the RAW status; `status` is the
  // decision-overlaid display status, so the stage wins when present.
  if (row?.pipeline_stage && STAGE_BY_ID[row.pipeline_stage]) return STAGE_BY_ID[row.pipeline_stage];
  const status = rawStatus(row?.status);
  if (status === "rejected") {
    const fin = isFinalReject(row);
    if (fin === null) return { id: "rejected", label: "Rejected", color: REJECTED_RED };
    return STAGE_BY_ID[fin ? "final_rejected" : "gate1_rejected"];
  }
  if (status === "jury_review") {
    return STAGE_BY_ID[isSelectedRow(row, ctx) ? "final_selected" : "final_pending"];
  }
  const hit = STAGES.find((s) => s.statuses.includes(status));
  return hit || { id: status || "unknown", label: statusLabel(status), dot: "open" };
}

// How to ask the list API for a stage: `status` is pushed server-side when the
// stage is exactly one raw status; `keep` (if any) narrows client-side, in
// which case the caller must fetch every page and paginate locally.
export function stageQuery(stageId) {
  const stage = STAGE_BY_ID[stageId];
  if (!stage || SERVER_STAGES.has(stageId)) return { status: stageId || undefined, keep: null };
  const single = stage.statuses.length === 1;
  const keepStatus = single ? null : (row) => stage.statuses.includes(rawStatus(row?.status));
  const keep = stage.keep && keepStatus
    ? (row, ctx) => keepStatus(row) && stage.keep(row, ctx)
    : stage.keep || keepStatus;
  return { status: single ? stage.statuses[0] : undefined, keep };
}

// Every reco bucket is a list-API value: yes/maybe/no, plus the "—" split
// none (0 reviews) and single (exactly 1) — matched on review_count.
export function recoQuery(recoFilter) {
  return { recommendation: recoFilter || undefined, keep: null };
}

// Stage counts for the chips/breakdown, narrowed to one track when asked.
export function breakdownFor(stats, track) {
  const pb = stats?.pipeline_breakdown;
  if (!pb || !pb.stages) return null;
  if (track && pb.by_track?.[track]?.stages) return pb.by_track[track];
  return pb;
}
