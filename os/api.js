// =====================================================================
// ARTPARK Reviewer — API client seam (MOCK implementation)
//
// This is the ONLY place the UI talks to "the backend". Every method
// returns a Promise and resolves the current mock data (window.OS_DATA +
// a localStorage-backed evaluation store). To go live, a backend dev
// swaps each method body for a real fetch() — the signatures and the
// data shapes below stay identical, so no component has to change.
//
//   getMe()                       -> Reviewer
//   getQueue()                    -> QueueItem[]
//   getEvalScreen(idx)            -> { application: Application, evaluation: Evaluation }
//   getEvaluation(appId)          -> Evaluation
//   saveEvaluation(appId, draft)  -> Evaluation        (status: 'draft')
//   submitEvaluation(appId, body) -> Evaluation        (status: 'submitted')
//   getHistory()                  -> { stats, rows }
//   signOut()                     -> void  (stub)
//
// Data contract (JSDoc typedefs — informal "types" for the handoff):
//
// @typedef {Object} Reviewer
//   { id, name, email, initials, cohort, domains: string[] }
// @typedef {Object} QueueItem
//   { id, applicationId, name, founders: string[], domain, industry,
//     stage, track:'tir'|'sip', due, ai:AiScores, reviewStatus }
// @typedef {Object} AiScores
//   { overall, conf, problem, solution, tech, founders, commit, integrity }
// @typedef {Object} Application   (the full thing the reviewer reads)
//   { id, applicationId, name, founders, domain, stage, trl, ai, detail }
// @typedef {Object} Evaluation    (the reviewer's working record)
//   { appId, status:'not-started'|'draft'|'in-progress'|'submitted',
//     scores:{problem,solution,tech,founders,commit},
//     recommendation:'yes'|'maybe'|'no'|null, notes, disagreements:{},
//     flags:string[], updatedAt, submittedAt }
// =====================================================================

(function () {
  const D = () => window.OS_DATA;
  const QUEUE_N = 8;

  // Canonical per-queue overrides (single source of truth for the queue).
  const QUEUE_ITEM_INDUSTRY = ['Robotics & Automation','Healthcare / MedTech','Climate Fintech / Urban Resilience','Healthcare / MedTech','Robotics & Automation','Artificial Intelligence / Foundational Models','Artificial Intelligence / Foundational Models','EV Mobility & Services'];
  const QUEUE_ITEM_STAGE    = ['Pilot-ready','Prototype','Pilot-ready','Lab demo','Research','Active pilots','Lab demo','Lab demo'];
  const QUEUE_ITEM_DUE      = ['1d','2d','3d','3d','4d','5d','6d','7d'];

  const appIdOf = s => 'TIR-' + s.id.replace('s', '').padStart(5, '0');

  // ---- Evaluation store (in-memory + localStorage so drafts survive refresh) ----
  const LS_KEY = 'artpark.reviewer.evaluations.v7'; // single source of truth for all evaluations
  const nowISO = () => new Date().toISOString();

  // Admin's final decision per application (owned by the Admin portal / backend).
  // A submitted evaluation with no entry here shows as 'pending' in My History.
  const ADMIN_DECISIONS = {
    s01: 'approved', s03: 'rejected', s04: 'approved', s07: 'approved', s08: 'rejected',
  };

  const scoresAt = (v) => ({ problem: v, solution: v, tech: v, founders: v, commit: v });
  const avgScores = (s) => { const a = Object.values(s); return a.reduce((x, y) => x + y, 0) / a.length; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  function emptyEvaluation(appId) {
    return {
      appId, status: 'not-started',
      scores: { problem: 5.0, solution: 5.0, tech: 5.0, founders: 5.0, commit: 5.0 },
      recommendation: null, notes: '', disagreements: {}, flags: [],
      updatedAt: null, submittedAt: null,
    };
  }

  // ── Single evaluation store (one source of truth) ───────────────────────
  // STORE drives My Queue, the dashboard, the evaluation screen AND My History.
  // My History is simply every entry whose status === 'submitted' (see getHistory),
  // so submitting in the queue surfaces it in History instantly — no separate,
  // drifting copy to keep in sync. (Backend keys these by review-id; handoff §2.4.)

  // A submitted-evaluation seed (all five dimensions set to `score`).
  const submittedEval = (appId, score, reco, dateISO) => ({
    ...emptyEvaluation(appId), status: 'submitted',
    scores: scoresAt(score), recommendation: reco, submittedAt: dateISO, updatedAt: dateISO,
  });

  // Seed spread: 5 submitted · 1 in-progress · 1 draft · 1 not-started (s06).
  // Submit dates fall AFTER applications closed (22 May 2026) and around the
  // 28 May snapshot shown in the cohort header — so the timeline is coherent.
  function seedStore() {
    return {
      s01: submittedEval('s01', 7.9, 'yes',   '2026-05-28'),
      s02: { ...emptyEvaluation('s02'), status: 'in-progress' },
      s03: submittedEval('s03', 5.8, 'maybe', '2026-05-27'),
      s04: submittedEval('s04', 8.3, 'yes',   '2026-05-26'),
      s05: { ...emptyEvaluation('s05'), status: 'draft',
        scores: { problem: 6.5, solution: 5.5, tech: 6.0, founders: 5.0, commit: 6.0 },
        recommendation: 'maybe',
        notes: 'I disagree on Founders score — sole founder, no team yet. Idea is real, execution risk high.',
        flags: ['Single founder — execution risk', 'Pilot data referenced but not shared'],
      },
      s07: submittedEval('s07', 7.0, 'yes',   '2026-05-25'),
      s08: submittedEval('s08', 5.5, 'no',    '2026-05-24'),
    };
  }

  function loadJSON(key) {
    try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  let STORE = loadJSON(LS_KEY) || seedStore();
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STORE)); } catch (e) {}
  }
  persist();

  // One store. `source` is kept in method signatures only so the eval screen knows
  // whether to navigate back to the Queue or History tab — data always lives in STORE.
  const storeFor = () => STORE;

  // Simulated network latency so loading states are real. Set to 0 to disable.
  const wait = () => new Promise(r => setTimeout(r, window.ReviewerAPI.latencyMs));

  function canonicalQueue() {
    return D().STARTUPS.slice(0, QUEUE_N).map((s, i) => ({
      ...s,
      applicationId: appIdOf(s),
      domain:    QUEUE_ITEM_INDUSTRY[i],   // alias kept so existing s.domain refs work
      industry:  QUEUE_ITEM_INDUSTRY[i],
      stage:     QUEUE_ITEM_STAGE[i],
      track:     i < 5 ? 'tir' : 'sip',
      due:       QUEUE_ITEM_DUE[i],
      reviewStatus:          (STORE[s.id] && STORE[s.id].status)                  || 'not-started',
    }));
  }

  window.ReviewerAPI = {
    latencyMs: 200,
    QUEUE_N,

    async getMe() {
      await wait();
      return { id: 'r1', name: 'Vikram Sundar', email: 'vikram@artpark.in',
        initials: 'VS', cohort: 'TIR + VIP cohort 2026', domains: ['Robotics', 'Mobility'] };
    },

    async getQueue() {
      await wait();
      return canonicalQueue();
    },

    // Bundle for the evaluation screen — application content + the reviewer's draft.
    // source: 'queue' (current cohort) | 'history' (past cohort) — picks the store.
    async getEvalScreen(idx, source = 'queue') {
      await wait();
      const raw = D().STARTUPS[idx] || D().STARTUPS[2];
      const appId = raw.id;
      const st = storeFor(source);
      // track mirrors the queue rule (first 5 = TIR, rest = VIP) so labels read correctly.
      const application = { ...raw, applicationId: appIdOf(raw), track: idx < 5 ? 'tir' : 'sip', detail: window.APP_DETAIL };
      const evaluation = st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
      return { application, evaluation };
    },

    async getEvaluation(appId, source = 'queue') {
      await wait();
      const st = storeFor(source);
      return st[appId] ? { ...st[appId] } : emptyEvaluation(appId);
    },

    async saveEvaluation(appId, draft, source = 'queue') {
      await wait();
      const st = storeFor(source);
      const prev = st[appId] || emptyEvaluation(appId);
      st[appId] = { ...prev, ...draft, appId,
        status: draft.status === 'submitted' ? 'submitted' : 'draft',
        updatedAt: nowISO() };
      persist();
      return { ...st[appId] };
    },

    async submitEvaluation(appId, body, source = 'queue') {
      const saved = await this.saveEvaluation(appId, { ...body, status: 'submitted' }, source);
      saved.submittedAt = nowISO();
      storeFor(source)[appId] = saved; persist();
      return { ...saved };
    },

    async getHistory() {
      await wait();
      // My History = every queue evaluation the reviewer has SUBMITTED, live from the
      // one store, newest first. Submitting in the queue surfaces it here instantly;
      // re-submitting an edit updates the same record everywhere.
      const rows = D().STARTUPS.slice(0, QUEUE_N)
        .filter(s => STORE[s.id] && STORE[s.id].status === 'submitted')
        .sort((a, b) => String(STORE[b.id].submittedAt || '').localeCompare(String(STORE[a.id].submittedAt || '')))
        .map(s => {
          const ev = STORE[s.id];
          return {
            appId: s.id, name: s.name,
            date: fmtDate(ev.submittedAt || ev.updatedAt),
            myScore: avgScores(ev.scores),
            reco: ev.recommendation || '—',
            adminDec: ADMIN_DECISIONS[s.id] || 'pending',
            source: 'history',   // nav hint only — data lives in the single store
          };
        });
      return { stats: { total: rows.length }, rows };
    },


    // Stub — backend wires real auth/session teardown here.
    signOut() {
      window.toast && window.toast('Sign out — wire to auth/session (stub)');
      console.info('[ReviewerAPI] signOut() called — stub.');
    },

    // Test/Reset helper for the demo.
    _resetEvaluations() { STORE = seedStore(); persist(); },
  };

  // ---- Tiny generic async hook used by every data-driven component ----
  // Returns { loading, data, error, reload }. Re-runs when `deps` change.
  window.useAsync = function useAsync(fn, deps) {
    const [state, setState] = React.useState({ loading: true, data: null, error: null });
    const idRef = React.useRef(0);
    const run = React.useCallback(() => {
      const id = ++idRef.current;
      setState(s => ({ ...s, loading: true, error: null }));
      Promise.resolve().then(fn).then(
        data => { if (idRef.current === id) setState({ loading: false, data, error: null }); },
        error => { if (idRef.current === id) setState({ loading: false, data: null, error }); }
      );
    }, deps || []);
    React.useEffect(run, deps || []);
    return { ...state, reload: run };
  };

  // ---- Minimal toast for stubbed actions / save confirmations ----
  window.toast = function toast(msg) {
    let host = document.getElementById('rv-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rv-toast-host';
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'background:#242424;color:#fff;font:600 13px/1.4 "Open Sans",sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.18);opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s;max-width:320px;';
    host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 200); }, 2200);
  };
})();
