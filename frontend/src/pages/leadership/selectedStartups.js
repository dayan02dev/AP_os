// "Selected startups" for the leadership dashboard.
//
// This round had no jury: admins shortlisted (status `jury_review`), the
// startups were interviewed, and the admin approved the IC memo on the
// Accepted tab. The definition lives in lib/selection.js (shared with the
// admin Accepted tab); this module only adapts leadership list rows to it.
//
// Leadership rows carry the EFFECTIVE status (the backend folds an admin
// `jury_review` decision into "accepted") and two tracks: `track` is the
// display/effective one, `native_track` is where the row lives. IC documents
// are keyed by the native track, so that's the one we hand to selectionKey.
//
// Data-driven: every signed IC memo on a still-shortlisted app counts, so new
// selections show up on the next load with no code change.

import { leadershipApi } from "../../lib/leadershipApi.js";
import { icDocumentsApi } from "../../lib/icDocumentsApi.js";
import { isSelected, selectionKey, signedDocKeys } from "../../lib/selection.js";

// Sentinel value for the dashboard's `statusFilter` state — not a backend status.
export const SELECTED_FILTER = "__selected__";

const LIST_PAGE = 200;     // backend caps `limit` at 200
const MAX_PAGES = 50;      // safety net: 10k rows

export const rowNativeTrack = (row) => row?.native_track || row?.track;
export const rowSelectionKey = (row) => selectionKey(rowNativeTrack(row), row?.id);

// Page through /leadership/applications until `total` rows are collected.
export async function fetchAllApplications(params = {}) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  for (let i = 0; i < MAX_PAGES && offset < total; i += 1) {
    const page = await leadershipApi.listApplications({ ...params, limit: LIST_PAGE, offset });
    const rows = page?.applications || [];
    all.push(...rows);
    total = page?.total ?? all.length;
    if (rows.length === 0) break;
    offset += LIST_PAGE;
  }
  return all;
}

// A row fetched with status=jury_review is shortlisted in the DB; its display
// status is "accepted" (admin decision overlay) or "jury_review". Anything else
// (e.g. an admin "rejected" decision on top) is not a selection.
function rowIsSelected(row, signedKeys) {
  const status = row?.status === "accepted" ? "jury_review" : row?.status;
  return isSelected({
    status,
    nativeTrack: rowNativeTrack(row),
    id: row?.id,
    gate2Decision: row?.gate2_decision,
  }, signedKeys);
}

// Signed IC-memo keys → the (unfiltered) Set of selected row keys. Rejects if
// either the IC-documents list or the shortlist fetch fails — the caller hides
// the chip and tags in that case.
export async function loadSelectedKeys() {
  const [docsRes, shortlisted] = await Promise.all([
    icDocumentsApi.list(),
    fetchAllApplications({ status: "jury_review" }),
  ]);
  const signed = signedDocKeys(docsRes?.documents || []);
  const out = new Set();
  for (const r of shortlisted) {
    if (rowIsSelected(r, signed)) out.add(rowSelectionKey(r));
  }
  return out;
}

// Every selected row matching the other active filters (track, search,
// industry, reco, AI-score bucket — all pushed to the API). `status` in
// `params` is ignored: the selection is always drawn from the shortlist.
export async function fetchSelectedApplications(params, selectedKeys) {
  if (!selectedKeys || selectedKeys.size === 0) return [];
  const rows = await fetchAllApplications({ ...params, status: "jury_review" });
  return rows.filter((r) => selectedKeys.has(rowSelectionKey(r)));
}
