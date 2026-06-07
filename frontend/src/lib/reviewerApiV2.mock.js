// reviewerApiV2.mock.js — Phase 2 mock implementation, preserved verbatim.
// Active when VITE_REVIEWER_V2_MOCK=true.
// Do NOT edit for production wiring — that lives in reviewerApiV2.js.

import {
  STARTUPS,
  QUEUE_ITEM_INDUSTRY,
  QUEUE_ITEM_STAGE,
  QUEUE_ITEM_DUE,
  HISTORY_ROWS,
} from "../pages/reviewer-v2/data/mockData.js";

const QUEUE_N     = 8;
const LS_KEY      = "artpark.reviewer.evaluations.v3";
const HIST_LS_KEY = "artpark.reviewer.history.v3";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function nowISO()  { return new Date().toISOString(); }
function round1(n) { return Math.round(n * 10) / 10; }

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

export function emptyEvaluation(appId) {
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

const APP_DETAIL = {
  aiSummary:
    "Evaldam AI addresses the critical pain point of startup valuation and financial decision-making in India, which is currently slow, expensive, inaccurate, and often non-compliant with local regulations. The platform leverages a fine-tuned LLM, proprietary blended valuation methodology, and a curated dataset of Indian comparables to deliver rapid, cost-effective, and regulation-aware valuations.",
  fields: [
    { label: "Problem defined",      value: "Yes",                  short: true },
    { label: "Problem Description",  bullets: [
        "Indian startups face inaccurate, slow, expensive, and often non-compliant valuation during fundraising.",
        "Founders either pay ₹50,000–₹2,00,000+ for generic consultant reports, or use global tools that ignore Indian rules.",
        "This drives excessive founder dilution, failed or delayed rounds, poor capital allocation, and loss of equity.",
        "LLMs are now mature for structured financial reasoning, and India's early-stage surge needs localized AI financial intelligence.",
      ],
    },
    { label: "Solution stage",       value: "Pilot-ready product",  short: true },
    { label: "Solution Description", bullets: [
        "AI platform delivering fast, regulation-aware, transparent, and defensible startup valuations tuned for India.",
        "Speed: cuts valuation report generation from days/weeks to seconds/minutes.",
        "Cost: dramatically lower than traditional consultants, at equal or better quality.",
      ],
    },
    { label: "Solution Core Tech",   bullets: [
        "A fine-tuned LLM specialized in Indian startup finance, plus a proprietary blended valuation engine.",
        "Indian regulatory knowledge (FEMA, Rule 11UA/57, IBBI, CCPS/CCD) is built directly into the AI reasoning layer.",
      ],
    },
  ],
};

// ── Mock wait helper (latency is owned by the main module, not here) ──────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Exported mock implementations ─────────────────────────────────────────

export async function getMe(latencyMs) {
  await wait(latencyMs);
  return {
    id: "r1",
    name: "Vikram Sundar",
    email: "vikram@artpark.in",
    initials: "VS",
    cohort: "TIR + VIP cohort 2026",
    domains: ["Robotics", "Mobility"],
  };
}

export async function getQueue(latencyMs) {
  await wait(latencyMs);
  return canonicalQueue();
}

export async function getEvalScreen(idx, source = "queue", latencyMs) {
  await wait(latencyMs);
  const raw   = STARTUPS[idx] || STARTUPS[2];
  const appId = raw.id;
  const st    = storeFor(source);
  const application = {
    ...raw,
    applicationId: appIdOf(raw),
    track: idx < 5 ? "tir" : "sip",
    detail: APP_DETAIL,
  };
  const evaluation = st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
  return { application, evaluation };
}

export async function getEvaluation(appId, source = "queue", latencyMs) {
  await wait(latencyMs);
  const st = storeFor(source);
  return st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
}

export async function saveEvaluation(appId, draft, source = "queue", latencyMs) {
  await wait(latencyMs);
  const st   = storeFor(source);
  const prev = st[appId] || emptyEvaluation(appId);
  st[appId]  = {
    ...prev,
    ...draft,
    appId,
    status:    draft.status === "submitted" ? "submitted" : "draft",
    updatedAt: nowISO(),
  };
  persist();
  return { ...st[appId] };
}

export async function submitEvaluation(appId, body, source = "queue", latencyMs) {
  const saved = await saveEvaluation(appId, { ...body, status: "submitted" }, source, latencyMs);
  saved.submittedAt = nowISO();
  storeFor(source)[appId] = saved;
  persist();
  return { ...saved };
}

export async function getHistory(latencyMs) {
  await wait(latencyMs);
  const histIds = new Set(HISTORY_ROWS.map((r) => r.appId));

  const currentRows = STARTUPS
    .filter((s) => STORE[s.id] && STORE[s.id].status === "submitted" && !histIds.has(s.id))
    .map((s) => {
      const ev      = STORE[s.id];
      const myScore = avgScores(ev.scores);
      return {
        appId: s.id, name: s.name, date: fmtDate(ev.submittedAt),
        aiScore: "—", myScore, variance: "—",
        reco: ev.recommendation || "—", adminDec: "pending",
        source: "queue", editWindowExpiresAt: null,
      };
    });

  const pastRows = HISTORY_ROWS.map((r) => {
    const ev = HISTORY_STORE[r.appId];
    if (ev && ev.status === "submitted") {
      const myScore = avgScores(ev.scores);
      const date    = ev.updatedAt ? fmtDate(ev.submittedAt || ev.updatedAt) : r.date;
      return {
        ...r, source: "history", date,
        reco: ev.recommendation || r.reco, myScore,
        aiScore: "—", adminDec: "—", variance: "—",
        editWindowExpiresAt: null,
      };
    }
    return { ...r, source: "history", aiScore: "—", adminDec: "—", variance: "—", editWindowExpiresAt: null };
  });

  return {
    stats: { total: "—", consistencyPct: "—", avgVariance: "—", avgMinutes: "—" },
    rows:  [...currentRows, ...pastRows],
  };
}

export function resetEvaluations() {
  STORE         = seedStore();
  HISTORY_STORE = seedHistory();
  persist();
}
