// reviewerApiV2.js — API client for the new reviewer UI.
// PHASE 2: mock implementation (active when VITE_REVIEWER_V2_MOCK=true).
// PHASE 3: real fetch() calls against backend/app/routers/reviewer.py.
//   See docs/REVIEWER_REWIRE_PLAN.md §3 for the full API map.
//   See reviewerApiV2.adapters.js for backend → prototype shape adapters.
//   See reviewerApiV2.mock.js for the Phase 2 mock implementation.

import { api } from "./api.js";
import * as mock from "./reviewerApiV2.mock.js";
import {
  adaptMe,
  adaptAssignmentToQueueRow,
  adaptApplicationForEvalScreen,
  realToProto,
  protoToReal,
  protoToPatch,
  adaptHistoryRow,
  emptyEvaluation,
} from "./reviewerApiV2.adapters.js";

// ── Feature flags ─────────────────────────────────────────────────────────
// VITE_REVIEWER_V2_MOCK=true   → use mock data (no backend needed)
// VITE_REVIEWER_V2_READONLY=true → block writes, show demo-mode toast
const USE_MOCK = import.meta.env.VITE_REVIEWER_V2_MOCK === "true";
const READONLY = import.meta.env.VITE_REVIEWER_V2_READONLY === "true";

// ── Toast helper ──────────────────────────────────────────────────────────
// window.toast is wired by the app shell. Guard in case the page is rendered
// outside the shell context (e.g. tests).
function toast(msg) {
  if (typeof window !== "undefined" && typeof window.toast === "function") {
    window.toast(msg);
  } else {
    console.info("[reviewerApiV2]", msg);
  }
}

function nowISO() { return new Date().toISOString(); }

// ── Module-level queue cache ──────────────────────────────────────────────
// getEvalScreen resolves an idx → applicationId by reading the cached queue.
// Reset when getQueue is called so stale state doesn't cause wrong navigation.
let _queueCache = null;

function queueItemAt(idx) {
  if (_queueCache && _queueCache[idx]) return _queueCache[idx];
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────
export const reviewerApiV2 = {
  // Simulated latency knob (used by mock only; real network dominates in prod)
  latencyMs: 200,

  // ── getMe ───────────────────────────────────────────────────────────────
  async getMe() {
    if (USE_MOCK) return mock.getMe(this.latencyMs);

    const me = await api.get("/auth/me");
    return adaptMe(me);
  },

  // ── getQueue ────────────────────────────────────────────────────────────
  async getQueue() {
    if (USE_MOCK) {
      const q = await mock.getQueue(this.latencyMs);
      _queueCache = q;
      return q;
    }

    const res = await api.get("/reviewer/assignments");
    const rows = (res.assignments || []).map(adaptAssignmentToQueueRow);
    _queueCache = rows;
    return rows;
  },

  // ── getEvalScreen ────────────────────────────────────────────────────────
  // idx is a 0-based queue index. Resolves to an (applicationId, track) pair
  // from the cached queue, then fetches the full application + my_review.
  async getEvalScreen(idx, source = "queue") {
    if (USE_MOCK) return mock.getEvalScreen(idx, source, this.latencyMs);

    // Resolve application_id and track from the cached queue
    const queueItem = queueItemAt(idx);
    if (!queueItem) {
      // Queue not yet loaded — fetch it first, then retry
      await this.getQueue();
      const item = queueItemAt(idx);
      if (!item) throw new Error(`No queue item at index ${idx}. Queue has ${(_queueCache || []).length} items.`);
    }
    const item  = queueItemAt(idx);
    const appId = item._applicationId || item.applicationId;
    const track = item._track || item.track || "tir";

    // Parallel fetch: application detail + my_review
    const [appPayload, reviewRes] = await Promise.all([
      api.get(`/reviewer/applications/${track}/${appId}`),
      api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(appId)}`).catch((err) => {
        // 404 means no review yet — return null so we show empty evaluation
        if (err && err.status === 404) return { review: null };
        throw err;
      }),
    ]);

    // Merge my_review from the probe endpoint (more reliable than the one
    // bundled in the application payload, which may be stale after a draft)
    const myReview = reviewRes?.review ?? appPayload?.my_review ?? null;
    const merged   = { ...appPayload, my_review: myReview };

    return adaptApplicationForEvalScreen(merged, idx);
  },

  // ── getEvaluation ────────────────────────────────────────────────────────
  async getEvaluation(appId, source = "queue") {
    if (USE_MOCK) return mock.getEvaluation(appId, source, this.latencyMs);

    const res = await api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(appId)}`).catch((err) => {
      if (err && err.status === 404) return { review: null };
      throw err;
    });
    const row = res?.review ?? null;
    return row ? realToProto(row) : emptyEvaluation(appId);
  },

  // ── saveEvaluation ────────────────────────────────────────────────────────
  // Debounce lives in the calling page (ReviewerV2EvaluationPage), not here.
  // This method is the raw write — called after the debounce fires.
  async saveEvaluation(appId, draft, source = "queue") {
    if (USE_MOCK) return mock.saveEvaluation(appId, draft, source, this.latencyMs);

    if (READONLY) {
      toast("Demo mode — evaluation not saved.");
      return { ...draft, appId, updatedAt: nowISO() };
    }

    // Resolve the review_id and context from the queue cache
    const queueItem  = _findQueueItemByAppId(appId);
    const assignmentId = queueItem?._assignmentId ?? draft._assignmentId;
    const track        = queueItem?._track        ?? draft._track ?? "tir";

    // TODO(post-demo): Cache "review exists" flag in module-level state after
    // the first successful GET or POST. Subsequent saves should skip this
    // probe and go straight to PATCH. Currently adds one round-trip per
    // autosave (debounced 800ms in the page = ~once per edit burst).
    // Acceptable for the pilot demo; refactor before scaling to many reviewers.

    // Check whether a review already exists for this application
    const probeRes = await api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(appId)}`).catch((err) => {
      if (err && err.status === 404) return { review: null };
      throw err;
    });
    const existing = probeRes?.review ?? null;

    if (existing && existing.id) {
      // PATCH the existing review (draft save)
      const patch = protoToPatch(draft, { draft: true });
      await api.patch(`/reviewer/reviews/${existing.id}`, patch);
    } else {
      // POST a new draft review
      const body = protoToReal(draft, {
        applicationId:    appId,
        applicationTrack: track,
        assignmentId:     assignmentId,
        draft:            true,
      });
      await api.post("/reviewer/reviews", body);
    }

    return { ...draft, appId, updatedAt: nowISO() };
  },

  // ── submitEvaluation ─────────────────────────────────────────────────────
  async submitEvaluation(appId, body, source = "queue") {
    if (USE_MOCK) return mock.submitEvaluation(appId, body, source, this.latencyMs);

    if (READONLY) {
      toast("Demo mode — submission blocked.");
      return { ...body, appId, submittedAt: nowISO(), status: "submitted" };
    }

    const queueItem  = _findQueueItemByAppId(appId);
    const assignmentId = queueItem?._assignmentId ?? body._assignmentId;
    const track        = queueItem?._track        ?? body._track ?? "tir";

    // TODO(post-demo): same probe-caching refactor as saveEvaluation applies here.

    // Check for existing review to decide POST vs PATCH
    const probeRes = await api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(appId)}`).catch((err) => {
      if (err && err.status === 404) return { review: null };
      throw err;
    });
    const existing = probeRes?.review ?? null;

    if (existing && existing.id) {
      // PATCH with draft:false to stamp submitted_at + locked_at
      const patch = protoToPatch(body, { draft: false });
      await api.patch(`/reviewer/reviews/${existing.id}`, patch);
    } else {
      // POST a full submission in one shot
      const postBody = protoToReal(body, {
        applicationId:    appId,
        applicationTrack: track,
        assignmentId:     assignmentId,
        draft:            false,
      });
      await api.post("/reviewer/reviews", postBody);
    }

    const submittedAt = nowISO();
    return { ...body, appId, submittedAt, status: "submitted" };
  },

  // ── getHistory ────────────────────────────────────────────────────────────
  async getHistory() {
    if (USE_MOCK) return mock.getHistory(this.latencyMs);

    // GET /reviewer/reviews?mine=true&locked=true
    const res = await api.get("/reviewer/reviews?mine=true&locked=true");
    const rows = (res.reviews || []).map(adaptHistoryRow);

    return {
      // Phase 1 §3 gap: stats aggregate not returned by this endpoint.
      stats: { total: "—", consistencyPct: "—", avgVariance: "—", avgMinutes: "—" },
      rows,
    };
  },

  // ── signOut ───────────────────────────────────────────────────────────────
  signOut() {
    // The real sign-out is handled by useAuth().logout in the shell.
    // This stub is here so any call site that calls reviewerApiV2.signOut()
    // doesn't throw. The shell wires the button directly to useAuth().logout.
    console.info("[reviewerApiV2] signOut() called — handled by useAuth().logout in the shell.");
  },

  // ── _resetEvaluations ─────────────────────────────────────────────────────
  _resetEvaluations() {
    if (USE_MOCK) {
      mock.resetEvaluations();
      return;
    }
    console.warn("[reviewerApiV2] _resetEvaluations() is a no-op in real-API mode — cannot reset the production DB from the client.");
  },
};

// ── Internal helper ────────────────────────────────────────────────────────
// Find a queue item by applicationId across the module-level cache.
function _findQueueItemByAppId(appId) {
  if (!_queueCache) return null;
  return _queueCache.find(
    (item) => item._applicationId === appId || item.applicationId === appId,
  ) ?? null;
}
