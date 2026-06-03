// reviewerApiV2.adapters.js — Backend → prototype shape adapters.
// Every function here takes the real backend response and returns the shape
// that the reviewer-v2 UI components expect.
//
// Mapping authority: docs/REVIEWER_REWIRE_PLAN.md §3 (API map) and §4
// (data shape diffs). When the backend adds new fields, update here first.

import { TIR_SCHEMA, SIP_SCHEMA } from "../pages/reviewer/review/applicationSchemas.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return String(d.getDate()).padStart(2, "0") + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function nowISO() { return new Date().toISOString(); }

// ── getMe adapter ─────────────────────────────────────────────────────────
// Backend GET /auth/me returns:
//   { id, email, full_name, roles, active_role, ... }
// Prototype expects:
//   { id, name, email, initials, cohort, domains[] }

export function adaptMe(me) {
  const name     = me.full_name || me.email || "Reviewer";
  const initials = name.includes(" ")
    ? name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return {
    id:       me.id,
    name,
    email:    me.email,
    initials,
    cohort:   "TIR cohort 2026",   // not in backend response yet
    domains:  [],                  // not in backend response yet
  };
}

// ── getQueue adapter ──────────────────────────────────────────────────────
// Backend GET /reviewer/assignments returns:
//   { assignments: [{ assignment_id, application_id, application_track,
//                     app_identifier, industry, problem_one_liner,
//                     assigned_at, assigned_by_display, my_review }] }
// Prototype queue row expects:
//   { id, applicationId, name, founders[], domain, industry, stage, track,
//     due, ai, reviewStatus }
//
// Phase 1 §3 gap: name, founders, stage, ai are NOT in the inbox response.
// We fill them with fallbacks; Phase 3 Option B (per-item fetch) is skipped
// in favour of showing app_identifier as the name until Phase 3 backend add.

export function adaptAssignmentToQueueRow(a) {
  return {
    // Use assignment_id as the local "id" so the queue table key is stable
    id:            a.assignment_id,
    applicationId: a.app_identifier || a.application_id,
    // Phase 3 gap: name and founders not in inbox response
    name:          a.app_identifier || a.application_id,
    founders:      [],
    // industry comes from the backend; use as domain too
    domain:        a.industry || "—",
    industry:      a.industry || "—",
    // stage and ai not in inbox response
    stage:         "—",
    ai:            null,
    track:         a.application_track || "tir",
    // due: backend returns assigned_at ISO; derive a human-readable string
    due:           assignedAtToDue(a.assigned_at),
    reviewStatus:  deriveReviewStatus(a.my_review),
    // keep raw ids for navigation
    _applicationId:  a.application_id,
    _track:          a.application_track,
    _assignmentId:   a.assignment_id,
    // problem one-liner for sub-title
    problem_one_liner: a.problem_one_liner || "",
  };
}

function assignedAtToDue(assignedAt) {
  if (!assignedAt) return "—";
  const daysAgo = Math.max(0, Math.floor((Date.now() - new Date(assignedAt).getTime()) / 86400000));
  // Show "Nd" for assigned N days ago; invert: if assigned recently, due is soon
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "1d";
  return `${daysAgo}d`;
}

// Derive the prototype reviewStatus from the backend my_review object.
// Backend my_review: { review_id, submitted_at, locked_at } (null if no review)
function deriveReviewStatus(myReview) {
  if (!myReview || !myReview.review_id) return "not-started";
  if (!myReview.submitted_at) return "draft";
  // submitted but within edit window → in-progress (editable)
  if (myReview.locked_at && new Date(myReview.locked_at).getTime() > Date.now()) {
    return "in-progress";
  }
  return "submitted";
}

// ── getEvalScreen adapter ─────────────────────────────────────────────────
// Backend GET /reviewer/applications/{track}/{id} returns:
//   { application: <tir_applications row>, assignment: {...},
//     my_review: <reviews row | null>, ai_screening: <row | null> }
//
// The application row has flat columns — not the nested shape the prototype
// reads (detail.fields, detail.aiSummary). We reconstruct it from the schema.

export function adaptApplicationForEvalScreen(backendPayload, queueIdx) {
  const { application: app, my_review, ai_screening, assignment } = backendPayload;
  const track = app.application_track || "tir";

  const detail = buildDetail(app, ai_screening, track);

  // Reconstruct a "name" from known columns; basic_org is the company name.
  const name     = app.basic_org || app.app_identifier || app.id;
  const founders = extractFounders(app, track);

  const application = {
    id:            app.id,
    applicationId: app.app_identifier || app.id,
    name,
    founders,
    domain:        app.basic_org || "—",
    stage:         app.solution_stage || "—",
    trl:           null,
    track,
    ai:            adaptAiScreening(ai_screening),
    detail,
    // keep assignment context for save/submit
    _assignmentId: assignment?.assignment_id,
    _track:        track,
  };

  const evaluation = my_review ? realToProto(my_review) : emptyEvaluation(app.id);

  return { application, evaluation };
}

function buildDetail(app, aiScreening, track) {
  const schema = track === "sip" ? SIP_SCHEMA : TIR_SCHEMA;

  // Short facts
  const fields = [
    { label: "Problem defined",  value: app.problem_defined || "—", short: true },
    { label: "Solution stage",   value: app.solution_stage  || "—", short: true },
  ];

  // Long-form fields from schema keys
  const longKeys = [
    { label: "Problem description", key: "problem_describe" },
    { label: "Solution description", key: "solution_describe" },
    { label: "Core technology",      key: "solution_core_tech" },
  ];
  for (const { label, key } of longKeys) {
    const value = app[key];
    if (value) fields.push({ label, value });
  }

  const aiSummary = aiScreening?.summary || "AI summary not yet available for this application.";

  return { aiSummary, fields };
}

function extractFounders(app, track) {
  if (track === "sip" && Array.isArray(app.sip_founders)) {
    return app.sip_founders.map((f) => f.name || f.full_name || "Founder");
  }
  if (Array.isArray(app.basic_teammates)) {
    return [app.basic_full_name, ...app.basic_teammates.map((t) => t.name || t.full_name || "Teammate")].filter(Boolean);
  }
  return [app.basic_full_name].filter(Boolean);
}

function adaptAiScreening(ai) {
  if (!ai) return null;
  return {
    overall:   ai.score_overall ?? null,
    conf:      null,
    problem:   ai.score_problem  ?? null,
    solution:  ai.score_solution ?? null,
    tech:      ai.score_tech     ?? null,
    founders:  ai.score_founders ?? null,
    commit:    ai.score_commitment ?? null,
  };
}

// ── Evaluation shape adapters (§4 Diff 2) ────────────────────────────────

// Backend review row → prototype Evaluation shape
export function realToProto(review) {
  if (!review) return null;
  const hasScores  = review.score_problem != null;
  const submitted  = !!review.submitted_at;
  let status;
  if (submitted) status = "submitted";
  else if (hasScores) status = "draft";
  else status = "not-started";

  return {
    appId:               review.application_id,
    reviewId:            review.id,
    status,
    scores: {
      problem:  review.score_problem     ?? 5.0,
      solution: review.score_solution    ?? 5.0,
      tech:     review.score_tech        ?? 5.0,
      founders: review.score_founders    ?? 5.0,
      commit:   review.score_commitment  ?? 5.0,
    },
    recommendation:      review.recommendation ?? null,
    notes:               review.strengths      ?? "",
    flags:               review.concerns       ? review.concerns.split("; ").filter(Boolean) : [],
    disagreements:       {},
    updatedAt:           review.updated_at     ?? null,
    submittedAt:         review.submitted_at   ?? null,
    editWindowExpiresAt: review.locked_at      ?? null,
  };
}

// Prototype Evaluation shape → backend POST /reviewer/reviews body
export function protoToReal(ev, { applicationId, applicationTrack, assignmentId, draft = true }) {
  return {
    application_id:    applicationId,
    application_track: applicationTrack,
    assignment_id:     assignmentId,
    score_problem:     ev.scores?.problem    != null ? Math.round(ev.scores.problem)    : null,
    score_solution:    ev.scores?.solution   != null ? Math.round(ev.scores.solution)   : null,
    score_tech:        ev.scores?.tech       != null ? Math.round(ev.scores.tech)       : null,
    score_founders:    ev.scores?.founders   != null ? Math.round(ev.scores.founders)   : null,
    score_commitment:  ev.scores?.commit     != null ? Math.round(ev.scores.commit)     : null,
    recommendation:    ev.recommendation ?? null,
    strengths:         ev.notes           ?? "",
    concerns:          (ev.flags || []).join("; "),
    quick_notes:       "",
    draft,
  };
}

// Prototype Evaluation shape → backend PATCH /reviewer/reviews/{id} body
export function protoToPatch(ev, { draft = true } = {}) {
  const patch = {};
  if (ev.scores) {
    if (ev.scores.problem    != null) patch.score_problem     = Math.round(ev.scores.problem);
    if (ev.scores.solution   != null) patch.score_solution    = Math.round(ev.scores.solution);
    if (ev.scores.tech       != null) patch.score_tech        = Math.round(ev.scores.tech);
    if (ev.scores.founders   != null) patch.score_founders    = Math.round(ev.scores.founders);
    if (ev.scores.commit     != null) patch.score_commitment  = Math.round(ev.scores.commit);
  }
  if (ev.recommendation !== undefined) patch.recommendation = ev.recommendation;
  if (ev.notes          !== undefined) patch.strengths       = ev.notes;
  if (ev.flags          !== undefined) patch.concerns        = (ev.flags || []).join("; ");
  patch.draft = draft;
  return patch;
}

// ── getHistory adapter ────────────────────────────────────────────────────
// Backend GET /reviewer/reviews?mine=true&locked=true returns:
//   { reviews: [{ review_id, application_id, application_track,
//                  app_identifier, problem_one_liner, score_overall_mine,
//                  recommendation, submitted_at }],
//     page, total_pages, total }

export function adaptHistoryRow(r) {
  return {
    appId:              r.application_id,
    name:               r.app_identifier || r.application_id,
    date:               fmtDate(r.submitted_at),
    aiScore:            "—",          // Phase 1 §3 gap — not in backend response
    myScore:            r.score_overall_mine ?? null,
    variance:           "—",          // Phase 1 §3 gap — requires aiScore
    reco:               r.recommendation ?? "—",
    adminDec:           "—",          // Phase 1 §3 gap — not in backend response
    source:             "history",
    editWindowExpiresAt: null,        // locked reviews have no edit window
    _reviewId:          r.review_id,
    _track:             r.application_track,
  };
}

// ── Empty evaluation (for 404 / no review yet) ────────────────────────────
export function emptyEvaluation(appId) {
  return {
    appId,
    reviewId: null,
    status: "not-started",
    scores: { problem: 5.0, solution: 5.0, tech: 5.0, founders: 5.0, commit: 5.0 },
    recommendation: null,
    notes: "",
    disagreements: {},
    flags: [],
    updatedAt: null,
    submittedAt: null,
    editWindowExpiresAt: null,
  };
}
