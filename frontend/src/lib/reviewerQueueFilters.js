// Reviewer queue filtering, sorting and Prev/Next — one definition shared by
// My Queue (the list the reviewer filters) and the eval screen (Prev/Next and
// the auto-advance after submit). Before this lived only in ReviewerQueue, so
// the eval screen walked the raw backend order: TIR apps after filtering VIP,
// already-reviewed apps under "Not started", unassigned and closed rows.
//
// Rows are GET /reviewer/queue rows: { id, track, movedToTrack, applicationId,
// name, founders[], industry, stage, ai{overall}, reviewStatus, myScore,
// myReco, closed, detached }.

import { readStickyState } from "../hooks/useStickyState.js";
import { relabelDisplayId } from "./trackLabel.js";

export const QUEUE_SCOPE = "reviewer.queue";

export const DEFAULT_QUEUE_FILTERS = Object.freeze({
  search: "",
  track: "all",
  status: "all",
  stage: "all",
  domain: "all",
  reco: "all",
  showInactive: false,
  sortCol: null,
  sortAsc: true,
});

/** The queue's current filters + sort, read from its sticky state (the same
 *  keys ReviewerQueue's useStickyState hooks write). */
export function readQueueFilters() {
  const out = {};
  for (const [field, initial] of Object.entries(DEFAULT_QUEUE_FILTERS)) {
    out[field] = readStickyState(QUEUE_SCOPE, field, initial);
  }
  return out;
}

export const effTrack = (s) => s.movedToTrack || s.track;

/** Closed (rejected after review) or detached (assignment gone) rows. They are
 *  hidden from the queue by default and never part of Prev/Next. */
export const isInactive = (s) => Boolean(s && (s.closed || s.detached));

export function visibleQueueRows(rows, showInactive = false) {
  const all = Array.isArray(rows) ? rows : [];
  return showInactive ? all : all.filter((s) => !isInactive(s));
}

function matchesSearch(s, search) {
  const q = (search || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [s.name, s.industry, s.applicationId, relabelDisplayId(s.applicationId), ...(s.founders || [])]
    .map((v) => (v || "").toLowerCase());
  return hay.some((v) => v.includes(q));
}

/** Does one row pass every active filter? `except` names one facet to skip
 *  ("track" | "status" | "stage" | "domain" | "reco"), for facet counts. */
export function matchesQueueFilters(s, f, except = null) {
  if (except !== "track" && f.track !== "all" && effTrack(s) !== f.track) return false;
  if (!matchesSearch(s, f.search)) return false;
  if (except !== "status" && f.status !== "all" && s.reviewStatus !== f.status) return false;
  if (except !== "stage" && f.stage !== "all" && s.stage !== f.stage) return false;
  if (except !== "domain" && f.domain !== "all" && s.industry !== f.domain) return false;
  if (except !== "reco" && f.reco !== "all" && (s.myReco || "none") !== f.reco) return false;
  return true;
}

export function applyQueueFilters(rows, f, except = null) {
  return (rows || []).filter((s) => matchesQueueFilters(s, f, except));
}

function tally(rows, keyOf) {
  const m = {};
  rows.forEach((s) => {
    const k = keyOf(s);
    m[k] = (m[k] || 0) + 1;
  });
  return m;
}

/** Chip counts: each facet is counted over the rows that match every OTHER
 *  active filter, so "Climate 3" means three rows will show when you click it. */
export function facetCounts(visible, f) {
  return {
    status: tally(applyQueueFilters(visible, f, "status"), (s) => s.reviewStatus),
    stage: tally(applyQueueFilters(visible, f, "stage"), (s) => s.stage || "—"),
    industry: tally(applyQueueFilters(visible, f, "domain"), (s) => s.industry || "—"),
    reco: tally(applyQueueFilters(visible, f, "reco"), (s) => s.myReco || "none"),
  };
}

const cmpText = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base", numeric: true });
const RECO_RANK = { yes: 3, maybe: 2, no: 1 };

function sortValue(s, col) {
  switch (col) {
    case "name": return s.name || "";
    case "founder": return (s.founders && s.founders[0]) || "";
    case "industry": return s.industry || "";
    case "stage": return s.stage || "";
    case "status": return s.reviewStatus || "";
    case "id": return relabelDisplayId(s.applicationId);
    case "ai": return s.ai && s.ai.overall != null ? s.ai.overall : -1;
    case "myScore": return typeof s.myScore === "number" ? s.myScore : -1;
    case "myReco": return RECO_RANK[s.myReco] || 0;
    default: return undefined;
  }
}
const NUMERIC_COLS = new Set(["ai", "myScore", "myReco"]);

/** The queue table's sort. No column → backend order. Stable. */
export function sortQueue(rows, sortCol, sortAsc = true) {
  const list = Array.isArray(rows) ? rows : [];
  if (!sortCol || sortValue({}, sortCol) === undefined) return list;
  return [...list].sort((a, b) => {
    const va = sortValue(a, sortCol);
    const vb = sortValue(b, sortCol);
    // Text columns: case-insensitive, numeric-aware ("TIR-2" < "TIR-10").
    const c = NUMERIC_COLS.has(sortCol) ? (va < vb ? -1 : va > vb ? 1 : 0) : cmpText(va, vb);
    return sortAsc ? c : -c;
  });
}

/**
 * Prev/Next for the eval screen, over the queue as the reviewer filtered and
 * sorted it. The current app is located in the FULL sorted list (so an app
 * that stops matching — e.g. just submitted under "Not started" — still has a
 * valid Next); neighbours are the nearest rows that pass the filters and are
 * not closed/detached.
 *
 *  - `anchorRow`: the current app's row as it was when it was opened. Used for
 *    its position, so a fresh row that now sorts elsewhere (status, my score)
 *    does not move the reviewer's place.
 *  - `upNext`: where auto-advance goes after a submit — the next row still to
 *    review (not submitted) after the current one, wrapping to earlier ones.
 *  - `remaining`: how many rows in the filter are still to review, excluding
 *    the current app.
 */
export function queueNavigation(rows, f, appId, { anchorRow = null } = {}) {
  const none = { prev: null, next: null, upNext: null, remaining: 0, hasPosition: false };
  if (!Array.isArray(rows)) return none;
  const id = String(appId);
  const isCurrent = (r) => String(r.id) === id;
  if (!rows.some(isCurrent)) return none;
  const base = anchorRow ? rows.map((r) => (isCurrent(r) ? anchorRow : r)) : rows;
  const sorted = sortQueue(base, f.sortCol, f.sortAsc);
  const idx = sorted.findIndex(isCurrent);

  const eligible = (r) => !isCurrent(r) && !isInactive(r) && matchesQueueFilters(r, f);
  const todo = (r) => eligible(r) && r.reviewStatus !== "submitted";

  let prev = null;
  for (let i = idx - 1; i >= 0; i -= 1) if (eligible(sorted[i])) { prev = sorted[i]; break; }
  let next = null;
  for (let i = idx + 1; i < sorted.length; i += 1) if (eligible(sorted[i])) { next = sorted[i]; break; }
  const upNext = sorted.slice(idx + 1).find(todo) || sorted.slice(0, idx).find(todo) || null;

  return { prev, next, upNext, remaining: sorted.filter(todo).length, hasPosition: true };
}

const TRACK_LABEL = { tir: "TIR", sip: "VIP" };
const STATUS_LABEL = { "not-started": "Not started", draft: "Draft", submitted: "Submitted" };
const RECO_LABEL = { yes: "Yes", maybe: "Maybe", no: "No", none: "None" };

/** "VIP · Not started · Climate" — empty when no filter is active. */
export function describeQueueFilters(f) {
  const parts = [];
  if (f.track !== "all") parts.push(TRACK_LABEL[f.track] || f.track);
  if (f.status !== "all") parts.push(STATUS_LABEL[f.status] || f.status);
  if (f.stage !== "all") parts.push(f.stage);
  if (f.domain !== "all") parts.push(f.domain);
  if (f.reco !== "all") parts.push(`My reco: ${RECO_LABEL[f.reco] || f.reco}`);
  const q = (f.search || "").trim();
  if (q) parts.push(`“${q}”`);
  return parts.join(" · ");
}
