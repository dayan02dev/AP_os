// ADMIN PORTAL
// A-1 Dashboard · A-2 Pipeline · A-3 Detail · A-4 Gate Review (3 variants) · A-5 Reviewer Mgmt
// A-6 AI Status · A-7 Audit Log

const { useState: useAS } = React;

const NAV_ADMIN = [
  { label:'Pipeline', entries:[
    { id:'dashboard', num:'A-0', label:'Dashboard Home' },
    { id:'pipeline',  num:'A-1', label:'Application Intake' },
    { id:'detail',    num:'A-2', label:'AI Evaluation View' },
  ]},
  { label:'Evaluation & Decisions', entries:[
    { id:'reviewers', num:'A-3', label:'Reviewer Mgmt' },
    { id:'gate1',     num:'A-4', label:'Gate 1 Review', badge:'12' },
    { id:'psychometry', num:'A-5', label:'Psychometry Mgmt' },
    { id:'jury',      num:'A-6', label:'Jury Mgmt' },
    { id:'gate2',     num:'A-7', label:'Gate 2 Final' },
  ]},
  { label:'System & Analytics', entries:[
    { id:'audit',     num:'A-8', label:'Audit Log' },
    { id:'analytics', num:'A-9', label:'Analytics Dashboard' },
  ]},
];

// ============ A-1 Dashboard ============
function FunnelRow({ label, sublabel, count, maxCount, filledColor = '#1f0a8a' }) {
  const percent = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const isZero = count === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#f0f0f3', borderRadius: '4px', height: '36px', overflow: 'hidden', position: 'relative' }}>
          {percent > 0 && (
            <div style={{ width: `${percent}%`, height: '100%', background: filledColor, transition: 'width 0.3s ease' }} />
          )}
          <div style={{ 
            position: 'absolute', 
            right: '12px', 
            top: '50%', 
            transform: 'translateY(-50%)',
            background: isZero ? '#e3e3e8' : '#ffffff', 
            border: isZero ? 'none' : `1px solid ${filledColor}`,
            color: isZero ? '#6f6f78' : '#242424',
            padding: '2px 8px',
            borderRadius: '2px',
            fontSize: '11px',
            fontWeight: 'bold',
            fontFamily: 'var(--font-sans)'
          }}>
            {count}
          </div>
        </div>
        <div style={{ width: '180px', flexShrink: 0 }}>
          <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#242424', letterSpacing: '0.05em', fontFamily: 'var(--font-sans)' }}>{label}</div>
          <div style={{ fontSize: '11px', color: '#6f6f78', fontFamily: 'var(--font-sans)' }}>{sublabel}</div>
        </div>
      </div>
    </div>
  );
}

const ArrowDown = () => (
  <div style={{ display: 'flex', width: '100%', gap: 16, margin: '2px 0' }}>
    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', color: '#8a8a92', fontSize: '12px', paddingRight: '20px' }}>↓</div>
    <div style={{ width: '180px' }} />
  </div>
);

function AIScoreHistogram() {
  const data = [
    { range: '0-1', count: 1 },
    { range: '1-2', count: 0 },
    { range: '2-3', count: 0 },
    { range: '3-4', count: 1 },
    { range: '4-5', count: 0 },
    { range: '5-6', count: 5 },
    { range: '6-7', count: 1 },
    { range: '7-8', count: 35 },
    { range: '8-9', count: 155, special: true },
    { range: '9-10', count: 52 }
  ];
  const maxCount = 155;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: '180px', gap: 8, borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
        {data.map((d, i) => {
          const heightPercent = (d.count / maxCount) * 100;
          const isZero = d.count === 0;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: isZero ? 'transparent' : 'var(--ink)' }}>{d.count}</span>
              <div 
                style={{
                  width: '100%',
                  height: `${isZero ? 2 : Math.max(heightPercent * 1.5, 4)}px`,
                  background: d.special ? '#1f0a8a' : '#242424',
                  borderRadius: '2px 2px 0 0',
                  minHeight: isZero ? '1px' : '4px'
                }}
              />
              <span style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--ink-soft)', marginTop: 4, transform: 'scale(0.9)' }}>{d.range}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, fontWeight: '600', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
        MEAN <strong style={{color: 'var(--ink)'}}>8.3</strong> &middot; MEDIAN <strong style={{color: 'var(--ink)'}}>8.5</strong> &middot; N = 250
      </div>
    </div>
  );
}

function AIScoreComponents() {
  const components = [
    { label: 'Problem Impact & Importance', weight: '22%', score: 8.3 },
    { label: 'Completeness & Depth of Solution', weight: '30%', score: 8.4 },
    { label: 'Technical Depth', weight: '22%', score: 8.3 },
    { label: 'Behavioral Parameters', weight: '14%', score: 8.4 },
    { label: 'Commitment', weight: '12%', score: 8.4 }
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {components.map((c, i) => {
        const percent = c.score * 10;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: '600', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{c.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)' }}>weight {c.weight}</span>
                <span style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{c.score}<span style={{ fontSize: 10, fontWeight: 'normal', color: 'var(--ink-dim)' }}>/10</span></span>
              </div>
            </div>
            <div style={{ height: 8, background: '#f0f0f3', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${percent}%`, height: '100%', background: '#242424', borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApplicationsByIndustry({ go }) {
  const industries = [
    { name: 'Robotics & Automation', count: 48, pct: '19.3%' },
    { name: 'Healthcare / MedTech', count: 43, pct: '17.3%' },
    { name: 'Artificial Intelligence / Foundational Models', count: 42, pct: '16.9%' },
    { name: 'Defense & Aerospace', count: 39, pct: '15.7%' },
    { name: 'Advanced Manufacturing / Industry 5.0', count: 20, pct: '8%' },
    { name: 'EV Mobility & Services', count: 17, pct: '6.8%' },
    { name: 'Other / Frontier', count: 10, pct: '4%' },
    { name: 'Semiconductor / Hardware', count: 10, pct: '4%' },
    { name: 'Climate Fintech / Urban Resilience', count: 6, pct: '2.4%' },
    { name: 'Developer Tools / DevOps', count: 6, pct: '2.4%' },
    { name: 'EdTech', count: 6, pct: '2.4%' },
    { name: 'E-commerce & Artisanal Crafts', count: 2, pct: '0.8%' }
  ];

  const handleIndustryClick = (indName) => {
    if (!window.OS_FILTERS) window.OS_FILTERS = {};
    window.OS_FILTERS.industry = indName;
    go('pipeline');
  };

  const maxCount = 48;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {industries.map((ind, i) => {
          const percent = (ind.count / maxCount) * 100;
          return (
            <div 
              key={i} 
              style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
              onClick={() => handleIndustryClick(ind.name)}
              className="industry-bar-row"
            >
              <span style={{ width: '280px', fontSize: 13, fontWeight: '500', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{ind.name}</span>
              <div style={{ flex: 1, height: 16, background: '#f0f0f3', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: '#1f0a8a', borderRadius: 4 }} />
              </div>
              <div style={{ width: '80px', textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                <strong style={{ color: 'var(--ink)' }}>{ind.count}</strong>
                <span style={{ color: 'var(--ink-dim)', marginLeft: 8 }}>{ind.pct}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 16, borderTop: '1px dashed var(--line)', marginTop: 8 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', textTransform: 'uppercase', marginRight: 8 }}>FILTER:</span>
        <button 
          style={{ padding: '4px 12px', borderRadius: '16px', background: '#242424', color: '#fff', border: 'none', fontSize: 12, fontWeight: '500', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          onClick={() => {
            if (!window.OS_FILTERS) window.OS_FILTERS = {};
            window.OS_FILTERS.industry = 'all';
            go('pipeline');
          }}
        >
          All
        </button>
        {industries.map(ind => (
          <button 
            key={ind.name}
            style={{ padding: '4px 12px', borderRadius: '16px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', fontSize: 12, fontWeight: '500', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            onClick={() => handleIndustryClick(ind.name)}
          >
            {ind.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBreakdown({ go }) {
  const statuses = [
    { id: 'submitted', label: 'Submitted', count: 23, color: '#b7a06a' },
    { id: 'ai-screening', label: 'AI screening', count: 0, color: '#3213b7' },
    { id: 'under-review', label: 'Under review', count: 250, color: '#3213b7' },
    { id: 'evaluated', label: 'Evaluated', count: 0, color: '#3213b7' },
    { id: 'shortlisted', label: 'Shortlisted', count: 0, color: '#2a8f5a' },
    { id: 'interview', label: 'Interview', count: 0, color: '#2a8f5a' },
    { id: 'offered', label: 'Offered', count: 0, color: '#242424' },
    { id: 'onboarded', label: 'Onboarded', count: 0, color: '#242424' },
    { id: 'not-selected', label: 'Not selected', count: 0, color: '#242424' },
    { id: 'waitlisted', label: 'Waitlisted', count: 0, color: '#242424' },
    { id: 'withdrawn', label: 'Withdrawn', count: 0, color: '#242424' }
  ];

  const handleStatusClick = (statusId) => {
    if (!window.OS_FILTERS) window.OS_FILTERS = {};
    window.OS_FILTERS.status = statusId;
    go('pipeline');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {statuses.map(st => (
        <div 
          key={st.id}
          onClick={() => handleStatusClick(st.id)}
          style={{ 
            border: '1px solid var(--line)', 
            borderRadius: '2px', 
            padding: '12px 16px', 
            background: 'var(--bg-paper)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          className="status-breakdown-tile"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color, display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: '500', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>{st.label}</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>{st.count}</span>
        </div>
      ))}
    </div>
  );
}

function AdminDashboard({ go }) {
  if (!window.OS_FILTERS) {
    window.OS_FILTERS = {
      status: 'all',
      industry: 'all'
    };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* 2. Top Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {/* Tile 1: Profiles Signed Up */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>PROFILES SIGNED UP</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0', fontFamily: 'var(--font-sans)' }}>601</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)' }}>on platform</div>
        </div>

        {/* Tile 2: Applications Submitted with TIR/SIP bars */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>APPLICATIONS SUBMITTED</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>273</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--ink-soft)' }}>
              <span style={{ width: 20, fontFamily: 'var(--font-sans)' }}>TIR</span>
              <div style={{ flex: 1, height: 3, background: 'var(--line)', borderRadius: 1 }}>
                <div style={{ width: '91.5%', height: '100%', background: '#1f0a8a', borderRadius: 1 }} />
              </div>
              <span style={{ width: 20, textAlign: 'right', fontFamily: 'var(--font-sans)' }}>250</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--ink-soft)' }}>
              <span style={{ width: 20, fontFamily: 'var(--font-sans)' }}>SIP</span>
              <div style={{ flex: 1, height: 3, background: 'var(--line)', borderRadius: 1 }}>
                <div style={{ width: '8.5%', height: '100%', background: '#FFB703', borderRadius: 1 }} />
              </div>
              <span style={{ width: 20, textAlign: 'right', fontFamily: 'var(--font-sans)' }}>23</span>
            </div>
          </div>
        </div>

        {/* Tile 3: Advanced Past Review */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>ADVANCED PAST REVIEW</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0', fontFamily: 'var(--font-sans)' }}>0</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)' }}>0% of submissions</div>
        </div>

        {/* Tile 4: Onboarded */}
        <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 110 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>ONBOARDED</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', margin: '8px 0 4px 0', fontFamily: 'var(--font-sans)' }}>0</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)' }}>from offered &rarr; ready</div>
        </div>

      </div>

      {/* 3. Funnel section */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>&sect; Pipeline funnel</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>From signup to onboarded</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FunnelRow label="PROFILES" sublabel="signed up" count={601} maxCount={601} />
          <ArrowDown />
          <FunnelRow label="DRAFTED" sublabel="started" count={473} maxCount={601} />
          <ArrowDown />
          <FunnelRow label="SUBMITTED" sublabel="complete" count={273} maxCount={601} />
          <ArrowDown />
          <FunnelRow label="IN REVIEW" sublabel="under review" count={250} maxCount={601} />
          <ArrowDown />
          <FunnelRow label="ADVANCED" sublabel="shortlist + interview" count={0} maxCount={601} />
          <ArrowDown />
          <FunnelRow label="DECIDED" sublabel="offered + onboarded" count={0} maxCount={601} />
        </div>
      </div>


      {/* 5. Applications by Industry concentration */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>&sect; Applications by industry</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>Where the cohort is concentrated</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            Click an industry to jump into the Applications tab pre-filtered.
          </div>
        </div>
        <ApplicationsByIndustry go={go} />
      </div>

      {/* 6. Status breakdown */}
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 2, padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--ink-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>&sect; Status breakdown</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0 0', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>Where every application sits right now</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, fontFamily: 'var(--font-sans)' }}>
            Click a status to open the Applications tab filtered to it.
          </div>
        </div>
        <StatusBreakdown go={go} />
      </div>
    </div>
  );
}

function AdminPipeline({ goDetail }) {
  const S = window.OS_DATA.STARTUPS;
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const initialStatus = window.OS_FILTERS?.status || 'all';
  const initialIndustry = window.OS_FILTERS?.industry || 'all';
  if (window.OS_FILTERS) {
    window.OS_FILTERS.status = 'all';
    window.OS_FILTERS.industry = 'all';
  }

  const [search, setSearch] = useAS('');
  const [track, setTrack] = useAS('all');
  const [status, setStatus] = useAS(initialStatus);
  const [aiScore, setAiScore] = useAS('all');
  const [industry, setIndustry] = useAS(initialIndustry);
  const [batchFilter, setBatchFilter] = React.useState('all');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState([]);

  const [sortCol, setSortCol] = React.useState(null);
  const [sortAsc, setSortAsc] = React.useState(true);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const renderHeader = (label, colKey, isNum = false) => {
    const isSorted = sortCol === colKey;
    return (
      <th 
        className={isNum ? 'num' : ''}
        onClick={() => handleSort(colKey)} 
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-start', width: '100%' }}>
          {label}
          {isSorted ? (sortAsc ? ' ▲' : ' ▼') : ''}
        </span>
      </th>
    );
  };

  const getAvailableBatches = () => {
    if (!window.OS_DATA.BATCHES) {
      window.OS_DATA.BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Batch D', 'Batch E'];
    }
    const set = new Set(window.OS_DATA.BATCHES);
    S.forEach(s => {
      if (s.batch && s.batch !== 'Unassigned') set.add(s.batch);
    });
    window.OS_DATA.REVIEWERS.forEach(r => {
      if (r.batches) r.batches.forEach(b => set.add(b));
      else if (r.batch) set.add(r.batch);
    });
    return Array.from(set).sort();
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(x => x.id));
    }
  };

  const applyBatchToSelected = (batchName) => {
    let targetBatch = batchName;
    if (batchName === 'new') {
      const custom = prompt("Enter new batch name:");
      if (!custom) return;
      targetBatch = custom;
      if (!window.OS_DATA.BATCHES) window.OS_DATA.BATCHES = [];
      if (!window.OS_DATA.BATCHES.includes(custom)) {
        window.OS_DATA.BATCHES.push(custom);
      }
    }
    selectedIds.forEach(id => {
      const startup = S.find(x => x.id === id);
      if (startup) {
        startup.batch = targetBatch;
      }
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const changeIndividualBatch = (startup, val) => {
    if (val === 'new') {
      const custom = prompt("Enter new batch name:");
      if (custom) {
        startup.batch = custom;
        if (!window.OS_DATA.BATCHES) window.OS_DATA.BATCHES = [];
        if (!window.OS_DATA.BATCHES.includes(custom)) {
          window.OS_DATA.BATCHES.push(custom);
        }
      }
    } else {
      startup.batch = val;
    }
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const handleBulkHold = () => {
    selectedIds.forEach(id => {
      const s = S.find(x => x.id === id);
      if (s) s.chip = 'HOLD';
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const handleBulkNextLevel = () => {
    selectedIds.forEach(id => {
      const s = S.find(x => x.id === id);
      if (s) {
        const cur = (s.chip || 'NEW').toUpperCase();
        if (cur === 'NEW' || cur === 'PROCESSING' || cur === 'HOLD') s.chip = 'IN REVIEW';
        else if (cur === 'IN REVIEW') s.chip = 'EVALUATED';
        else if (cur === 'EVALUATED') s.chip = 'SHORTLISTED';
        else if (cur === 'SHORTLISTED') s.chip = 'JURY REVIEW';
        else if (cur === 'JURY REVIEW') s.chip = 'ACCEPTED';
      }
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const handleBulkReject = () => {
    selectedIds.forEach(id => {
      const s = S.find(x => x.id === id);
      if (s) s.chip = 'REJECTED';
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const handleBulkToggleHide = () => {
    selectedIds.forEach(id => {
      const s = S.find(x => x.id === id);
      if (s) s.hidden = !s.hidden;
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const handleBulkArchive = () => {
    selectedIds.forEach(id => {
      const s = S.find(x => x.id === id);
      if (s) s.archived = true;
    });
    setSelectedIds([]);
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  const renameBatch = (oldName) => {
    const newName = prompt(`Rename batch "${oldName}" to:`, oldName);
    if (newName && newName !== oldName) {
      if (!window.OS_DATA.BATCHES) {
        window.OS_DATA.BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Batch D', 'Batch E'];
      }
      const idx = window.OS_DATA.BATCHES.indexOf(oldName);
      if (idx !== -1) window.OS_DATA.BATCHES[idx] = newName;
      else window.OS_DATA.BATCHES.push(newName);

      S.forEach(s => {
        if (s.batch === oldName) s.batch = newName;
      });
      window.OS_DATA.REVIEWERS.forEach(r => {
        if (r.batches) {
          r.batches = r.batches.map(b => b === oldName ? newName : b);
        }
        if (r.batch === oldName) r.batch = newName;
      });
      if (batchFilter === oldName) {
        setBatchFilter(newName);
      }
      if (window.persistOSData) window.persistOSData();
      forceUpdate();
    }
  };

  const getStatusId = (s) => {
    if (!s.chip) return 'submitted';
    const c = s.chip.toUpperCase();
    if (c === 'NEW') return 'submitted';
    if (c === 'PROCESSING') return 'ai-screening';
    if (c === 'IN REVIEW') return 'under-review';
    if (c === 'EVALUATED') return 'evaluated';
    if (c === 'SHORTLISTED') return 'shortlisted';
    if (c === 'JURY REVIEW') return 'interview';
    if (c === 'ACCEPTED') return 'offered'; // offered or onboarded
    if (c === 'REJECTED') return 'not-selected';
    if (c === 'WAITLISTED') return 'waitlisted';
    if (c === 'HOLD') return 'hold';
    return 'submitted';
  };

  const getFriendlyStatus = (s) => {
    if (!s.chip) return 'Submitted';
    const c = s.chip.toUpperCase();
    if (c === 'NEW') return 'Submitted';
    if (c === 'PROCESSING') return 'AI screening';
    if (c === 'IN REVIEW') return 'Under review';
    if (c === 'EVALUATED') return 'Evaluated';
    if (c === 'SHORTLISTED') return 'Shortlisted';
    if (c === 'JURY REVIEW') return 'Interview';
    if (c === 'ACCEPTED') return 'Offered';
    if (c === 'REJECTED') return 'Rejected';
    if (c === 'WAITLISTED') return 'Waitlisted';
    if (c === 'HOLD') return 'Hold';
    return c;
  };

  const getChipTone = (s) => {
    const c = s.chip ? s.chip.toUpperCase() : 'NEW';
    if (c === 'ACCEPTED' || c === 'SHORTLISTED') return 'green';
    if (c === 'JURY REVIEW') return 'blue';
    if (c === 'EVALUATED') return 'purple';
    if (c === 'IN REVIEW') return 'amber';
    if (c === 'HOLD') return 'amber';
    if (c === 'REJECTED') return 'red';
    return '';
  };

  const hasFilters = search !== '' || track !== 'all' || status !== 'all' || industry !== 'all' || batchFilter !== 'all';
  const clearAll = () => {
    setSearch('');
    setTrack('all');
    setStatus('all');
    setIndustry('all');
    setBatchFilter('all');
  };

  const filtered = S.filter(s => {
    if (s.archived) return false;

    if (batchFilter !== 'all') {
      const b = s.batch || 'Unassigned';
      if (b !== batchFilter) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const matchName = s.name.toLowerCase().includes(q);
      const matchFounder = s.founders.some(f => f.toLowerCase().includes(q));
      const matchDomain = s.domain.toLowerCase().includes(q);
      if (!matchName && !matchFounder && !matchDomain) return false;
    }

    if (track === 'tir') {
      const tirIds = ['s01','s02','s04','s05','s06','s07','s08','s10','s11','s12','s13','s15','s16'];
      if (!tirIds.includes(s.id)) return false;
    } else if (track === 'sip') {
      const sipIds = ['s03','s09','s14'];
      if (!sipIds.includes(s.id)) return false;
    }

    if (status !== 'all') {
      const currentStatusId = getStatusId(s);
      if (status === 'offered' || status === 'onboarded') {
        if (currentStatusId !== 'offered') return false;
      } else {
        if (currentStatusId !== status) return false;
      }
    }

    if (industry !== 'all') {
      const cleanIndustry = industry.replace(/\s+\d+$/, '').trim().toLowerCase();
      if (s.domain.toLowerCase().trim() !== cleanIndustry) return false;
    }

    return true;
  });

  const STATUSES = [
    { id: 'all', label: 'All' },
    { id: 'submitted', label: 'Submitted', color: '#b7a06a' },
    { id: 'ai-screening', label: 'AI screening', color: '#3213b7' },
    { id: 'under-review', label: 'Under review', color: '#3213b7' },
    { id: 'evaluated', label: 'Evaluated', color: '#3213b7' },
    { id: 'shortlisted', label: 'Shortlisted', color: '#2a8f5a' },
    { id: 'interview', label: 'Interview', color: '#2a8f5a' },
    { id: 'hold', label: 'Hold', color: '#b7a06a' },
    { id: 'offered', label: 'Offered', color: '#242424' },
    { id: 'onboarded', label: 'Onboarded', color: '#242424' },
    { id: 'not-selected', label: 'Not selected', color: '#242424' },
    { id: 'waitlisted', label: 'Waitlisted', color: '#242424' },
    { id: 'withdrawn', label: 'Withdrawn', color: '#242424' },
  ];

  const INDUSTRIES = [
    "Robotics & Automation 48",
    "Healthcare / MedTech 43",
    "Artificial Intelligence / Foundational Models 41",
    "Defense & Aerospace 38",
    "Advanced Manufacturing / Industry 5.0 20",
    "EV Mobility & Services 17",
    "Other / Frontier 10",
    "Semiconductor / Hardware 10",
    "Climate Fintech / Urban Resilience 6",
    "Developer Tools / DevOps 6",
    "EdTech 6",
    "E-commerce & Artisanal Crafts 2",
  ];

  const sortedFiltered = React.useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortCol === 'founder') {
        valA = (a.founders && a.founders[0]) || '';
        valB = (b.founders && b.founders[0]) || '';
      } else if (sortCol === 'domain') {
        valA = a.domain || '';
        valB = b.domain || '';
      } else if (sortCol === 'stage') {
        valA = a.stage || '';
        valB = b.stage || '';
      } else if (sortCol === 'ai') {
        valA = a.ai ? a.ai.overall : 0;
        valB = b.ai ? b.ai.overall : 0;
      } else if (sortCol === 'rev') {
        valA = a.rev ? a.rev.overall : -1;
        valB = b.rev ? b.rev.overall : -1;
      } else if (sortCol === 'status') {
        valA = getFriendlyStatus(a) || '';
        valB = getFriendlyStatus(b) || '';
      } else if (sortCol === 'batch') {
        valA = a.batch || 'Unassigned';
        valB = b.batch || 'Unassigned';
      } else if (sortCol === 'sub') {
        valA = a.sub || '';
        valB = b.sub || '';
      } else if (sortCol === 'id') {
        valA = a.id || '';
        valB = b.id || '';
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortAsc]);

  // Active (applied) filters shown as removable pills, e-commerce style.
  const activeChips = [];
  if (status !== 'all') activeChips.push({ label: 'Status · ' + ((STATUSES.find(x => x.id === status) || {}).label || status), clear: () => setStatus('all') });
  if (industry !== 'all') activeChips.push({ label: industry.replace(/\s+\d+$/, '').trim(), clear: () => setIndustry('all') });
  if (batchFilter !== 'all') activeChips.push({ label: 'Batch · ' + batchFilter, clear: () => setBatchFilter('all') });
  const activeCount = activeChips.length;

  return (
    <div>
      <style dangerouslySetInnerHTML={{__html: `
        .lp-filter-area {
          background: var(--bg-paper);
          border: 1px solid var(--line);
          border-radius: 2px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }
        
        .lp-filter-row--search {
          display: flex;
          align-items: center;
          gap: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--line);
          margin-bottom: 12px;
          border-radius: 0;
          border-top: none;
          border-left: none;
          border-right: none;
          padding-left: 0;
          padding-right: 0;
        }
        
        .lp-filter-row--search .os-input.search {
          height: 40px;
          font-size: 14px;
          border: 1px solid #c8c8d0;
          border-radius: 4px;
          padding: 0 16px;
          width: 320px;
          transition: all 0.15s ease;
        }
        .lp-filter-row--search .os-input.search:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
          outline: none;
        }
        
        .lp-track-group {
          display: flex;
          background: var(--bg-soft);
          padding: 3px;
          border-radius: 2px;
          border: 1px solid var(--line);
        }
        
        .lp-track-btn {
          background: transparent;
          border: none;
          height: 32px;
          padding: 0 16px;
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 500;
          color: var(--ink-soft);
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.15s ease;
        }
        .lp-track-btn:hover {
          color: var(--ink);
        }
        .lp-track-btn.active {
          background: #fff;
          color: var(--ink);
          box-shadow: 0 1px 3px rgba(36, 36, 36, 0.08);
          font-weight: 600;
        }
        
        .lp-filter-section {
          display: flex;
          align-items: flex-start;
          padding: 12px 0;
          border-bottom: 1px solid var(--line);
          border-radius: 0;
          border-top: none;
          border-left: none;
          border-right: none;
          margin-bottom: 0;
        }
        .lp-filter-section:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        
        .lp-filter-label {
          width: 120px;
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ink-dim);
          padding-top: 10px;
          margin-bottom: 0;
        }
        
        .lp-filter-btns {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          flex: 1;
        }
        
        .lp-filter-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          height: 29px;
          background: var(--bg-paper);
          border: 1px solid var(--line);
          font-family: var(--font-sans);
          font-size: 12.5px;
          font-weight: 500;
          color: var(--ink-soft);
          cursor: pointer;
          border-radius: 999px;
          transition: all 0.15s ease;
        }
        .lp-filter-btn:hover {
          background: var(--bg-soft);
          border-color: var(--line-strong);
          color: var(--ink);
        }
        .lp-filter-btn.active {
          background: var(--ink);
          border-color: var(--ink);
          color: #fff;
        }
        .lp-filter-btn .sdot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        
        .lp-filter-btn-group {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--line);
          background: #fff;
          height: 29px;
          transition: all 0.15s ease;
          margin-right: 0;
          margin-bottom: 0;
        }
        .lp-filter-btn-group:hover {
          border-color: var(--line-strong);
        }
        .lp-filter-btn-group.active {
          border-color: var(--ink);
          background: var(--ink);
        }
        .lp-filter-btn-group .lp-filter-btn {
          border: none !important;
          border-radius: 0 !important;
          margin: 0 !important;
          height: 100%;
          padding: 0 8px 0 14px;
        }
        .lp-filter-btn-group .lp-filter-btn-dots {
          background: transparent;
          border: none;
          border-left: 1px solid var(--line) !important;
          color: var(--ink-dim);
          padding: 0 8px;
          cursor: pointer;
          height: 100%;
          font-size: 14px;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lp-filter-btn-group .lp-filter-btn-dots:hover {
          background: rgba(0, 0, 0, 0.05);
          color: var(--ink);
        }
        .lp-filter-btn-group.active .lp-filter-btn-dots {
          color: rgba(255, 255, 255, 0.7);
          border-left: 1px solid rgba(255, 255, 255, 0.2) !important;
        }
        .lp-filter-btn-group.active .lp-filter-btn-dots:hover {
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
        }
        
        .lp-clear-btn {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 600;
          color: #d23b40;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0 8px;
          transition: all 0.15s ease;
          height: auto;
          line-height: 1;
        }
        .lp-clear-btn:hover {
          color: #c2363b;
          background: transparent;
          text-decoration: underline;
        }
        
        .lp-count {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--ink-dim);
          white-space: nowrap;
          flex-shrink: 0;
        }

        /* Filters toggle (e-commerce style) */
        .lp-filters-toggle {
          display: inline-flex; align-items: center; gap: 7px;
          height: 38px; padding: 0 14px; flex-shrink: 0;
          background: var(--bg-paper); border: 1px solid var(--line-strong);
          border-radius: 999px; cursor: pointer;
          font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--ink);
          transition: all 0.15s ease;
        }
        .lp-filters-toggle:hover { background: var(--bg-soft); border-color: var(--ink-dim); }
        .lp-filters-toggle.is-open { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
        .lp-filters-count {
          display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px;
          background: var(--accent); color: #fff; border-radius: 999px;
          font-size: 11px; font-weight: 700; line-height: 1;
        }
        .lp-filters-caret { font-size: 9px; color: var(--ink-dim); }
        .lp-filters-toggle.is-open .lp-filters-caret { color: var(--accent); }

        /* Applied filter pills */
        .lp-active-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 14px 0 2px; }
        .lp-active-chip {
          display: inline-flex; align-items: center; gap: 8px;
          height: 28px; padding: 0 6px 0 12px;
          background: var(--accent-soft); border: 1px solid transparent;
          border-radius: 999px; cursor: pointer;
          font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--artblue);
          transition: background 0.15s ease;
        }
        .lp-active-chip:hover { background: #cabdf0; }
        .lp-active-chip-x {
          display: inline-grid; place-items: center; width: 16px; height: 16px;
          border-radius: 50%; background: rgba(50,19,183,0.13); font-size: 13px; line-height: 1;
        }
        .lp-active-clear {
          background: none; border: none; cursor: pointer; padding: 0 6px;
          font-family: var(--font-sans); font-size: 12px; font-weight: 600;
          color: var(--ink-dim); text-decoration: underline;
        }
        .lp-active-clear:hover { color: var(--ink); }

        /* Collapsible panel */
        .lp-filter-panel { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 2px; }
      `}} />

      <PageHead
        eyebrow="A-2 · PIPELINE"
        title='All <em>applications</em>'
        sub="Layer 1–4 unified view. Filter, sort, batch-action."
        actions={[<button key="exp" className="os-btn ghost" onClick={() => window.downloadApplicationsCSV(sortedFiltered, 'artpark-applications.csv')}>Export CSV</button>]}
      />

      <div className="lp-filter-area">
        {/* Search + track + Filters toggle */}
        <div className="lp-filter-row--search">
          <div className="os-search-wrap" style={{ flexShrink: 0 }}>
            <input
              className="os-input search"
              placeholder="Search by name, email, or org"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="lp-track-group">
            {[['all', 'All tracks'], ['tir', 'TIR'], ['sip', 'SIP']].map(([v, label]) => (
              <button
                key={v}
                className={`lp-track-btn${track === v ? ' active' : ''}`}
                onClick={() => setTrack(v)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <button
            className={`lp-filters-toggle${filtersOpen ? ' is-open' : ''}`}
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            <span>Filters</span>
            {activeCount > 0 && <span className="lp-filters-count">{activeCount}</span>}
            <span className="lp-filters-caret">{filtersOpen ? '▴' : '▾'}</span>
          </button>

          <span className="lp-count">{filtered.length} of {S.length}</span>
        </div>

        {/* Applied filters as removable pills */}
        {activeChips.length > 0 && (
          <div className="lp-active-chips">
            {activeChips.map((c, i) => (
              <button key={i} className="lp-active-chip" onClick={c.clear} title="Remove filter">
                <span>{c.label}</span>
                <span className="lp-active-chip-x">×</span>
              </button>
            ))}
            <button className="lp-active-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}

        {/* Collapsible filter panel */}
        {filtersOpen && (
          <div className="lp-filter-panel">
            {/* STATUS */}
            <div className="lp-filter-section">
              <span className="lp-filter-label">STATUS</span>
              <div className="lp-filter-btns">
                {STATUSES.map(st => (
                  <button
                    key={st.id}
                    className={`lp-filter-btn${status === st.id ? ' active' : ''}`}
                    onClick={() => setStatus(st.id)}
                  >
                    {st.color && <span className="sdot" style={{ background: st.color }} />}
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* INDUSTRY */}
            <div className="lp-filter-section">
              <span className="lp-filter-label">INDUSTRY</span>
              <div className="lp-filter-btns">
                <button
                  className={`lp-filter-btn${industry === 'all' ? ' active' : ''}`}
                  onClick={() => setIndustry('all')}
                >
                  All
                </button>
                {INDUSTRIES.map(ind => (
                  <button
                    key={ind}
                    className={`lp-filter-btn${industry === ind ? ' active' : ''}`}
                    onClick={() => setIndustry(ind)}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            {/* BATCH */}
            <div className="lp-filter-section">
              <span className="lp-filter-label">BATCH</span>
              <div className="lp-filter-btns" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <button
                  className={`lp-filter-btn${batchFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setBatchFilter('all')}
                >
                  All
                </button>
                <button
                  className={`lp-filter-btn${batchFilter === 'Unassigned' ? ' active' : ''}`}
                  onClick={() => setBatchFilter('Unassigned')}
                >
                  Unassigned
                </button>
                {getAvailableBatches().map(b => (
                  <div key={b} className={`lp-filter-btn-group${batchFilter === b ? ' active' : ''}`}>
                    <button
                      className={`lp-filter-btn${batchFilter === b ? ' active' : ''}`}
                      onClick={() => setBatchFilter(b)}
                    >
                      {b}
                    </button>
                    <button
                      className="lp-filter-btn-dots"
                      onClick={(e) => {
                        e.stopPropagation();
                        renameBatch(b);
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                ))}
                <button
                  className="lp-filter-btn"
                  style={{ borderStyle: 'dashed', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
                  onClick={() => {
                    const name = prompt("Enter new batch name:");
                    if (name) {
                      if (!window.OS_DATA.BATCHES) {
                        window.OS_DATA.BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Batch D', 'Batch E'];
                      }
                      if (!window.OS_DATA.BATCHES.includes(name)) {
                        window.OS_DATA.BATCHES.push(name);
                        if (window.persistOSData) window.persistOSData();
                        forceUpdate();
                      }
                    }
                  }}
                >
                  + Create Batch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <table className="os-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input 
                type="checkbox" 
                checked={selectedIds.length === filtered.length && filtered.length > 0} 
                onChange={toggleAll} 
              />
            </th>
            {renderHeader('PROJECT', 'name')}
            {renderHeader('FOUNDER', 'founder')}
            {renderHeader('INDUSTRY', 'domain')}
            {renderHeader('STAGE', 'stage')}
            {renderHeader('Reviewer score', 'rev', true)}
            {renderHeader('STATUS', 'status')}
            {renderHeader('BATCH', 'batch')}
            {renderHeader('SUBMITTED', 'sub')}
            {renderHeader('ID', 'id')}
          </tr>
        </thead>
        <tbody>
          {sortedFiltered.map(s => {
            const isHidden = s.hidden;
            return (
              <tr 
                key={s.id} 
                style={{ cursor: 'pointer', opacity: isHidden ? 0.45 : 1 }} 
                onClick={() => goDetail(s.id)}
              >
                <td onClick={e => e.stopPropagation()} style={{ width: 40 }}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(s.id)} 
                    onChange={() => toggleSelect(s.id)} 
                  />
                </td>
                <td style={{ fontWeight: 600 }}>
                  {s.name}
                  {isHidden && <span className="os-chip red" style={{ fontSize: 9, padding: '1px 4px', marginLeft: 6 }}>HIDDEN</span>}
                </td>
                <td>{s.founders[0]}</td>
                <td className="os-text-soft">{s.domain}</td>
                <td className="os-text-soft">{s.stage}</td>
                <td className="num">
                  {s.rev && s.rev.overall != null ? (
                    <b>{s.rev.overall.toFixed(1)}</b>
                  ) : (
                    <span className="os-text-soft">—</span>
                  )}
                </td>
                <td>
                  <Chip tone={getChipTone(s)}>{getFriendlyStatus(s).toUpperCase()}</Chip>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <select
                    className="os-select sm"
                    style={{ padding: '2px 6px', fontSize: 12, height: 26 }}
                    value={s.batch || 'Unassigned'}
                    onChange={e => changeIndividualBatch(s, e.target.value)}
                  >
                    <option value="Unassigned">Unassigned</option>
                    {getAvailableBatches().map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                    <option value="new">+ New Batch...</option>
                  </select>
                </td>
                <td>{s.sub}</td>
                <td className="os-mono os-text-xs">TIR-{s.id.replace('s', '').padStart(5, '0')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedIds.length > 0 && (
        <div className="os-floating-bar">
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes slideDown {
              from { transform: translate(-50%, -100px); opacity: 0; }
              to { transform: translate(-50%, 0); opacity: 1; }
            }
            .os-floating-bar {
              position: fixed;
              top: 24px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(239, 246, 255, 0.96);
              backdrop-filter: blur(12px);
              border: 1.5px solid #3213b7;
              color: var(--ink);
              padding: 10px 20px;
              border-radius: 2px;
              display: flex;
              gap: 10px;
              align-items: center;
              box-shadow: 0 10px 30px rgba(37, 99, 235, 0.15), 0 1px 3px rgba(37, 99, 235, 0.05);
              z-index: 1000;
              animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .os-floating-count {
              font-family: var(--font-sans);
              font-size: 12px;
              font-weight: 600;
              color: #1f0a8a;
              background: #e9e4fb;
              padding: 4px 10px;
              border-radius: 4px;
              border: 1px solid #cdc4f1;
              white-space: nowrap;
            }
            .os-floating-btn {
              background: var(--bg-paper);
              border: 1px solid var(--line);
              color: var(--ink-soft);
              font-family: var(--font-sans);
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              padding: 0 12px;
              border-radius: 4px;
              transition: all 0.15s ease;
              height: 32px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              white-space: nowrap;
            }
            .os-floating-btn:hover {
              background: var(--bg-soft);
              border-color: var(--line-strong);
              color: var(--ink);
            }
            .os-floating-btn.primary {
              background: var(--ink);
              border-color: var(--ink);
              color: #fff;
            }
            .os-floating-btn.primary:hover {
              background: var(--accent);
              border-color: var(--accent);
              color: #fff;
            }
            .os-floating-btn.danger-outline {
              background: #fff;
              border-color: #ffe4e4;
              color: #d23b40;
            }
            .os-floating-btn.danger-outline:hover {
              background: #fff0f0;
              border-color: #f8c2c4;
              color: #c2363b;
            }
            .os-floating-select {
              height: 32px;
              padding: 0 24px 0 10px;
              border: 1px solid var(--line);
              background: #fff;
              font-family: var(--font-sans);
              font-size: 12px;
              font-weight: 600;
              color: var(--ink-soft);
              border-radius: 4px;
              outline: none;
              cursor: pointer;
              transition: all 0.15s ease;
              appearance: none;
              -webkit-appearance: none;
            }
            .os-floating-select:hover {
              border-color: var(--line-strong);
              color: var(--ink);
            }
            .os-floating-select:focus {
              border-color: var(--accent);
            }
            .os-floating-select-wrap {
              position: relative;
              display: inline-block;
            }
            .os-floating-select-wrap::after {
              content: "▾";
              position: absolute;
              right: 10px;
              top: 50%;
              transform: translateY(-50%);
              color: var(--ink-dim);
              font-size: 11px;
              pointer-events: none;
            }
          `}} />
          <span className="os-floating-count">
            {selectedIds.length} selected
          </span>
          <div style={{ width: 1, height: 16, background: 'var(--line)' }} />
          <button className="os-floating-btn" onClick={handleBulkHold}>Hold</button>
          <button className="os-floating-btn primary" onClick={handleBulkNextLevel}>Send to Next Level</button>
          <button className="os-floating-btn danger-outline" onClick={handleBulkReject}>Reject</button>
          <button className="os-floating-btn" onClick={handleBulkToggleHide}>Hide / Unhide</button>
          <button className="os-floating-btn" onClick={handleBulkArchive}>Archive</button>
          <div style={{ width: 1, height: 16, background: 'var(--line)' }} />
          <div className="os-floating-select-wrap">
            <select
              className="os-floating-select"
              value=""
              onChange={e => applyBatchToSelected(e.target.value)}
            >
              <option value="" disabled>Assign batch...</option>
              <option value="Unassigned">Unassigned</option>
              {getAvailableBatches().map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
              <option value="new">+ Create New Batch...</option>
            </select>
          </div>
        </div>
      )}
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

// ── Application-content normalisation (shared with the reviewer module) ──────
// Renders ANY field as scannable 1-sentence bullets, regardless of how it's sent:
//   • field.bullets (array)        -> used as-is               (preferred shape)
//   • field.value with "•" markers -> split on the markers
//   • field.value as a paragraph   -> auto-split into 1-sentence bullets
// A field renders as a compact "fact" tile when flagged short or it's a brief clause.
function fieldBullets(f) {
  if (Array.isArray(f.bullets)) return f.bullets.map(String);
  const text = String(f.value || "").trim();
  if (!text) return [];
  if (/[•·]\s/.test(text)) return text.split(/\s*[•·]\s+/).map(x => x.trim()).filter(Boolean);
  // Protect decimals + common abbreviations, then split on sentence-end + capital/quote.
  const protectedText = text
    .replace(/(\d)\.(\d)/g, "$1~D~$2")
    .replace(/\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Inc|Ltd|No|Fig|Rs|approx)\./gi, "$1~D~");
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z₹"'(])/)
    .map(x => x.split("~D~").join(".").trim())
    .filter(Boolean);
}
function isFactField(f) {
  if (f.short === true) return true;
  if (Array.isArray(f.bullets)) return false;
  const v = String(f.value || '');
  return v.length <= 48 && !/[.!?]/.test(v);
}

const CRIT_LABELS = {
  problem: 'Problem Statement Impact and Importance',
  solution: 'Completeness, Depth of Solution',
  tech: 'Technical Depth',
  founders: 'Professional Profile of Founder',
  commit: 'Commitment to be fully available'
};

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
  const pill = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', fontWeight: 600, color: PURPLE, border: '1px solid #cdc4f1', background: '#efecfb', padding: '4px 11px', borderRadius: 999 };
  const pillGhost = { ...pill, color: 'var(--ink-dim)', border: '1px solid var(--line)', background: 'transparent' };
  const answerBox = { background: '#fff', border: '1px solid var(--line)', borderRadius: 2, padding: '18px 22px', fontSize: 16, lineHeight: 1.62, color: 'var(--ink)' };

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
              <span style={{ background: '#bcd7cd', color: '#234f45', padding: '2px 7px', fontWeight: 700 }}>SECTION</span>
              <span className="os-text-dim" style={{ marginLeft: 8 }}>{sec.num}</span>
            </span>
            <span className="os-text-dim" style={eyebrowMono}>OF 06</span>
          </div>

          <div style={{ fontSize: 72, fontWeight: 800, color: PURPLE, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{sec.num}</div>
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

// ============ A-3 Detail ============
function AdminDetail({ startupId, onBack, onPrev, onNext }) {
  const startups = window.OS_DATA.STARTUPS;
  const s = startups.find(x => x.id === startupId) || startups[0];
  const [secOpen, setSecOpen] = useAS({});
  const [viewApp, setViewApp] = useAS(false);
  const [decision, setDecision] = useAS(
    s.adminDecision === 'APPROVED' || s.chip === 'SHORTLISTED' || s.chip === 'ACCEPTED' ? 'approve' : s.adminDecision === 'REJECTED' || s.chip === 'REJECTED' ? 'reject' : 'hold'
  );
  const [rationale, setRationale] = useAS(s.adminRationale || '');

  const onApplyDecision = () => {
    // Update status
    if (decision === 'approve') {
      s.chip = 'SHORTLISTED';
      s.adminDecision = 'APPROVED';
    } else if (decision === 'hold') {
      s.chip = 'HOLD';
      s.adminDecision = 'HOLD';
    } else if (decision === 'reject') {
      s.chip = 'REJECTED';
      s.adminDecision = 'REJECTED';
    }
    s.adminRationale = rationale;

    // Add activity log
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    window.OS_DATA.ACTIVITY.unshift({
      ts: timeStr,
      actor: 'Admin',
      what: `marked ${s.name} as ${s.chip}`,
      type: 'gate'
    });

    if (window.persistOSData) window.persistOSData();
    onBack();
  };

  const METRICS = [
    { key: 'problem', label: 'Problem Statement Impact and Importance' },
    { key: 'solution', label: 'Completeness, Depth of Solution' },
    { key: 'tech', label: 'Technical Depth' },
    { key: 'founders', label: 'Professional Profile of Founder' },
    { key: 'commit', label: 'Commitment to be fully available' }
  ];

  if (viewApp) {
    return <FullApplicationView s={s} onBack={() => setViewApp(false)} />;
  }

  return (
    <div>
      <div className="lp-section-head">
        <div>
          <div className="lp-breadcrumb">
            <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ color: '#6f6f78', textDecoration: 'none' }}>Applications</a>
            <span style={{ margin: '0 8px', color: '#c8c8d0' }}>/</span>
            <span style={{ color: '#8a8a92' }}>{s.name}</span>
          </div>
          <span className="lp-section-eyebrow" style={{ marginTop: 12 }}>APPLICATION DETAIL</span>
          <h2 className="lp-section-title">{s.name} <span className="lp-muted">· admin review</span></h2>
          <div className="lp-section-sub">
            {s.founders.join(' · ')} · {s.domain} · {s.stage} · Submitted {s.sub}
          </div>
        </div>
        <div className="lp-section-actions">
          <div className="os-row gap-sm">
            {onPrev && <button className="os-btn ghost sm" onClick={onPrev}>← Prev application</button>}
            {onNext && <button className="os-btn ghost sm" onClick={onNext}>Next application →</button>}
          </div>
          <div className="os-row gap-sm">
            <button className="os-btn secondary" onClick={onBack}>← Back to applications</button>
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        {/* LEFT — application & score summaries */}
        <div className="os-stack">
          {/* Application Details Card */}
          <div className="os-card">
            <div className="os-card-head">
              <div className="os-card-title">Application · {s.name}</div>
              <div className="os-row gap-sm">
                <Chip>{s.domain}</Chip><Chip>{s.stage}</Chip><Chip>TRL {s.trl}</Chip>
              </div>
            </div>
            <div className="os-stack">
              {/* AI summary — pinned TL;DR card (ARTBlue-led, restrained per brand) */}
              <div className="ps-ai-summary">
                <div className="ps-ai-label">AI summary</div>
                <p className="ps-ai-text">{APP_DETAIL.aiSummary}</p>
              </div>

              {/* Problem & solution — quick-fact tiles + collapsible bullet sections */}
              <div>
                <div className="ps-group-label">Problem &amp; solution</div>

                {APP_DETAIL.fields.some(isFactField) && (
                  <div className="ps-facts">
                    {APP_DETAIL.fields.filter(isFactField).map((f, i) => (
                      <div className="ps-fact" key={i}>
                        <span className="ps-fact-label">{f.label}</span>
                        <span className="ps-fact-value">{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ps-sections">
                  {APP_DETAIL.fields.filter(f => !isFactField(f)).map((f, i) => {
                    const open = (f.label in secOpen) ? secOpen[f.label] : (i === 0);
                    const pts = fieldBullets(f);
                    return (
                      <div className={"ps-sec" + (open ? " is-open" : "")} key={i}>
                        <button className="ps-sec-head" aria-expanded={open}
                          onClick={() => setSecOpen(prev => ({ ...prev, [f.label]: !open }))}>
                          <span className="ps-sec-chev">{open ? '▾' : '▸'}</span>
                          <span className="ps-sec-label">{f.label}</span>
                          <span className="ps-sec-hint">{open ? '' : pts.length + ' points'}</span>
                        </button>
                        {open && (
                          <ul className="ps-bullets">
                            {pts.map((b, j) => <li key={j}>{b}</li>)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <hr className="os-divider"/>

              <button className="os-btn secondary os-w-100" onClick={() => setViewApp(true)}>
                View full application →
              </button>
            </div>
          </div>

          {window.ComparativeReviewModel && <window.ComparativeReviewModel startup={s} />}
        </div>

        {/* RIGHT — Averages, Flags, Decision */}
        <div className="os-stack">
          {/* Average Scores Card */}
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Reviewer Scores</div>
            <div className="os-stack gap-sm">
              {METRICS.map(m => {
                const revVal = window.calculateWeightedReviewerAverage ? window.calculateWeightedReviewerAverage(s, m.key) : (s.rev ? s.rev[m.key] : 0);
                return (
                  <div key={m.key}>
                    <div className="os-row between os-text-sm">
                      <span className="os-text-soft">{m.label}</span>
                      <span className="os-mono font-bold" style={{ fontWeight: 600 }}>{revVal.toFixed(1)}</span>
                    </div>
                    <div className="os-scorebar-track" style={{ marginTop: 4 }}>
                      <div className="os-scorebar-fill" style={{ width: (revVal * 10) + '%', background: `var(--cat-${m.key})` }} />
                    </div>
                  </div>
                );
              })}
              <hr className="os-divider" style={{ margin: '8px 0' }} />
              <div className="os-row between">
                <span className="os-text-xs os-text-dim os-uppercase">Reviewer Overall</span>
                <span className="os-num-big" style={{ fontSize: 24, fontFamily:'var(--font-sans)', fontWeight: 800, color:'#242424' }}>
                  {(window.calculateWeightedReviewerAverage ? window.calculateWeightedReviewerAverage(s, 'overall') : (s.rev ? s.rev.overall : 0)).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Flags raised card */}
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Flags Raised</div>
            {s.flags && s.flags.length ? s.flags.map((f, i) => (
              <div key={i} className="os-row gap-sm os-mb-sm">
                <span className="os-chip red" style={{ background: '#fff0f0', color: '#d23b40', border: '1px solid #ffe4e4' }}>⚐</span>
                <span className="os-text-sm" style={{ color: '#4a4a52' }}>{f}</span>
              </div>
            )) : <div className="os-text-dim os-text-sm">No flags raised on this application.</div>}
          </div>

          {/* Admin Decision Card */}
          <div className="os-card">
            <div className="os-text-xs os-text-dim os-uppercase os-mb-sm">DECIDE</div>
            <div className="os-reco-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <button
                className={`os-reco-btn${decision === 'approve' ? ' active yes' : ''}`}
                style={decision === 'approve' ? { background: '#3213b7', color: '#fff', borderColor: '#3213b7' } : {}}
                onClick={() => setDecision('approve')}
              >
                Approve
              </button>
              <button
                className={`os-reco-btn${decision === 'hold' ? ' active maybe' : ''}`}
                onClick={() => setDecision('hold')}
              >
                Hold
              </button>
              <button
                className={`os-reco-btn${decision === 'reject' ? ' active no' : ''}`}
                onClick={() => setDecision('reject')}
              >
                Reject
              </button>
            </div>
            
            <div className="os-mt-sm" style={{ fontSize: 12, color: '#6f6f78', fontStyle: 'italic' }}>
              Approval will invite to psychometry
            </div>

            <textarea
              className="os-input os-w-100 os-mt"
              rows="3"
              style={{ fontSize: 13.5 }}
              placeholder="Decision rationale (optional)…"
              value={rationale}
              onChange={e => setRationale(e.target.value)}
            />

            <button
              className="os-btn os-w-100 os-mt"
              style={{ background: '#3213b7', color: '#fff', fontWeight: 600 }}
              onClick={onApplyDecision}
            >
              Apply decision
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RadarOverlay({ aiData, revData }) {
  const keys = Object.keys(aiData);
  const size = 280, cx = size/2, cy = size/2, r = size/2 - 38;
  const angleAt = (i) => -Math.PI/2 + (2*Math.PI*i)/keys.length;
  const point = (val, i) => {
    const rr = (val/10) * r;
    return [cx + rr*Math.cos(angleAt(i)), cy + rr*Math.sin(angleAt(i))];
  };
  const grid = [2,4,6,8,10].map(n => keys.map((_,i) => point(n, i).join(',')).join(' '));
  const polyAi = keys.map((k,i) => point(aiData[k], i).join(',')).join(' ');
  const polyRev = keys.map((k,i) => point(revData[k], i).join(',')).join(' ');
  return (
    <svg className="os-radar" viewBox={'0 0 ' + size + ' ' + size}>
      {grid.map((g,i) => <polygon key={i} points={g} className="grid"/>) }
      {keys.map((_,i) => {
        const [x,y] = point(10, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#c8c8d0" strokeWidth="1" strokeDasharray="2 3" />;
      })}
      <polygon points={polyAi}  fill="rgba(107,92,255,0.18)"  stroke="var(--l2-cyan)"  strokeWidth="1.5"/>
      <polygon points={polyRev} fill="rgba(47,111,98,0.15)"   stroke="var(--ok)"       strokeWidth="1.5" strokeDasharray="4 3"/>
      {keys.map((k,i) => {
        const [x,y] = point(11.5, i);
        return <text key={'t'+i} x={x} y={y} textAnchor="middle" dy="4">{k}</text>;
      })}
    </svg>
  );
}

// Make components globally available for next file
Object.assign(window, { AdminDashboard, AdminPipeline, AdminDetail, NAV_ADMIN });
