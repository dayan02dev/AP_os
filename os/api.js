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
  const LS_KEY      = 'artpark.reviewer.evaluations.v3'; // current-cohort queue evaluations
  const HIST_LS_KEY = 'artpark.reviewer.history.v3';     // past-cohort submitted evaluations
  const nowISO = () => new Date().toISOString();

  // Past reviews shown in My History. Metadata (date / aiScore / adminDec) lives here;
  // the reviewer's reco + score come from the evaluation store so edits stay in sync.
  const HISTORY_ROWS = [
    { appId:'s01', name:'Karkhana Robotics', date:'18 Apr 2026', aiScore:8.4, myScore:7.9, reco:'yes',   adminDec:'approved' },
    { appId:'s15', name:'Mihira Diagnostics', date:'10 Apr 2026', aiScore:8.7, myScore:8.8, reco:'yes',   adminDec:'approved' },
    { appId:'s08', name:'Yantra Mobility',    date:'08 Apr 2026', aiScore:7.5, myScore:8.5, reco:'yes',   adminDec:'approved' },
    { appId:'s03', name:'GridPulse',          date:'05 Apr 2026', aiScore:7.2, myScore:5.8, reco:'maybe', adminDec:'rejected' },
    { appId:'s13', name:'Saavera Mobility',   date:'30 Mar 2026', aiScore:7.6, myScore:7.4, reco:'yes',   adminDec:'approved' },
    { appId:'s09', name:'Pravaha Water',      date:'25 Mar 2026', aiScore:7.0, myScore:7.0, reco:'yes',   adminDec:'approved' },
    { appId:'s12', name:'Lithos Materials',   date:'20 Mar 2026', aiScore:6.0, myScore:5.5, reco:'no',    adminDec:'rejected' },
  ];

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

  // ── Two separate evaluation stores ──────────────────────────────────────
  // STORE         = current-cohort queue evaluations (drives My Queue + dashboard)
  // HISTORY_STORE = past-cohort submitted evaluations (drives My History)
  // They are deliberately distinct: the same startup can be assigned in the
  // current queue AND have a past review, and editing one must not touch the
  // other. (Backend should key these by review-id; see handoff §2.4.)

  // Current cohort: s01 submitted · s02 in-progress · s03 draft (default-open) · rest not-started.
  function seedStore() {
    return {
      s01: { ...emptyEvaluation('s01'), status: 'submitted' },
      s02: { ...emptyEvaluation('s02'), status: 'in-progress' },
      s03: { ...emptyEvaluation('s03'), status: 'draft',
        scores: { problem: 6.5, solution: 5.5, tech: 6.0, founders: 5.0, commit: 6.0 },
        recommendation: 'maybe',
        notes: 'I disagree on Founders score — sole founder, no team yet. Idea is real, execution risk high.',
        flags: ['Single founder — execution risk', 'Pilot data referenced but not shared'],
      },
    };
  }

  // Past cohorts: every history row is a real submitted evaluation (scores ≈ myScore).
  function seedHistory() {
    const h = {};
    HISTORY_ROWS.forEach(r => {
      h[r.appId] = { ...emptyEvaluation(r.appId), status: 'submitted',
        scores: scoresAt(r.myScore), recommendation: r.reco, submittedAt: r.date };
    });
    return h;
  }

  function loadJSON(key) {
    try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  let STORE         = loadJSON(LS_KEY)      || seedStore();
  let HISTORY_STORE = loadJSON(HIST_LS_KEY) || seedHistory();
  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(STORE));
      localStorage.setItem(HIST_LS_KEY, JSON.stringify(HISTORY_STORE));
    } catch (e) {}
  }
  persist();

  // Pick the store for an eval context: 'history' edits go to HISTORY_STORE, else the queue STORE.
  const storeFor = (source) => (source === 'history' ? HISTORY_STORE : STORE);

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
      reviewStatus: (STORE[s.id] && STORE[s.id].status) || 'not-started',
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
      const application = { ...raw, applicationId: appIdOf(raw), detail: window.APP_DETAIL };
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
      // My History = every evaluation the reviewer has SUBMITTED:
      //   (1) current-cohort submissions from the queue store (admin decision still pending)
      //   (2) past-cohort reviews from the history store (with their admin decision)
      // Editing a past review (history store) never affects the queue; submitting a
      // current queue item surfaces it here automatically.
      const histIds = new Set(HISTORY_ROWS.map(r => r.appId));

      const currentRows = D().STARTUPS
        .filter(s => STORE[s.id] && STORE[s.id].status === 'submitted' && !histIds.has(s.id))
        .map(s => {
          const ev = STORE[s.id];
          const myScore = avgScores(ev.scores);
          const aiScore = s.ai ? s.ai.overall : 0;
          return { appId: s.id, name: s.name, date: fmtDate(ev.submittedAt),
            aiScore, myScore, variance: round1(Math.abs(myScore - aiScore)),
            reco: ev.recommendation || '—', adminDec: 'pending', source: 'queue' };
        });

      const pastRows = HISTORY_ROWS.map(r => {
        const ev = HISTORY_STORE[r.appId];
        if (ev && ev.status === 'submitted') {
          const myScore = avgScores(ev.scores);
          return { ...r, source: 'history', reco: ev.recommendation || r.reco, myScore,
            variance: round1(Math.abs(myScore - r.aiScore)) };
        }
        return { ...r, source: 'history', variance: round1(Math.abs(r.myScore - r.aiScore)) };
      });

      return {
        stats: { total: 34, consistencyPct: 92, avgVariance: 0.4, avgMinutes: 18 },
        rows: [...currentRows, ...pastRows],   // newest (current) first
      };
    },

    // Stub — backend wires real auth/session teardown here.
    signOut() {
      window.toast && window.toast('Sign out — wire to auth/session (stub)');
      console.info('[ReviewerAPI] signOut() called — stub.');
    },

    // Test/Reset helper for the demo.
    _resetEvaluations() { STORE = seedStore(); HISTORY_STORE = seedHistory(); persist(); },
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
