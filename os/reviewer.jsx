// REVIEWER PORTAL
// R-1 Queue · R-2 Evaluation form · R-3 History

const { useState: useRS } = React;
const API = window.ReviewerAPI;

// ============ Shared async UI states (loading / error / empty) ============
function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="rv-async rv-async-loading">
      <span className="rv-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
function ErrorState({ error, onRetry }) {
  return (
    <div className="rv-async rv-async-error">
      <div className="os-text-sm" style={{ color: 'var(--bad)', fontWeight: 600 }}>
        Couldn’t load this data.
      </div>
      {error && error.message && <div className="os-text-xs os-text-dim" style={{ marginTop: 4 }}>{error.message}</div>}
      {onRetry && <button className="os-btn ghost sm" style={{ marginTop: 12 }} onClick={onRetry}>Retry</button>}
    </div>
  );
}
function EmptyState({ label = 'Nothing here yet.' }) {
  return <div className="rv-async rv-async-empty os-text-dim">{label}</div>;
}

const NAV_REVIEWER = [
  { label:'Reviews', entries:[
    { id:'queue', num:'R-1', label:'My queue', badge:'5' },
    { id:'eval',  num:'R-2', label:'Active evaluation' },
    { id:'history', num:'R-3', label:'My history' },
  ]},
  { label:'Reference', entries:[
    { id:'rubric', num:'R-4', label:'Rubric · scoring.md' },
  ]},
];

// ============ LP-style Topbar ============
function ReviewerTopbar({ tab }) {
  const crumb = tab === 'dashboard' ? 'DASHBOARD'
    : tab === 'queue'   ? 'MY QUEUE'
    : tab === 'eval'    ? 'ACTIVE APPLICATION'
    : tab === 'history' ? 'MY HISTORY'
    : 'MY QUEUE';
  // Reviewer identity from the API seam (falls back to defaults while loading).
  const { data: me } = useAsync(() => API.getMe(), []);
  const initials = (me && me.initials) || 'VS';
  const email    = (me && me.email) || 'vikram@artpark.in';

  // Stubbed nav actions — backend wires real routing / auth here.
  const goHome   = () => window.toast('Home — wire to app shell / router (stub)');
  const signOut  = () => API.signOut();

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={goHome}>← HOME</button>

      <div className="lp-brand">
        <img className="lp-brand-combined" src="assets/artpark-iisc-combined.webp" alt="ARTPARK · AI & Robotics Technology Park @ IISc" />
      </div>

      <div className="lp-topbar-crumb">
        <div className="lp-topbar-pill">
          <span className="lp-live-dot"/>
          <span>REVIEWER · {crumb}</span>
        </div>
      </div>

      <div className="lp-topbar-right">
        <div className="lp-topbar-user">
          <div className="os-avatar" style={{width:28,height:28,fontSize:11,flexShrink:0,background:'#3213b7',color:'#fff'}}>{initials}</div>
          <span>{email}</span>
          <span className="caret">▾</span>
        </div>
        <button className="lp-signout" onClick={signOut}>SIGN OUT ↗</button>
      </div>
    </div>
  );
}

// ============ CSV export ============
// Pulls the queue from the API seam and triggers a browser download.
async function exportReviewerQueueCsv() {
  const STATUS_LABEL = { submitted:'Submitted', 'in-progress':'In Progress', draft:'Draft', 'not-started':'Not Started' };
  const cell = v => {
    const str = (v == null ? '' : String(v));
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };

  const queue = await API.getQueue();
  const headers = ['ID','Project','Founders','Industry','Stage','Track','AI Score','Status','Due'];
  const rows = queue.map(s => [
    s.applicationId,
    s.name,
    (s.founders || []).join('; '),
    s.industry,
    s.stage,
    s.track === 'tir' ? 'TIR' : 'VIP',
    s.ai && s.ai.overall != null ? s.ai.overall.toFixed(1) : '',
    STATUS_LABEL[s.reviewStatus] || '',
    s.due,
  ]);

  const csv = [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  // Prepend BOM (﻿) so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reviewer-queue-TIR-VIP-2026.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ Cohort page header ============
function ReviewerCohortHeader() {
  return (
    <div className="lp-page-header">
        <div className="lp-breadcrumb" style={{marginBottom:8}}>ARTPARK / OS · Reviewer Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">TIR + VIP cohort <span className="lp-year">2026</span></h1>
          <div className="lp-cohort-sub">
            applications closed 22 May 2026 · live snapshot · 28 May 2026 · 15:04 IST
          </div>
        </div>
        <div style={{marginTop:4}}>
          <button className="os-btn ghost" onClick={exportReviewerQueueCsv}>Export CSV ↓</button>
        </div>
      </div>
    </div>
  );
}

// ============ Tab bar ============
function ReviewerTabBar({ tab, setTab }) {
  // Badge reflects the actual queue size from the API (not a hardcoded number).
  const { data: queue } = useAsync(() => API.getQueue(), []);
  const queueCount = queue ? queue.length : null;
  return (
    <div className="lp-tabs">
      <div className={`lp-tab${tab === 'dashboard' ? ' active' : ''}`} onClick={() => setTab('dashboard')}>
        <div className="lp-tab-label">Dashboard</div>
        <div className="lp-tab-sub">OVERVIEW · CHARTS · FUNNEL</div>
      </div>
      <div className={`lp-tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
        <div className="lp-tab-label">
          My Queue
          {queueCount != null && <span className="lp-tab-badge">{queueCount}</span>}
        </div>
        <div className="lp-tab-sub">ASSIGNED STARTUPS</div>
      </div>
      <div className={`lp-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
        <div className="lp-tab-label">My History</div>
        <div className="lp-tab-sub">PAST REVIEWS</div>
      </div>
    </div>
  );
}

// ============ Dashboard ============
function ReviewerDashboard({ onPickIndustry }) {
  // Connected to the SAME applications shown in My Queue (via the API seam)
  const { data: queue, loading, error, reload } = useAsync(() => API.getQueue(), []);
  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error)   return <ErrorState error={error} onRetry={reload} />;
  if (!queue || !queue.length) return <EmptyState label="No applications assigned." />;

  const n      = queue.length;
  const withAI = queue.filter(s => s.ai && s.ai.overall != null);
  const avgAI  = withAI.length ? withAI.reduce((a, s) => a + s.ai.overall, 0) / withAI.length : 0;

  // TIR / SIP split (from the queue)
  const tirN = queue.filter(s => s.track === 'tir').length;
  const sipN = queue.filter(s => s.track === 'sip').length;

  // Reviewer-side status counts (submitted / in-progress / draft / not-started)
  const cnt = { 'submitted': 0, 'in-progress': 0, 'draft': 0, 'not-started': 0 };
  queue.forEach(s => { cnt[s.reviewStatus]++; });

  const STATUS_ROWS = [
    { key:'not-started', name:'NOT STARTED', sub:'awaiting your review' },
    { key:'draft',       name:'DRAFT',       sub:'saved · not submitted' },
    { key:'in-progress', name:'IN PROGRESS', sub:'scoring underway' },
    { key:'submitted',   name:'SUBMITTED',   sub:'evaluation sent' },
  ].map(r => ({ ...r, count: cnt[r.key] }));
  const maxStatus = Math.max(...STATUS_ROWS.map(r => r.count), 1);

  // AI histogram  (bins 0-1 … 9-10)
  const BINS = ['0-1','1-2','2-3','3-4','4-5','5-6','6-7','7-8','8-9','9-10'];
  const binCounts = BINS.map((_, i) =>
    withAI.filter(s => s.ai.overall >= i && s.ai.overall < i + 1).length
  );
  const maxBin = Math.max(...binCounts, 1);

  // AI components
  const COMPS = [
    { label:'Problem',    key:'problem',   weight:22 },
    { label:'Solution',   key:'solution',  weight:30 },
    { label:'Tech',       key:'tech',      weight:22 },
    { label:'Founders',   key:'founders',  weight:14 },
    { label:'Commitment', key:'commit',    weight:12 },
  ];
  const compAvgs = COMPS.map(c => ({
    ...c,
    avg: withAI.length ? withAI.reduce((a, s) => a + (s.ai[c.key] || 0), 0) / withAI.length : 0,
  }));

  // Median AI score
  const sorted   = [...withAI].map(s => s.ai.overall).sort((a, b) => a - b);
  const medianAI = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Industry (from the queue)
  const domainMap = {};
  queue.forEach(s => { domainMap[s.domain] = (domainMap[s.domain] || 0) + 1; });
  const domainRows = Object.entries(domainMap).sort((a, b) => b[1] - a[1]);
  const maxDomain  = domainRows.length ? domainRows[0][1] : 1;

  return (
    <div className="dash-scroll">

      {/* ── Stat tiles ─────────────────────────────────────────── */}
      <div className="dash-stat-grid">
        <div className="dash-stat-tile">
          <div className="dash-stat-label">APPLICATIONS ASSIGNED</div>
          <div className="dash-stat-num">{n}</div>
          <div className="dash-stat-sub">in your queue</div>
          <div className="dash-track-bars">
            {[['TIR', tirN, '#3213b7'], ['VIP', sipN, '#ff5a5f']].map(([label, count, color]) => (
              <div key={label} className="dash-track-row">
                <span className="dash-track-label">{label}</span>
                <div className="dash-track-bar-wrap">
                  <div className="dash-track-bar-fill" style={{width:(count/n*100)+'%', background:color}}/>
                </div>
                <span className="dash-track-count">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">SUBMITTED</div>
          <div className="dash-stat-num">{cnt['submitted']}</div>
          <div className="dash-stat-sub">evaluation sent</div>
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">IN PROGRESS</div>
          <div className="dash-stat-num">{cnt['in-progress'] + cnt['draft']}</div>
          <div className="dash-stat-sub">draft + scoring</div>
        </div>

        <div className="dash-stat-tile">
          <div className="dash-stat-label">NOT STARTED</div>
          <div className="dash-stat-num">{cnt['not-started']}</div>
          <div className="dash-stat-sub">awaiting review</div>
        </div>

        <div className="dash-stat-tile dash-tile-teal">
          <div className="dash-stat-label">AVERAGE AI SCORE</div>
          <div className="dash-stat-num">{avgAI.toFixed(1)}</div>
          <div className="dash-stat-sub">across {withAI.length} apps</div>
        </div>
      </div>

      {/* ── Queue pipeline (reviewer statuses) ─────────────────── */}
      <div className="dash-card">
        <div className="dash-section-tag">§ Queue pipeline</div>
        <div className="dash-card-title">Your queue, by status</div>
        <div className="dash-pipe">
          {STATUS_ROWS.map((r, i) => {
            const pct = Math.round((r.count / maxStatus) * 90);
            return (
              <React.Fragment key={r.key}>
                <div className="dash-pipe-row">
                  <div className="dash-pipe-track">
                    <div className="dash-pipe-fill" style={{width: pct + '%'}}/>
                    <span className="dash-pipe-count">{r.count}</span>
                  </div>
                  <div className="dash-pipe-info">
                    <span className="dash-pipe-name">{r.name}</span>
                    <span className="dash-pipe-sub">{r.sub}</span>
                  </div>
                </div>
                {i < STATUS_ROWS.length - 1 && (
                  <div className="dash-pipe-arrow"><span className="a-track">↓</span><span className="a-spacer"/></div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── AI distribution + components ───────────────────────── */}
      <div className="dash-2col">
        <div className="dash-card">
          <div className="dash-section-tag">§ AI score distribution</div>
          <div className="dash-card-title">Across {withAI.length} applications</div>
          <div className="dash-histogram">
            {binCounts.map((c, i) => (
              <div key={i} className="dash-hist-col">
                <div className="dash-hist-bar-wrap">
                  <div className="dash-hist-bar" style={{height: (c / maxBin * 100) + '%'}}/>
                </div>
                <div className="dash-hist-count">{c}</div>
                <div className="dash-hist-label">{BINS[i]}</div>
              </div>
            ))}
          </div>
          <div className="dash-hist-stats">
            MEAN {avgAI.toFixed(1)} · MEDIAN {medianAI.toFixed(1)} · N = {withAI.length}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-section-tag">§ AI score · components</div>
          <div className="dash-card-title">What the score is made of</div>
          <div className="dash-comp-desc">Five weighted signals scored 0–10. Overall score is a weighted mean.</div>
          <div className="dash-comp-list">
            {compAvgs.map(c => (
              <div key={c.key} className="dash-comp-row">
                <div className="dash-comp-meta">
                  <span className="dash-comp-name">{c.label}</span>
                  <span className="dash-comp-weight">weight {c.weight}%</span>
                  <span className="dash-comp-val">{c.avg.toFixed(1)}<span style={{opacity:0.4,fontSize:10}}>/10</span></span>
                </div>
                <div className="dash-comp-bar-wrap">
                  <div className="dash-comp-bar-fill" style={{width:(c.avg/10*100)+'%'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Industry breakdown ─────────────────────────────────── */}
      <div className="dash-card" style={{marginBottom:0}}>
        <div className="dash-section-tag">§ Queue by industry</div>
        <div className="dash-card-title">Where your queue is concentrated</div>
        <div className="dash-comp-desc">Click an industry to jump into My Queue pre-filtered.</div>
        <div className="dash-ind-list">
          {domainRows.map(([domain, count]) => (
            <div key={domain} className="dash-ind-row dash-ind-row--clickable"
              onClick={() => onPickIndustry && onPickIndustry(domain)}
              title={'Filter My Queue by ' + domain}>
              <div className="dash-ind-name">{domain}</div>
              <div className="dash-ind-bar-wrap">
                <div className="dash-ind-bar-fill" style={{width:(count/maxDomain*100)+'%'}}/>
              </div>
              <div className="dash-ind-count">{count}</div>
              <div className="dash-ind-pct">· {(count/n*100).toFixed(1)}%</div>
            </div>
          ))}
        </div>

        {/* Filter chips — jump straight into a pre-filtered queue (leadership parity) */}
        <div className="dash-ind-filter">
          <span className="lp-filter-label">FILTER</span>
          <div className="lp-filter-btns">
            <button className="lp-filter-btn active" onClick={() => onPickIndustry && onPickIndustry('all')}>All</button>
            {domainRows.map(([domain]) => (
              <button key={domain} className="lp-filter-btn" onClick={() => onPickIndustry && onPickIndustry(domain)}>{domain}</button>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// NOTE: the reviewer queue (canonical record, per-app industry/stage/track/status)
// now lives in os/api.js → ReviewerAPI.getQueue(). Components fetch it via useAsync.
// Filter options (industry / stage / status) + counts are derived from that queue
// inside ReviewerQueue, so the chips always match what the table actually shows.

// ============ R-1 Queue ============
function ReviewerQueue({ go, initialDomain = 'all' }) {
  const [search,       setSearch]       = useRS('');
  const [track,        setTrack]        = useRS('all');
  const [statusFilter, setStatusFilter] = useRS('all');
  const [stageFilter,  setStageFilter]  = useRS('all');
  const [domainFilter, setDomainFilter] = useRS(initialDomain);

  const { data, loading, error, reload } = useAsync(() => API.getQueue(), []);
  const allQueue = data || [];

  const getStatus = s => s.reviewStatus;

  const filtered = allQueue.filter(s => {
    if (track !== 'all' && s.track !== track) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) &&
          !s.founders[0].toLowerCase().includes(q) &&
          !s.domain.toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== 'all' && getStatus(s) !== statusFilter) return false;
    if (stageFilter  !== 'all' && s.stage !== stageFilter) return false;
    if (domainFilter !== 'all' && s.domain !== domainFilter) return false;
    return true;
  });

  const STATUS_DOTS   = { submitted: 'var(--ok)', 'in-progress': 'var(--info)', draft: 'var(--warn)', 'not-started': 'var(--ink-dim)' };
  const STATUS_LABELS = { submitted: 'Submitted', 'in-progress': 'In Progress', draft: 'Draft', 'not-started': 'Not Started' };

  // Filter options + counts derived from the ACTUAL queue (not cohort-wide).
  const countBy = (key) => {
    const m = {};
    allQueue.forEach(s => { m[s[key]] = (m[s[key]] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const industryRows = countBy('domain');
  const stageRows    = countBy('stage');
  const statusCounts = allQueue.reduce((m, s) => { m[s.reviewStatus] = (m[s.reviewStatus] || 0) + 1; return m; }, {});

  const hasFilters = search || track !== 'all' || statusFilter !== 'all' || stageFilter !== 'all' || domainFilter !== 'all';
  const clearAll   = () => { setSearch(''); setTrack('all'); setStatusFilter('all'); setStageFilter('all'); setDomainFilter('all'); };

  return (
    <div>
      {/* ── Filter area ── */}
      <div className="lp-filter-area">

        {/* Search + track row */}
        <div className="lp-filter-row--search">
          <div className="os-search-wrap" style={{flexShrink:0}}>
            <input
              className="os-input search"
              placeholder="Search by name, email, or org"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="lp-track-group">
            {[['all','All tracks'],['tir','TIR'],['sip','VIP']].map(([v, label]) => (
              <button
                key={v}
                className={`lp-track-btn${track === v ? ' active' : ''}`}
                onClick={() => setTrack(v)}
              >{label}</button>
            ))}
          </div>
          <div style={{flex:1}}/>
          {hasFilters && (
            <button className="lp-filter-btn lp-clear-btn" onClick={clearAll}>Clear filters</button>
          )}
          <span className="lp-count">{filtered.length} of {allQueue.length}</span>
        </div>

        {/* STATUS */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">STATUS</span>
          <div className="lp-filter-btns">
            <button className={`lp-filter-btn${statusFilter === 'all' ? ' active' : ''}`} onClick={() => setStatusFilter('all')}>All</button>
            {['submitted','in-progress','draft','not-started'].map(st => (
              <button
                key={st}
                className={`lp-filter-btn${statusFilter === st ? ' active' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                <span className="sdot" style={{background: statusFilter === st ? 'rgba(255,255,255,0.8)' : STATUS_DOTS[st]}}/>
                {STATUS_LABELS[st]}
                <span style={{opacity:0.55, fontSize:11, marginLeft:2}}>{statusCounts[st] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* STAGE */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">STAGE</span>
          <div className="lp-filter-btns">
            <button className={`lp-filter-btn${stageFilter === 'all' ? ' active' : ''}`} onClick={() => setStageFilter('all')}>All</button>
            {stageRows.map(([st, count]) => (
              <button
                key={st}
                className={`lp-filter-btn${stageFilter === st ? ' active' : ''}`}
                onClick={() => setStageFilter(st)}
              >
                {st}
                <span style={{opacity:0.55, fontSize:11, marginLeft:2}}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* INDUSTRY */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">INDUSTRY</span>
          <div className="lp-filter-btns">
            <button className={`lp-filter-btn${domainFilter === 'all' ? ' active' : ''}`} onClick={() => setDomainFilter('all')}>All</button>
            {industryRows.map(([d, count]) => (
              <button
                key={d}
                className={`lp-filter-btn${domainFilter === d ? ' active' : ''}`}
                onClick={() => setDomainFilter(d)}
              >
                {d}
                <span style={{opacity:0.55, fontSize:11, marginLeft:2}}>{count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="lp-content" style={{paddingBottom:80}}>
        <table className="os-table">
          <thead>
            <tr>
              <th style={{width:'22%'}}>Project</th>
              <th style={{width:'16%'}}>Founder</th>
              <th style={{width:'18%'}}>Industry</th>
              <th style={{width:'10%'}}>Stage</th>
              <th style={{width:'12%'}}>AI Score</th>
              <th style={{width:'12%'}}>Status</th>
              <th style={{width:'6%'}}>Due</th>
              <th style={{width:'9%'}}>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{cursor:'pointer'}} onClick={() => go(allQueue.findIndex(q => q.id === s.id))}>
                <td>
                  <div style={{fontWeight:600,color:'var(--ink)',fontSize:13,lineHeight:1.3}}>{s.name}</div>
                  <div style={{fontSize:11,color:'var(--ink-dim)',marginTop:3,fontFamily:'var(--font-code)'}}>
                    {s.applicationId} · {s.track === 'tir' ? 'TIR' : 'VIP'}
                  </div>
                </td>
                <td>
                  <div style={{fontSize:13,color:'var(--ink)',fontWeight:500}}>{s.founders[0]}</div>
                  {s.founders[1] && <div style={{fontSize:11,color:'var(--ink-dim)',marginTop:2}}>{s.founders[1]}</div>}
                </td>
                <td style={{color:'var(--ink-soft)',fontSize:13}}>{s.domain}</td>
                <td style={{color:'var(--ink-soft)',fontSize:13}}>{s.stage}</td>
                <td>
                  {s.ai && s.ai.overall ? (
                    <div className="lp-score-bar">
                      <div className="lp-score-bar-track">
                        <div className="lp-score-bar-fill" style={{width:(s.ai.overall/10*100)+'%'}}/>
                      </div>
                      <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:'var(--ink)'}}>{s.ai.overall.toFixed(1)}</span>
                    </div>
                  ) : <span style={{color:'var(--ink-dim)'}}>—</span>}
                </td>
                <td>
                  {s.reviewStatus === 'submitted'   && <Chip tone="green">Submitted</Chip>}
                  {s.reviewStatus === 'in-progress' && <Chip tone="blue">In Progress</Chip>}
                  {s.reviewStatus === 'draft'       && <Chip tone="amber">Draft</Chip>}
                  {s.reviewStatus === 'not-started' && <Chip tone="slate">Not started</Chip>}
                </td>
                <td style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--ink-soft)'}}>{s.due}</td>
                <td style={{fontFamily:'var(--font-code)',fontSize:11,color:'var(--ink-dim)'}}>
                  {s.applicationId}
                </td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan="8" style={{padding:'40px 0'}}><LoadingState label="Loading your queue…" /></td></tr>
            )}
            {!loading && error && (
              <tr><td colSpan="8" style={{padding:'40px 0'}}><ErrorState error={error} onRetry={reload} /></td></tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan="8" style={{textAlign:'center',padding:'48px 0',color:'var(--ink-dim)',fontSize:13}}>
                  {allQueue.length === 0 ? 'No applications assigned.' : 'No startups match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Structured application content (AI summary + Problem & solution)
const APP_DETAIL = {
  aiSummary: "Evaldam AI addresses the critical pain point of startup valuation and financial decision-making in India, which is currently slow, expensive, inaccurate, and often non-compliant with local regulations. The platform leverages a fine-tuned LLM, proprietary blended valuation methodology, and a curated dataset of Indian comparables to deliver rapid, cost-effective, and regulation-aware valuations. This solution promises a 10x improvement in speed, cost, and compliance, offering a significant advantage over existing global tools and traditional consultants by deeply integrating Indian regulatory knowledge and market realities into its core AI reasoning.",
  fields: [
    { label: 'Problem defined', value: 'Yes', short: true },
    { label: 'Problem describe', value: "Indian startups face a critical, systemic friction during fundraising: inaccurate, slow, expensive, and frequently non-compliant valuation and financial decision-making. Founders either pay ₹50,000–₹2,00,000+ to consultants for reports that are often generic and poorly understood, or they use global tools (like Equidam) that ignore Indian regulatory realities (FEMA pricing floors, Rule 11UA, IBBI certification requirements, CCPS/CCD structures). This leads to excessive founder dilution, failed or delayed rounds, poor capital allocation, and loss of equity. The problem affects thousands of early-stage startups annually, with significant economic and psychological cost to founders and the broader Indian startup ecosystem. Now is the right time because large language models have reached sufficient maturity in structured financial reasoning, and India is experiencing a surge in early-stage activity that desperately needs localized, AI-augmented financial intelligence. Solving this directly contributes to more efficient capital allocation, stronger founder outcomes, and increased global competitiveness of Indian startups." },
    { label: 'Solution stage', value: 'Pilot-ready product', short: true },
    { label: 'Solution describe', value: "Evaldam AI is an AI-powered platform that delivers fast, regulation-aware, transparent, and defensible startup valuations and financial intelligence specifically tuned for the Indian ecosystem. It represents a 10× improvement over existing solutions in three dimensions: • Speed: Reduces valuation report generation from days/weeks to seconds/minutes. • Cost: Dramatically lowers the cost compared to traditional consultants while maintaining or improving quality. • Accuracy & Compliance: Produces outputs that respect Indian regulatory requirements (FEMA, Rule 11UA, IBBI standards) and provides full transparency with assumptions, methodology, and comparables — something generic global tools and many consultants fail to deliver. The platform combines a fine-tuned domain-specific LLM with a proprietary blended valuation methodology (Scorecard + Berkus + VC Method + DCF with India-adjusted inputs) and a growing structured dataset of Indian startup comparables and regulatory rules." },
    { label: 'Solution core tech', value: "The core technology is a fine-tuned Large Language Model specialized on Indian startup finance and regulatory reasoning, combined with a proprietary blended valuation engine and a structured, growing dataset of Indian comparables and regulatory logic. Our \"unfair advantage\" comes from three elements that are difficult to replicate quickly: 1. Deep integration of Indian regulatory knowledge (FEMA pricing guidelines, Rule 11UA/57, IBBI standards, CCPS/CCD mechanics) directly into the AI reasoning layer — global models fundamentally lack this. 2. A proprietary blended methodology that automatically adjusts weighting based on stage, data quality, and Indian market realities. 3. A curated and expanding dataset of Indian startup comparables, outcomes, and regulatory interpretations that improves with usage. This combination creates both a data moat and a regulatory moat that generic AI models or traditional tools cannot easily match." },
    { label: 'Solution contrarian insight', value: "Most people in the startup valuation space treat valuation as either a pure financial modeling exercise or a regulatory compliance checkbox. The rare insight is that in the Indian context, valuation is actually a strategic negotiation and capital allocation tool that sits at the intersection of regulation, psychology, and asymmetric information. Because of FEMA pricing floors and the requirement for professional certification, the valuation number itself becomes a legal anchor that heavily influences founder dilution and investor economics — often more than the underlying business fundamentals in early stages. Founders who understand this dynamic and can generate defensible, regulation-aware valuations quickly gain a significant edge in term sheet negotiations. Most tools and advisors miss this strategic layer entirely." },
  ],
};
// Expose to the API seam (so getEvalScreen can serve per-application content).
window.APP_DETAIL = APP_DETAIL;

// ============ Full application view (founder form style) ============
function FullApplicationView({ s, onBack }) {
  const PURPLE = '#3213b7';
  const f = APP_DETAIL.fields;
  const email = (s.founders[0] || 'founder').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
    + '@' + (s.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '') + '.in';

  const SECTIONS = [
    {
      num: '01', title: 'Basic details', blurb: 'Who is applying, and how to reach them.',
      questions: [
        { prompt: "What's your full name?", help: "As you'd like it to appear on the application.", required: true, answer: s.founders[0] },
        { prompt: 'A phone number we can reach you on?', help: "We'll use this for interview scheduling only.", required: true, answer: '+91 98765 43210' },
        { prompt: 'And your email?', help: 'This will be your login anchor and primary channel.', required: true, answer: email },
        { prompt: 'Where are you right now?', help: "Current organization, institution, or 'Independent'.", required: true, answer: s.name },
        { prompt: 'Highest technology degree achieved?', help: 'Self-taught engineers with shipped work get equivalent weight.', required: true, choice: true, answer: "Master's Degree" },
      ],
    },
    {
      num: '02', title: 'Problem & importance', blurb: "The thing that pulled you in. What won't let you go.",
      questions: [
        { prompt: 'What specific critical problem in your chosen sector are you solving?', help: 'Who is feeling the pain? Can you quantify it — market size, urgency, human cost? Why is now the right time?', required: true, answer: f[1].value },
        { prompt: 'Do you think the problem you want to solve is well-defined?', help: 'Honest answers help us support you better — either response is fine.', required: true, choice: true, answer: f[0].value },
      ],
    },
    {
      num: '03', title: 'Your solution', blurb: "How you're approaching it, and what makes your angle defensible.",
      questions: [
        { prompt: 'Describe your solution. Does it represent a 10× improvement over existing state-of-the-art — rather than an incremental gain?', help: 'The bigger the impact, the more excited we are.', required: true, answer: f[3].value },
        { prompt: "What's the core technology that makes this special and hard to replicate?", help: 'What is the lab-proven research or cutting-edge advance, and what is the "unfair advantage"?', required: true, answer: f[4].value },
        { prompt: 'What do you believe about your field that most experts disagree with?', help: "Share a contrarian belief or a genuinely rare insight most experts don't think about.", optional: true, answer: f[5].value },
      ],
    },
    {
      num: '04', title: 'Execution plan', blurb: "What's your roadmap?",
      questions: [
        { prompt: 'How far along are you?', help: 'No wrong answer — this just helps us help you better.', required: true, choice: true, answer: f[2].value },
        { prompt: 'What are the most critical milestones you aim to achieve during this residency?', help: 'One or two sharp outcomes beat a vague roadmap.', required: true, answer: 'Q1: Close 10 paid design partners across Indian VCs, accelerators and CA firms. Q2: Ship the self-serve valuation API with FEMA / Rule 11UA compliance checks built in. Q3: Reach ₹1Cr ARR with 500+ defensible valuations delivered and an IBBI-aligned audit trail for each report.' },
      ],
    },
    {
      num: '05', title: 'Evidence', blurb: "Show, don't just tell.",
      questions: [
        { prompt: 'Upload your latest pitch deck.', help: "PDF, max 25MB. The version you'd send a serious investor today.", required: true, file: true, answer: 'pitch-evaldam-ai.pdf · 14 pages · 6.2 MB' },
        { prompt: 'A demo video of your product (under 3 minutes).', help: 'Loom, YouTube or Drive link. Optional but strongly encouraged.', optional: true, answer: 'https://www.loom.com/share/evaldam-ai-demo' },
      ],
    },
    {
      num: '06', title: 'Declaration', blurb: 'Last step. Just a few confirmations.',
      decl: [
        "I confirm the information I've submitted is true and relevant to the questions asked.",
        'I consent to reference checks.',
        'I agree to the program terms and data policy.',
        "I'd like to receive newsletters and future communication from ARTPARK.",
      ],
    },
  ];

  const eyebrowMono = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.18em' };
  const pill = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', fontWeight: 600, color: PURPLE, border: '1px solid #ccc2f0', background: '#ece9fb', padding: '4px 11px', borderRadius: 999 };
  const pillGhost = { ...pill, color: 'var(--ink-dim)', border: '1px solid var(--line)', background: 'transparent' };
  const answerBox = { background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '18px 22px', fontSize: 16, lineHeight: 1.62, color: 'var(--ink)' };

  return (
    <div style={{ maxWidth: 840, margin: '0 auto' }}>
      <div className="os-row between" style={{ marginBottom: 32 }}>
        <button className="os-btn ghost sm" onClick={onBack}>← Back to review</button>
        <span className="os-text-dim os-uppercase" style={{ ...eyebrowMono }}>{s.name} · full application</span>
      </div>

      {SECTIONS.map((sec, si) => (
        <div key={si} style={{ marginBottom: 56 }}>
          <div className="os-row between" style={{ marginBottom: 18 }}>
            <span style={eyebrowMono}>
              <span style={{ background: '#aafcf0', color: '#3213b7', padding: '2px 7px', fontWeight: 700 }}>SECTION</span>
              <span className="os-text-dim" style={{ marginLeft: 8 }}>{sec.num}</span>
            </span>
            <span className="os-text-dim" style={eyebrowMono}>OF 06</span>
          </div>

          <div style={{ fontSize: 72, fontWeight: 800, color: PURPLE, lineHeight: 1, fontFamily: 'var(--font-display)' }}>{sec.num}</div>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '10px 0 0', letterSpacing: '-0.02em', color: 'var(--ink)' }}>{sec.title}</h2>
          <p className="os-text-soft" style={{ fontSize: 16, marginTop: 10 }}>{sec.blurb}</p>

          {sec.decl ? (
            <div style={{ ...answerBox, marginTop: 28 }}>
              <div className="os-stack gap-sm">
                {sec.decl.map((d, di) => (
                  <div key={di} className="os-row gap-sm" style={{ alignItems: 'flex-start' }}>
                    <span className="os-chip green" style={{ flexShrink: 0 }}>✓ AGREED</span>
                    <span className="os-text-soft" style={{ fontSize: 14.5, lineHeight: 1.5 }}>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 24 }}>
              {sec.questions.map((q, qi) => (
                <div key={qi} style={{ borderTop: '1px solid var(--line)', padding: '28px 0' }}>
                  <div className="os-row between" style={{ marginBottom: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: PURPLE }}>{String(qi + 1).padStart(2, '0')} →</span>
                    {q.required && <span style={pill}>REQUIRED</span>}
                    {q.optional && <span style={pillGhost}>OPTIONAL</span>}
                  </div>
                  <h3 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.3, color: 'var(--ink)' }}>{q.prompt}</h3>
                  {q.help && <p className="os-text-soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>{q.help}</p>}
                  <div style={{ marginTop: 16 }}>
                    {q.file ? (
                      <div style={{ ...answerBox, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <span className="os-mono" style={{ fontSize: 14 }}>{q.answer}</span>
                        <span className="os-chip green" style={{ flexShrink: 0 }}>UPLOADED</span>
                      </div>
                    ) : q.choice ? (
                      <div style={{ ...answerBox, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ color: PURPLE, fontWeight: 700 }}>●</span>
                        <span style={{ fontWeight: 600 }}>{q.answer}</span>
                      </div>
                    ) : (
                      <div style={answerBox}>{q.answer}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 28, marginBottom: 48 }}>
        <button className="os-btn" onClick={onBack}>← Back to review</button>
      </div>
    </div>
  );
}

// ============ R-2 Active Evaluation ============
// Display labels for the six scoring criteria
const CRIT_LABELS = {
  problem:   'Problem Statement Impact and Importance',
  solution:  'Completeness, Depth of Solution',
  tech:      'Technical Depth',
  founders:  'Professional Profile of Founder',
  commit:    'Commitment to be fully available',
};
// Loader — fetches the application + the reviewer's draft, then renders the form.
function ReviewerEval({ idx = 2, source = 'queue', onBack, onPrev, onNext }) {
  const { data, loading, error, reload } = useAsync(() => API.getEvalScreen(idx, source), [idx, source]);
  if (loading) return <div style={{ padding: '48px 0' }}><LoadingState label="Loading application…" /></div>;
  if (error)   return <div style={{ padding: '48px 0' }}><ErrorState error={error} onRetry={reload} /></div>;
  // key remounts the form per application → clean, isolated state per app.
  return <ReviewerEvalForm key={data.application.id + ':' + source} application={data.application}
    evaluation={data.evaluation} source={source} onBack={onBack} onPrev={onPrev} onNext={onNext} />;
}

function ReviewerEvalForm({ application, evaluation, source = 'queue', onBack, onPrev, onNext }) {
  const s = application;
  const appId = application.id;
  const MAX_FLAGS = 8;

  // Editable evaluation state — initialised from the loaded draft (per-app).
  const [scores, setScores]       = useRS(evaluation.scores);
  const [reco, setReco]           = useRS(evaluation.recommendation || null);
  const [notes, setNotes]         = useRS(evaluation.notes || '');
  const [disagree, setDisagree]   = useRS(evaluation.disagreements || {}); // { key: reasonString }
  const [flags, setFlags]         = useRS(evaluation.flags || []);
  const [submitted, setSubmitted] = useRS(evaluation.status === 'submitted');
  const [reopened, setReopened]   = useRS(false); // amend a submitted evaluation

  // Local UI-only state (not persisted).
  const [showRubric, setShowRubric] = useRS(false);
  const [showAi, setShowAi]       = useRS(false);
  const [timeLeft, setTimeLeft]   = useRS(3240); // 54 min — see backend handoff §4.5
  const [activeCat, setActiveCat] = useRS('founders');
  const [psOpen, setPsOpen]       = useRS(true);
  const [viewApp, setViewApp]     = useRS(false);
  const [flagInput, setFlagInput] = useRS('');
  const [saveState, setSaveState] = useRS('idle'); // idle | saving | saved

  const addFlag = () => {
    const t = flagInput.trim();
    if (!t || flags.length >= MAX_FLAGS) return;
    setFlags(prev => [...prev, t]);
    setFlagInput('');
  };
  const removeFlag = (i) => setFlags(prev => prev.filter((_, j) => j !== i));

  const toggleDisagree = (k, on) => setDisagree(prev => {
    const next = { ...prev };
    if (on) next[k] = next[k] || '';
    else delete next[k];
    return next;
  });
  const setDisagreeReason = (k, v) => setDisagree(prev => ({ ...prev, [k]: v }));

  const setScore = (k) => (v) => setScores(prev => ({ ...prev, [k]: v }));
  const overall = (Object.values(scores).reduce((a,b) => a+b, 0) / Object.values(scores).length);

  // Evaluation payload sent to the API seam.
  const payload = () => ({ scores, recommendation: reco, notes, disagreements: disagree, flags });

  // Edit-window countdown.
  React.useEffect(() => {
    const timer = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  // A submitted evaluation is locked until the reviewer explicitly re-opens it.
  const lockedSubmitted = submitted && !reopened;
  const editable = !lockedSubmitted && timeLeft !== 0;

  // Autosave (debounced) — skips the initial load; only runs while editable.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!editable) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      API.saveEvaluation(appId, payload(), source).then(() => setSaveState('saved'));
    }, 800);
    return () => clearTimeout(t);
  }, [scores, reco, notes, disagree, flags]);

  const saveDraftNow = () => {
    setSaveState('saving');
    API.saveEvaluation(appId, payload(), source).then(() => { setSaveState('saved'); window.toast('Draft saved'); });
  };
  const submitEval = () => {
    const wasAmend = submitted && reopened;
    API.submitEvaluation(appId, payload(), source).then(() => {
      setSubmitted(true); setReopened(false);
      window.toast(wasAmend ? 'Evaluation updated ✓' : 'Evaluation submitted ✓');
    });
  };
  const reopenForEdit = () => { setReopened(true); window.toast('Evaluation re-opened — make changes and re-submit'); };

  if (viewApp) {
    return <FullApplicationView s={s} onBack={() => setViewApp(false)} />;
  }

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ color: '#4a4a52', textDecoration: 'none' }}>{source === 'history' ? 'My history' : 'My queue'}</a>
            <span style={{ margin: '0 8px', color: '#c8c8d0' }}>/</span>
            <span style={{ color: '#8a8a92' }}>{s.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>R-2 · ACTIVE EVALUATION</span>
          <h2 className="lp-section-title">{s.name} <span className="lp-muted">· scoring</span></h2>
          <div className="lp-section-sub">Read the application, then score each dimension 0–10. Notes are optional but recommended for variance &gt;1.0.</div>
        </div>
        <div className="lp-section-actions">
          {/* Top line — navigate between applications in the queue */}
          <div className="os-row gap-sm">
            <button className="os-btn ghost sm" onClick={onPrev}>← Prev application</button>
            <button className="os-btn ghost sm" onClick={onNext}>Next application →</button>
          </div>
          {/* Bottom line — actions for the current application */}
          <div className="os-row gap-sm" style={{ alignItems: 'center' }}>
            <button className="os-btn secondary" onClick={onBack}>↩ My queue</button>
            {editable && saveState !== 'idle' && (
              <span className="saved" style={{ opacity: saveState === 'saving' ? 0.5 : 1 }}>
                {saveState === 'saving' ? 'Saving…' : '✓ Saved'}
              </span>
            )}
            <div className={"lp-edit-chip " + (timeLeft < 600 ? 'red' : 'amber')}>
              <span className="lp-edit-dot"/>
              Edit window: {Math.floor(timeLeft/60)} min remaining
            </div>
            {lockedSubmitted ? (
              <>
                <Chip tone="green">Submitted ✓</Chip>
                <button className="os-btn" disabled={timeLeft === 0} onClick={reopenForEdit}>Re-open to edit</button>
              </>
            ) : (
              <>
                <button className="os-btn ghost" disabled={timeLeft === 0} onClick={saveDraftNow}>Save draft</button>
                <button
                  className="os-btn"
                  disabled={timeLeft === 0}
                  onClick={submitEval}
                >{submitted ? 'Re-submit evaluation →' : 'Submit evaluation →'}</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        {/* LEFT — application */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Application · {s.name}</div>
              <div className="os-row gap-sm">
                <Chip>{s.domain}</Chip><Chip>{s.stage}</Chip><Chip>TRL {s.trl}</Chip>
              </div>
            </div>
            <div className="os-stack">
              {/* AI summary */}
              <div>
                <div className="os-text-xs os-text-dim os-uppercase os-mb-sm">AI summary</div>
                <p style={{ fontFamily:'var(--font-sans)', fontSize: 15, lineHeight: 1.7, margin: 0, color:'var(--ink-soft)' }}>
                  {s.detail.aiSummary}
                </p>
              </div>

              <hr className="os-divider"/>

              {/* Problem & solution (collapsible) */}
              <div>
                <div
                  className="os-row gap-sm"
                  style={{ cursor:'pointer', alignItems:'center', userSelect:'none' }}
                  onClick={() => setPsOpen(o => !o)}
                >
                  <span style={{ fontSize: 13, transition:'transform .15s', display:'inline-block', transform: psOpen ? 'none' : 'rotate(-90deg)' }}>▾</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Problem &amp; solution</span>
                </div>

                {psOpen && (
                  <div className="os-stack" style={{ marginTop: 14 }}>
                    {s.detail.fields.map((f, i) => (
                      <div key={i}>
                        <div className="os-text-xs os-text-dim os-uppercase os-mb-sm">{f.label}</div>
                        {f.short
                          ? <div style={{ fontSize: 14, fontWeight: 600, color:'var(--ink)' }}>{f.value}</div>
                          : <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color:'var(--ink-soft)' }}>{f.value}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <hr className="os-divider"/>

              <button className="os-btn secondary os-w-100" onClick={() => setViewApp(true)}>
                View full application →
              </button>
            </div>
          </div>

          <div className="os-card soft">
            <div className="os-row between os-mb-sm">
              <div className="os-card-title">AI baseline (for reference only)</div>
              <button className={"os-btn sm " + (showAi ? 'ghost' : 'highlight')} onClick={() => setShowAi(!showAi)}>{showAi ? 'Hide AI Scores' : 'Show AI Scores'}</button>
            </div>
            {showAi ? (
              <div className="os-row gap-lg">
                <div className="os-num-big" style={{ fontSize: 36, fontFamily:'var(--font-sans)', fontWeight: 800, letterSpacing:'-0.02em', color:'#242424' }}>{s.ai.overall.toFixed(1)}</div>
                <div style={{ flex: 1 }}>
                  <ScoreBar label={CRIT_LABELS.problem} kind="problem" value={s.ai.problem}/>
                  <ScoreBar label={CRIT_LABELS.solution} kind="solution" value={s.ai.solution}/>
                  <ScoreBar label={CRIT_LABELS.tech} kind="tech" value={s.ai.tech}/>
                  <ScoreBar label={CRIT_LABELS.founders} kind="founders" value={s.ai.founders}/>
                  <ScoreBar label={CRIT_LABELS.commit} kind="commit" value={s.ai.commit}/>
                </div>
              </div>
            ) : (
              <div className="os-text-sm os-text-dim">AI scores are hidden. Click "Show AI Scores" to reveal them.</div>
            )}
            <div className="os-text-xs os-text-dim os-mt-sm">AI is a baseline. Score independently — variance is expected and welcome.</div>
          </div>
        </div>

        {/* RIGHT — scoring */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Your scores</div>
              <button className="os-btn sm ghost" onClick={() => setShowRubric(true)}>Open rubric →</button>
            </div>

            {['problem','solution','tech','founders','commit'].map(k => (
              <div key={k} style={{ marginBottom: 16 }}>
                <Slider label={CRIT_LABELS[k]} kind={k} value={scores[k]} onChange={setScore(k)} />
                {showAi && (
                  <div className="os-row gap-sm os-mt-sm" style={{ paddingLeft: 120 }}>
                    <label className="os-row gap-sm" style={{ fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={k in disagree} onChange={(e) => toggleDisagree(k, e.target.checked)} />
                      Disagree with AI on {CRIT_LABELS[k]}
                    </label>
                  </div>
                )}
                {showAi && (k in disagree) && (
                  <div style={{ paddingLeft: 120, marginTop: 8 }}>
                    <input className="os-input os-w-100" style={{ fontSize: 13 }}
                      placeholder={"Reason for disagreement on " + k + "..."}
                      value={disagree[k]}
                      onChange={(e) => setDisagreeReason(k, e.target.value)} />
                  </div>
                )}
              </div>
            ))}

            <hr className="os-divider"/>

            <div className="os-row between os-mb-sm">
              <span className="os-text-xs os-text-dim os-uppercase">Your overall</span>
              <span className="os-num-big" style={{ fontSize: 34, fontFamily:'var(--font-sans)', fontWeight: 800, letterSpacing:'-0.02em', color:'#3213b7' }}>{overall.toFixed(2)}</span>
            </div>
            <div className="os-row between">
              <span className="os-text-xs os-text-dim os-uppercase">vs AI</span>
              <Variance value={Math.abs(overall - s.ai.overall)} />
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Recommendation</div>
            <div className="os-reco-group">
              <button className={'os-reco-btn yes ' + (reco==='yes'?'active':'')} onClick={() => setReco('yes')}>YES</button>
              <button className={'os-reco-btn maybe ' + (reco==='maybe'?'active':'')} onClick={() => setReco('maybe')}>MAYBE</button>
              <button className={'os-reco-btn no ' + (reco==='no'?'active':'')} onClick={() => setReco('no')}>NO</button>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Notes (variance &gt; 1.0 — required)</div>
            <textarea className="os-input os-w-100" rows="5" placeholder="Why does your evaluation differ from AI? What did you see that the model missed?" value={notes} onChange={(e) => setNotes(e.target.value)}/>
          </div>

          <div className="os-card soft">
            <div className="os-row between os-mb-sm">
              <div className="os-card-title">Risk flags raised</div>
              <span className="os-text-xs os-text-dim">{flags.length} / {MAX_FLAGS}</span>
            </div>
            <div className="os-stack gap-sm">
              {flags.length === 0 && (
                <div className="os-text-sm os-text-dim">No flags raised yet.</div>
              )}
              {flags.map((f, i) => (
                <div key={i} className="os-row gap-sm" style={{ alignItems:'center' }}>
                  <span className="os-chip amber">⚐</span>
                  <span className="os-text-sm" style={{ flex: 1 }}>{f}</span>
                  <button
                    className="os-btn sm ghost"
                    style={{ padding:'2px 8px', lineHeight:1 }}
                    title="Remove flag"
                    onClick={() => removeFlag(i)}
                  >✕</button>
                </div>
              ))}
              {flags.length < MAX_FLAGS ? (
                <div className="os-row gap-sm os-mt-sm" style={{ alignItems:'center' }}>
                  <input
                    className="os-input"
                    style={{ flex: 1, fontSize: 13 }}
                    placeholder="Add a short risk flag…"
                    maxLength={80}
                    value={flagInput}
                    onChange={e => setFlagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFlag(); } }}
                  />
                  <button className="os-btn sm ghost" onClick={addFlag} disabled={!flagInput.trim()}>+ Add flag</button>
                </div>
              ) : (
                <div className="os-text-xs os-text-dim os-mt-sm">Maximum of {MAX_FLAGS} flags reached.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showRubric && <RubricModal onClose={() => setShowRubric(false)} active={activeCat}/>}
    </div>
  );
}

function RubricModal({ onClose, active='problem' }) {
  const RUBRIC = {
    problem:   { name:'Problem Quality', anchors:[
      ['10','Existential pain for a clearly-defined market segment with quantified $ impact'],
      ['8','Clear pain, identified segment, market sized but unverified'],
      ['6','Pain articulated, segment vague, no numbers'],
      ['4','Pain assumed, no customer evidence'],
      ['2','Solution-first thinking — no real problem'],
    ]},
    solution:  { name:'Solution Fit', anchors:[
      ['10','Solution maps 1:1 to problem · differentiated vs all known alternatives'],
      ['8','Solution maps to problem · differentiated vs incumbents'],
      ['6','Solution addresses problem · differentiation unclear'],
      ['4','Solution loosely tied to problem · me-too risk'],
      ['2','Solution looking for a problem'],
    ]},
    tech:      { name:'Tech Depth', anchors:[
      ['10','Novel IP · multiple patents · published research'],
      ['8','Genuine technical edge · known to experts'],
      ['6','Solid implementation · standard tech stack'],
      ['4','Wrapper / integration play'],
      ['2','No defensible tech'],
    ]},
    founders:  { name:'Founder Strength', anchors:[
      ['10','2-3 founders, complementary, prior exits or domain mastery, full-time'],
      ['8','2+ founders, complementary, full-time, deep domain'],
      ['6','2 founders, some skill overlap, full-time'],
      ['4','Solo founder with strong background OR co-founders with weak match'],
      ['2','Solo founder, generalist, part-time'],
    ]},
    commit:    { name:'Commitment', anchors:[
      ['10','Quit prior job, invested own capital, 2+ years runway personal'],
      ['8','Full-time, some personal capital'],
      ['6','Full-time, no personal capital'],
      ['4','Partial commitment, "validating"'],
      ['2','Side project'],
    ]}
  };
  return (
    <div className="os-modal-backdrop" onClick={onClose}>
      <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="os-modal-head">
          <div>
            <div className="os-text-xs os-text-dim os-uppercase">scoring.md · v3.1</div>
            <div className="os-h1" style={{ fontSize: 22 }}>Reviewer rubric</div>
          </div>
          <button className="os-btn ghost" onClick={onClose}>Close ✕</button>
        </div>
        <div className="os-modal-body">
          <div className="os-rubric">
            <div className="head">
              <span># scoring.md — TIR 2026 reviewer rubric</span>
              <span className="ver">last updated 2026-04-01 · admin@artpark.in</span>
            </div>
            {Object.entries(RUBRIC).map(([k, v]) => (
              <div key={k}>
                <h4>## {v.name}</h4>
                <pre>{v.anchors.map(([n,d]) => '  ' + n + '  →  ' + d).join('\n')}</pre>
              </div>
            ))}
            <h4 style={{ marginTop: 18 }}># notes</h4>
            <pre>{'- Score independently of AI baseline.\n- For variance > 1.0 from AI, written rationale is required.\n- Flag any inconsistency you spot — admin will reconcile.'}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ R-3 History ============
function ReviewerHistory({ openEval }) {
  const { data, loading, error, reload } = useAsync(() => API.getHistory(), []);

  if (loading) return <div style={{ padding: '48px 0' }}><LoadingState label="Loading your history…" /></div>;
  if (error)   return <div style={{ padding: '48px 0' }}><ErrorState error={error} onRetry={reload} /></div>;

  const stats = data.stats;
  const history = data.rows;
  const recoTone = r => r==='yes' ? 'green' : r==='no' ? 'red' : 'amber';
  // appId 'sNN' -> 0-based index into the applications list (for the eval screen).
  const idxOfApp = appId => parseInt(String(appId).replace('s', ''), 10) - 1;

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <span className="lp-section-eyebrow">R-3 · MY HISTORY</span>
          <h2 className="lp-section-title">Review history</h2>
          <div className="lp-section-sub">All evaluations you've submitted, your variance vs AI, and how admin decisions tracked your recommendations.</div>
        </div>
      </div>
      <div className="lp-stat-grid">
        <div className="dash-stat-tile">
          <div className="dash-stat-label">TOTAL REVIEWS</div>
          <div className="dash-stat-num">{stats.total}</div>
          <div className="dash-stat-sub">3 cohorts</div>
        </div>
        <div className="dash-stat-tile">
          <div className="dash-stat-label">CONSISTENCY</div>
          <div className="dash-stat-num">{stats.consistencyPct}%</div>
          <div className="dash-stat-sub">with admin decisions</div>
        </div>
        <div className="dash-stat-tile">
          <div className="dash-stat-label">AVG VARIANCE</div>
          <div className="dash-stat-num">{stats.avgVariance.toFixed(1)}</div>
          <div className="dash-stat-sub">vs AI baseline</div>
        </div>
        <div className="dash-stat-tile">
          <div className="dash-stat-label">AVG TIME</div>
          <div className="dash-stat-num">{stats.avgMinutes}m</div>
          <div className="dash-stat-sub">per review</div>
        </div>
      </div>
      <table className="os-table">
        <thead><tr><th>Startup</th><th>Date</th><th>My score</th><th>AI</th><th>Δ</th><th>My reco</th><th>Admin decision</th><th>Match?</th><th>Decision</th></tr></thead>
        <tbody>
          {history.map((h,i) => {
            const match = (h.reco==='yes' && h.adminDec==='approved') || (h.reco==='no' && h.adminDec==='rejected');
            return (
              <tr key={i}>
                <td><b>{h.name}</b></td>
                <td className="os-text-sm" style={{ color: 'var(--ink-soft)' }}>{h.date}</td>
                <td className="num"><b>{h.myScore.toFixed(1)}</b></td>
                <td className="num os-text-soft">{h.aiScore.toFixed(1)}</td>
                <td><Variance value={h.variance}/></td>
                <td><Chip tone={recoTone(h.reco)}>{h.reco.toUpperCase()}</Chip></td>
                <td><Chip tone={h.adminDec==='approved'?'green':h.adminDec==='rejected'?'red':'slate'}>{h.adminDec.toUpperCase()}</Chip></td>
                <td>{match ? <span style={{ color:'var(--ok)' }}>✓</span> : <span style={{ color:'var(--ink-dim)' }}>—</span>}</td>
                <td>
                  <button className="os-btn sm ghost" onClick={() => openEval(idxOfApp(h.appId), h.source || 'history')}>✎ Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Generates scoring.md from the rubric and downloads it (client-side).
function downloadRubricMd() {
  const cats = [
    ['Problem',[['10','Existential pain · quantified market'],['8','Clear pain, sized'],['6','Vague segment'],['4','No customer evidence'],['2','Solution-first']]],
    ['Solution',[['10','Differentiated vs all alternatives'],['8','Differentiated vs incumbents'],['6','Standard'],['4','Me-too'],['2','Solution looking for problem']]],
    ['Tech',[['10','Novel IP · patents · papers'],['8','Genuine edge'],['6','Solid implementation'],['4','Wrapper'],['2','No tech defensibility']]],
    ['Founders',[['10','2-3 founders · prior exits'],['8','Strong domain · full-time'],['6','Some overlap'],['4','Solo strong / weak match'],['2','Solo generalist part-time']]],
    ['Commitment',[['10','Quit · personal capital · 2yr runway'],['8','Full-time + some capital'],['6','Full-time only'],['4','Partial · validating'],['2','Side project']]],
  ];
  let md = '# scoring.md — TIR 2026 reviewer rubric\n_v3.1 · 2026-04-01_\n\nScore each of 6 dimensions independently on a 0–10 scale. Anchors below.\n';
  cats.forEach(([name, anchors]) => {
    md += '\n## ' + name + '\n';
    anchors.forEach(([n, d]) => { md += '  ' + n.padStart(2) + '  →  ' + d + '\n'; });
  });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'scoring.md';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ReviewerRubric() {
  return (
    <div>
      <PageHead
        eyebrow="R-4 · RUBRIC"
        title='scoring.md · <em>v3.1</em>'
        sub="Reference rubric used for all Layer 3 evaluations. Maintained by ARTPARK admin."
        actions={[<button key="dl" className="os-btn ghost" onClick={downloadRubricMd}>Download</button>]}
      />
      <div className="os-card" style={{ padding: 0 }}>
        <RubricInline/>
      </div>
    </div>
  );
}

function RubricInline() {
  const cats = [
    ['Problem','problem',[['10','Existential pain · quantified market'],['8','Clear pain, sized'],['6','Vague segment'],['4','No customer evidence'],['2','Solution-first']]],
    ['Solution','solution',[['10','Differentiated vs all alternatives'],['8','Differentiated vs incumbents'],['6','Standard'],['4','Me-too'],['2','Solution looking for problem']]],
    ['Tech','tech',[['10','Novel IP · patents · papers'],['8','Genuine edge'],['6','Solid implementation'],['4','Wrapper'],['2','No tech defensibility']]],
    ['Founders','founders',[['10','2-3 founders · prior exits'],['8','Strong domain · full-time'],['6','Some overlap'],['4','Solo strong / weak match'],['2','Solo generalist part-time']]],
    ['Commitment','commit',[['10','Quit · personal capital · 2yr runway'],['8','Full-time + some capital'],['6','Full-time only'],['4','Partial · validating'],['2','Side project']]],
  ];
  return (
    <div className="os-rubric" style={{ padding: '24px 28px' }}>
      <div className="head"><span># scoring.md — TIR 2026 reviewer rubric</span><span className="ver">v3.1 · 2026-04-01</span></div>
      <pre style={{ marginBottom: 12 }}>Score each of 6 dimensions independently on a 0-10 scale. Anchors below.</pre>
      {cats.map(([name, key, anchors]) => (
        <div key={key}>
          <h4 style={{ color:'var(--cat-' + key + ')' }}>## {name}</h4>
          {anchors.map(([n,d]) => (
            <pre key={n}>  <span className="anchor">{n.padStart(2)}</span>  &rarr;  {d}</pre>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReviewerApp() {
  const [tab, setTab] = useRS('queue');
  const [selIdx, setSelIdx] = useRS(2);
  const [evalSource, setEvalSource] = useRS('queue'); // 'queue' | 'history' — which store to edit
  const [queueDomain, setQueueDomain] = useRS('all'); // pre-filter when jumping from dashboard
  const QUEUE_N = 8;

  const openEval = (i, source = 'queue') => {
    setSelIdx(typeof i === 'number' ? i : 2);
    setEvalSource(source || 'queue');
    setTab('eval');
  };
  // Dashboard → My Queue, pre-filtered by the chosen industry.
  const goQueueFiltered = (industry) => { setQueueDomain(industry); setTab('queue'); };
  // Tab-bar navigation resets the industry pre-filter (fresh queue).
  const handleTab = (t) => { if (t === 'queue') setQueueDomain('all'); setTab(t); };

  return (
    <div className="os-shell">
      <ReviewerTopbar tab={tab} />
      <div className="lp-layout">
        {tab !== 'eval' && <ReviewerCohortHeader />}
        {tab !== 'eval' && <ReviewerTabBar tab={tab} setTab={handleTab} />}
        {tab === 'dashboard' && <ReviewerDashboard onPickIndustry={goQueueFiltered} />}
        {tab === 'queue'     && <ReviewerQueue go={openEval} initialDomain={queueDomain} />}
        {tab === 'eval'      && (
          <div className="lp-tab-content lp-tab-content--full">
            <ReviewerEval
              idx={selIdx}
              source={evalSource}
              onBack={() => setTab(evalSource === 'history' ? 'history' : 'queue')}
              onPrev={() => setSelIdx(i => (i - 1 + QUEUE_N) % QUEUE_N)}
              onNext={() => setSelIdx(i => (i + 1) % QUEUE_N)}
            />
          </div>
        )}
        {tab === 'history'   && (
          <div className="lp-tab-content">
            <ReviewerHistory openEval={openEval} />
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ReviewerApp />);
