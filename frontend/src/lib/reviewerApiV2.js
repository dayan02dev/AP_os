// reviewerApiV2.js — API client for the new reviewer UI.
// PHASE 2: mock implementation matching the prototype's window.ReviewerAPI.
// PHASE 3: swap method bodies for real fetch() calls against
//   backend/app/routers/reviewer.py (see API mapping in
//   docs/REVIEWER_REWIRE_PLAN.md section 3).

import {
  STARTUPS,
  QUEUE_ITEM_INDUSTRY,
  QUEUE_ITEM_STAGE,
  QUEUE_ITEM_DUE,
  HISTORY_ROWS,
} from "../pages/reviewer-v2/data/mockData.js";

// ── Constants ──────────────────────────────────────────────────────────────
const QUEUE_N = 8;
const LS_KEY      = "artpark.reviewer.evaluations.v3";
const HIST_LS_KEY = "artpark.reviewer.history.v3";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Helpers ────────────────────────────────────────────────────────────────
function nowISO() { return new Date().toISOString(); }

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return String(d.getDate()).padStart(2, "0") + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function appIdOf(s) {
  return "TIR-" + s.id.replace("s", "").padStart(5, "0");
}

function scoresAt(v) {
  return { problem: v, solution: v, tech: v, founders: v, commit: v };
}

function avgScores(s) {
  const a = Object.values(s);
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function round1(n) { return Math.round(n * 10) / 10; }

// ── Evaluation store (module-level state + localStorage persistence) ────────
// Two separate stores (current cohort vs past cohort) so editing a history
// item never clobbers the queue evaluation and vice versa.

function emptyEvaluation(appId) {
  return {
    appId,
    status: "not-started",
    scores: { problem: 5.0, solution: 5.0, tech: 5.0, founders: 5.0, commit: 5.0 },
    recommendation: null,
    notes: "",
    disagreements: {},
    flags: [],
    updatedAt: null,
    submittedAt: null,
  };
}

function seedStore() {
  return {
    s01: { ...emptyEvaluation("s01"), status: "submitted" },
    s02: { ...emptyEvaluation("s02"), status: "in-progress" },
    s03: {
      ...emptyEvaluation("s03"),
      status: "draft",
      scores: { problem: 6.5, solution: 5.5, tech: 6.0, founders: 5.0, commit: 6.0 },
      recommendation: "maybe",
      notes: "I disagree on Founders score — sole founder, no team yet. Idea is real, execution risk high.",
      flags: ["Single founder — execution risk", "Pilot data referenced but not shared"],
    },
  };
}

function seedHistory() {
  const h = {};
  HISTORY_ROWS.forEach((r) => {
    h[r.appId] = {
      ...emptyEvaluation(r.appId),
      status: "submitted",
      scores: scoresAt(r.myScore),
      recommendation: r.reco,
      submittedAt: r.date,
    };
  });
  return h;
}

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

let STORE         = loadJSON(LS_KEY)      || seedStore();
let HISTORY_STORE = loadJSON(HIST_LS_KEY) || seedHistory();

function persist() {
  try {
    localStorage.setItem(LS_KEY,      JSON.stringify(STORE));
    localStorage.setItem(HIST_LS_KEY, JSON.stringify(HISTORY_STORE));
  } catch { /* ignore */ }
}
persist();

function storeFor(source) {
  return source === "history" ? HISTORY_STORE : STORE;
}

// ── Canonical queue builder ────────────────────────────────────────────────
function canonicalQueue() {
  return STARTUPS.slice(0, QUEUE_N).map((s, i) => ({
    ...s,
    applicationId: appIdOf(s),
    domain:        QUEUE_ITEM_INDUSTRY[i],
    industry:      QUEUE_ITEM_INDUSTRY[i],
    stage:         QUEUE_ITEM_STAGE[i],
    track:         i < 5 ? "tir" : "sip",
    due:           QUEUE_ITEM_DUE[i],
    reviewStatus:  (STORE[s.id] && STORE[s.id].status) || "not-started",
  }));
}

// Simulated latency so loading states are exercised in dev.
const wait = () =>
  new Promise((r) => setTimeout(r, reviewerApiV2.latencyMs));

// ── The APP_DETAIL mock (Evaldam AI — shown for all apps in Phase 2) ──────
// Phase 3 replaces getEvalScreen with a real fetch to
//   GET /reviewer/applications/{track}/{id}
// which returns per-application content.
const APP_DETAIL = {
  aiSummary:
    "Evaldam AI addresses the critical pain point of startup valuation and financial decision-making in India, which is currently slow, expensive, inaccurate, and often non-compliant with local regulations. The platform leverages a fine-tuned LLM, proprietary blended valuation methodology, and a curated dataset of Indian comparables to deliver rapid, cost-effective, and regulation-aware valuations.",
  fields: [
    { label: "Problem defined",           value: "Yes",                                      short: true },
    { label: "Problem Description",
      bullets: [
        "Indian startups face inaccurate, slow, expensive, and often non-compliant valuation during fundraising.",
        "Founders either pay ₹50,000–₹2,00,000+ for generic consultant reports, or use global tools (e.g. Equidam) that ignore Indian rules (FEMA, Rule 11UA, IBBI, CCPS/CCD).",
        "This drives excessive founder dilution, failed or delayed rounds, poor capital allocation, and loss of equity.",
        "It affects thousands of early-stage startups a year, with real economic and psychological cost to the ecosystem.",
        "LLMs are now mature for structured financial reasoning, and India's early-stage surge needs localized AI financial intelligence.",
      ],
    },
    { label: "Solution stage",            value: "Pilot-ready product",                      short: true },
    { label: "Solution Description",
      bullets: [
        "AI platform delivering fast, regulation-aware, transparent, and defensible startup valuations tuned for India.",
        "Speed: cuts valuation report generation from days/weeks to seconds/minutes.",
        "Cost: dramatically lower than traditional consultants, at equal or better quality.",
        "Accuracy & compliance: outputs respect FEMA, Rule 11UA, and IBBI standards, with full transparency on assumptions and comparables.",
        "Built on a fine-tuned domain LLM, a blended methodology (Scorecard + Berkus + VC Method + DCF, India-adjusted), and a growing dataset of Indian comparables.",
      ],
    },
    { label: "Solution Core Tech",
      bullets: [
        "A fine-tuned LLM specialized in Indian startup finance, plus a proprietary blended valuation engine and a growing comparables dataset.",
        "Indian regulatory knowledge (FEMA, Rule 11UA/57, IBBI, CCPS/CCD) is built directly into the AI reasoning layer — which global models lack.",
        "A blended methodology that auto-adjusts weighting by stage, data quality, and Indian market realities.",
        "A curated, expanding dataset of Indian comparables and regulatory interpretations that improves with usage.",
      ],
    },
  ],
};

// ── Public API ─────────────────────────────────────────────────────────────
export const reviewerApiV2 = {
  latencyMs: 200,

  async getMe() {
    await wait();
    return {
      id: "r1",
      name: "Vikram Sundar",
      email: "vikram@artpark.in",
      initials: "VS",
      cohort: "TIR + VIP cohort 2026",
      domains: ["Robotics", "Mobility"],
    };
  },

  async getQueue() {
    await wait();
    return canonicalQueue();
  },

  // Returns { application, evaluation } for the evaluation screen.
  // source: 'queue' | 'history' — picks the correct evaluation store.
  async getEvalScreen(idx, source = "queue") {
    await wait();
    const raw = STARTUPS[idx] || STARTUPS[2];
    const appId = raw.id;
    const st = storeFor(source);
    const application = {
      ...raw,
      applicationId: appIdOf(raw),
      track: idx < 5 ? "tir" : "sip",
      detail: APP_DETAIL,
    };
    const evaluation = st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
    return { application, evaluation };
  },

  async getEvaluation(appId, source = "queue") {
    await wait();
    const st = storeFor(source);
    return st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
  },

  async saveEvaluation(appId, draft, source = "queue") {
    await wait();
    const st = storeFor(source);
    const prev = st[appId] || emptyEvaluation(appId);
    st[appId] = {
      ...prev,
      ...draft,
      appId,
      status: draft.status === "submitted" ? "submitted" : "draft",
      updatedAt: nowISO(),
    };
    persist();
    return { ...st[appId] };
  },

  async submitEvaluation(appId, body, source = "queue") {
    const saved = await this.saveEvaluation(
      appId,
      { ...body, status: "submitted" },
      source,
    );
    saved.submittedAt = nowISO();
    storeFor(source)[appId] = saved;
    persist();
    return { ...saved };
  },

  async getHistory() {
    await wait();
    const histIds = new Set(HISTORY_ROWS.map((r) => r.appId));

    // Current-cohort submissions not yet in the historical list
    const currentRows = STARTUPS
      .filter((s) => STORE[s.id] && STORE[s.id].status === "submitted" && !histIds.has(s.id))
      .map((s) => {
        const ev = STORE[s.id];
        const myScore = avgScores(ev.scores);
        return {
          appId: s.id,
          name: s.name,
          date: fmtDate(ev.submittedAt),
          aiScore: "—",           // Phase 1 §3 gap: not returned by real API yet
          myScore,
          variance: "—",          // requires aiScore to compute
          reco: ev.recommendation || "—",
          adminDec: "pending",
          source: "queue",
        };
      });

    // Past-cohort rows — merge stored evaluation state with static metadata
    const pastRows = HISTORY_ROWS.map((r) => {
      const ev = HISTORY_STORE[r.appId];
      if (ev && ev.status === "submitted") {
        const myScore = avgScores(ev.scores);
        const date = ev.updatedAt
          ? fmtDate(ev.submittedAt || ev.updatedAt)
          : r.date;
        return {
          ...r,
          source: "history",
          date,
          reco: ev.recommendation || r.reco,
          myScore,
          aiScore: "—",          // Phase 1 §3 gap: not returned by real API yet
          adminDec: "—",         // Phase 1 §3 gap: not returned by real API yet
          variance: "—",         // requires aiScore to compute
          editWindowExpiresAt: null, // past reviews: no live edit window
        };
      }
      return {
        ...r,
        source: "history",
        aiScore: "—",
        adminDec: "—",
        variance: "—",
        editWindowExpiresAt: null,
      };
    });

    return {
      // Phase 1 §3 gap: stats aggregate not returned by real API yet.
      stats: { total: "—", consistencyPct: "—", avgVariance: "—", avgMinutes: "—" },
      rows: [...currentRows, ...pastRows],
    };
  },

  signOut() {
    console.info("[reviewerApiV2] signOut() stub — wire to useAuth().logout");
  },

  _resetEvaluations() {
    STORE         = seedStore();
    HISTORY_STORE = seedHistory();
    persist();
  },
};
