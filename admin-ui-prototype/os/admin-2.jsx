// ADMIN PORTAL pt 2 — A-4 Gate Review (3 variants), A-5 Reviewers, A-6 AI Pipeline, A-7 Audit

const { useState: useAS2 } = React;

const globalGetJuryMetricScore = (scores, key, startupId) => {
  let val = scores ? scores[key] : null;
  if (val == null || val < 5) {
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + key.charCodeAt(0) + 12;
    val = 5.0 + (seed % 45) * 0.1;
  }
  return parseFloat(val.toFixed(1));
};

const globalGetJuryAvg = (st) => {
  if (!st.jury) return 0;
  const allJury = (window.OS_DATA && window.OS_DATA.JURY) || [];
  const assigned = allJury.filter(j => st.juryAssigned && st.juryAssigned.includes(j.id));
  const list = assigned.length > 0 ? assigned : [{ id: 'j0', name: 'Jury Panel' }];
  let sum = 0;
  list.forEach((j, ji) => {
    const scores = ji === 0 ? st.jury : (st.juryScores && st.juryScores[j.id]) || st.jury;
    sum += globalGetJuryMetricScore(scores, 'problem', st.id);
    sum += globalGetJuryMetricScore(scores, 'solution', st.id);
    sum += globalGetJuryMetricScore(scores, 'tech', st.id);
    sum += globalGetJuryMetricScore(scores, 'founders', st.id);
    sum += globalGetJuryMetricScore(scores, 'commit', st.id);
  });
  return sum / (list.length * 5);
};

// On-brand identity marks (replacing decorative emojis) — initials monograms + AI badge.
function revInitials(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function ReviewerAvatar({ name, size = 20, primary = false }) {
  return (
    <span className="os-avatar" style={{
      width: size, height: size, fontSize: Math.round(size * 0.42), flexShrink: 0,
      background: primary ? 'var(--brand-violet)' : 'var(--accent-soft)',
      color: primary ? '#fff' : 'var(--artblue)'
    }}>{revInitials(name)}</span>
  );
}
function AIBadge({ size = 20 }) {
  return (
    <span className="os-avatar" style={{
      width: size, height: size, fontSize: Math.round(size * 0.4), flexShrink: 0,
      background: 'var(--artblue)', color: '#fff', letterSpacing: '0.02em'
    }}>AI</span>
  );
}

function getThreeReviewers(s) {
  if (!s.rev) return [];
  
  const rev1 = {
    name: 'Vikram Sundar',
    overall: s.rev.overall,
    problem: s.rev.problem,
    solution: s.rev.solution,
    tech: s.rev.tech,
    founders: s.rev.founders,
    commit: s.rev.commit,
    integrity: s.rev.integrity,
    notes: s.rev.notes || 'Strong alignment with project goals. Clear path to milestone.',
    reco: s.rev.reco || 'yes',
    flags: s.flags || []
  };

  const offset2 = (s.name.charCodeAt(0) % 3 - 1) * 0.4;
  const rev2 = {
    name: 'Priya Sharma',
    overall: Math.min(10, Math.max(1, s.rev.overall + offset2 + 0.2)),
    problem: Math.min(10, Math.max(1, s.rev.problem + (offset2 > 0 ? 0.3 : -0.3))),
    solution: Math.min(10, Math.max(1, s.rev.solution + (offset2 > 0 ? -0.4 : 0.4))),
    tech: Math.min(10, Math.max(1, s.rev.tech + 0.2)),
    founders: Math.min(10, Math.max(1, s.rev.founders - 0.3)),
    commit: Math.min(10, Math.max(1, s.rev.commit + offset2)),
    integrity: Math.min(10, Math.max(1, s.rev.integrity)),
    notes: s.rev.overall > 7 
      ? 'Excellent value proposition and solid architecture design.' 
      : 'Viable technical proposal, but clear competitors exist.',
    reco: s.rev.overall + offset2 > 7.5 ? 'yes' : 'maybe',
    flags: offset2 < 0 ? ['Market competition risk'] : []
  };

  const offset3 = (s.name.charCodeAt(1) % 3 - 1) * 0.5;
  const rev3 = {
    name: 'Amit Patel',
    overall: Math.min(10, Math.max(1, s.rev.overall + offset3 - 0.3)),
    problem: Math.min(10, Math.max(1, s.rev.problem - 0.2)),
    solution: Math.min(10, Math.max(1, s.rev.solution + 0.3)),
    tech: Math.min(10, Math.max(1, s.rev.tech - 0.4)),
    founders: Math.min(10, Math.max(1, s.rev.founders + 0.4)),
    commit: Math.min(10, Math.max(1, s.rev.commit + offset3)),
    integrity: Math.min(10, Math.max(1, s.rev.integrity)),
    notes: s.rev.overall > 7.5
      ? 'Strong founder chemistry. Tech complexity is moderate but realistic.'
      : 'Initial product looks solid but unit economics need further definition.',
    reco: s.rev.overall + offset3 > 8.0 ? 'yes' : (s.rev.overall + offset3 > 6.0 ? 'maybe' : 'no'),
    flags: offset3 < -0.2 ? ['Unit economics concerns'] : []
  };

  return [rev1, rev2, rev3];
}
window.getThreeReviewers = getThreeReviewers;

// Apply an admin decision to a startup and persist it. Shared by all Admin Review variants.
function applyGateDecision(st, decision, note) {
  if (!st) return;
  const d = (decision || '').toLowerCase();
  if (d === 'approve' || d === 'approved') { st.chip = 'SHORTLISTED'; st.adminDecision = 'APPROVED'; }
  else if (d === 'waitlist' || d === 'waitlisted') { st.chip = 'WAITLISTED'; st.adminDecision = 'WAITLISTED'; }
  else if (d === 'hold') { st.chip = 'HOLD'; st.adminDecision = 'HOLD'; }
  else if (d === 'reject' || d === 'rejected') { st.chip = 'REJECTED'; st.adminDecision = 'REJECTED'; }
  if (note != null && note !== '') st.adminRationale = note;
  if (window.persistOSData) window.persistOSData();
}
window.applyGateDecision = applyGateDecision;

// Build + download a CSV from a list of startups (client-side export).
function downloadApplicationsCSV(rows, filename) {
  const cols = ['ID','Project','Founder','Industry','Stage','Reviewer Score','Status','Batch','Submitted'];
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [cols.map(esc).join(',')];
  rows.forEach(s => {
    lines.push([
      s.id || '',
      s.name || '',
      (s.founders && s.founders[0]) || '',
      s.domain || '',
      s.stage || '',
      (s.rev && s.rev.overall != null) ? s.rev.overall.toFixed(1) : '',
      (window.getFriendlyStatus ? window.getFriendlyStatus(s) : (s.chip || '')),
      s.batch || 'Unassigned',
      s.sub || '',
    ].map(esc).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'applications.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.downloadApplicationsCSV = downloadApplicationsCSV;

function getReviewerWeight(name) {
  if (!name) return 1.0;
  const R = window.OS_DATA?.REVIEWERS || [];
  const found = R.find(r => r.name && r.name.toLowerCase() === name.toLowerCase());
  return found && typeof found.weight === 'number' ? found.weight : 1.0;
}
window.getReviewerWeight = getReviewerWeight;

function calculateWeightedReviewerAverage(s, metricKey) {
  const reviewers = getThreeReviewers(s);
  if (reviewers.length === 0) return 0;
  
  let totalWeight = 0;
  let weightedSum = 0;
  reviewers.forEach(r => {
    const weight = getReviewerWeight(r.name);
    const score = r[metricKey];
    if (typeof score === 'number') {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  });
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
window.calculateWeightedReviewerAverage = calculateWeightedReviewerAverage;

function generateBasicPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pass = 'Pass-';
  for (let i = 0; i < 6; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}
window.generateBasicPassword = generateBasicPassword;

function ComparativeReviewModel({ startup }) {
  const s = startup;
  if (!s.rev) return null;

  const reviewers = getThreeReviewers(s);
  if (reviewers.length === 0) return null;

  const CRITERIA = [
    { key: 'problem', short: 'Problem statement' },
    { key: 'solution', short: 'Solution depth' },
    { key: 'tech', short: 'Technical depth' },
    { key: 'founders', short: 'Founder profile' },
    { key: 'commit', short: 'Commitment' },
  ];

  const maxWeight = Math.max(...reviewers.map(r => getReviewerWeight(r.name)));
  const primaryReviewer = reviewers.find(r => {
    const w = getReviewerWeight(r.name);
    return w > 1.0 && w === maxWeight;
  });

  return (
    <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="cem-kicker">&sect; Reviewer Evaluation</span>
        <h3 className="cem-title">Human Reviewers Consensus</h3>
      </div>

      <div className="rv-grid">
        {reviewers.map((r, i) => {
          const isPrimary = primaryReviewer && r.name === primaryReviewer.name;
          const weight = getReviewerWeight(r.name);
          return (
            <div key={i} className={"rv-card" + (isPrimary ? " is-primary" : "")}>
              <div className="rv-card-head">
                <div className="rv-card-id">
                  <ReviewerAvatar name={r.name} size={38} primary={isPrimary} />
                  <div style={{ minWidth: 0 }}>
                    <div className="rv-card-name">{r.name}</div>
                    <div className="rv-card-role">{isPrimary ? `Primary · weight ${weight.toFixed(0)}` : `Reviewer · weight ${weight.toFixed(0)}`}</div>
                  </div>
                </div>
                <span className={`os-chip ${r.reco === 'yes' ? 'green' : (r.reco === 'maybe' ? 'amber' : 'red')}`} style={{ flexShrink: 0 }}>
                  {(r.reco || 'maybe').toUpperCase()}
                </span>
              </div>

              <div className="rv-overall">
                <span className="rv-overall-label">Overall rating</span>
                <span className="rv-overall-num">{r.overall != null ? r.overall.toFixed(1) : '—'}</span>
              </div>

              <div className="rv-scores">
                {CRITERIA.map((m, j) => {
                  const val = r[m.key];
                  return (
                    <div className="rv-score" key={j}>
                      <span className="rv-score-label">{m.short}</span>
                      <span className="rv-bar"><span className="rv-bar-fill" style={{ width: Math.max(0, Math.min(100, (val || 0) * 10)) + '%' }} /></span>
                      <span className="rv-score-num">{val != null ? val.toFixed(1) : '—'}</span>
                    </div>
                  );
                })}
              </div>

              <div className="rv-note">
                <span className="rv-block-label">Reviewer note</span>
                <p className="rv-note-text">{r.notes}</p>
              </div>

              <div className="rv-flags">
                <span className="rv-block-label">Flags raised ({r.flags.length})</span>
                {r.flags.length > 0 ? (
                  <div className="rv-flag-list">
                    {r.flags.map((f, idx) => (
                      <div className="rv-flag" key={idx}><span className="rv-flag-mark">⚑</span><span>{f}</span></div>
                    ))}
                  </div>
                ) : (
                  <span className="rv-flags-empty">No flags raised.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
window.ComparativeReviewModel = ComparativeReviewModel;

// ============ A-4 Gate 1 Review · Variant A "Decision Stack" ============
function GateReviewStack() {
  const items = window.OS_DATA.STARTUPS.filter(s => s.rev).slice(0, 8);
  const [idx, setIdx] = useAS2(0);
  const [decisions, setDecisions] = useAS2(() => {
    const init = {};
    items.forEach(it => {
      const ad = (it.adminDecision || '').toUpperCase();
      if (ad === 'APPROVED') init[it.id] = 'approve';
      else if (ad === 'WAITLISTED' || ad === 'HOLD') init[it.id] = 'waitlist';
      else if (ad === 'REJECTED') init[it.id] = 'reject';
    });
    return init;
  });
  const [notes, setNotes] = useAS2({});
  const s = items[idx];
  const decide = (d) => {
    setDecisions({ ...decisions, [s.id]: d });
    applyGateDecision(s, d, notes[s.id]);
    if (idx < items.length - 1) setTimeout(() => setIdx(idx+1), 200);
  };
  const decided = Object.keys(decisions).length;

  const counts = { approve: 0, waitlist: 0, reject: 0 };
  Object.values(decisions).forEach(d => {
    if (counts[d] !== undefined) counts[d]++;
  });

  return (
    <div>
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT A · STATUS</span>
          <span className="os-text-soft">Decide one application at a time.</span>
        </div>
        <span className="os-mono os-text-sm">{decided} / {items.length} decided</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 280px))', gap: 14, marginBottom: 24 }}>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Applications</span>
          <span className="gate-kpi-num">{items.length}</span>
          <span className="gate-kpi-sub">Reviewer-evaluated this gate</span>
        </div>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Live Decisions</span>
          <div style={{ display: 'flex', gap: 26, marginTop: 8 }}>
            {[['Approve', counts.approve, '#2F6F62'], ['Waitlist', counts.waitlist, '#FFB703'], ['Reject', counts.reject, '#FF5A5F']].map(([label, n, c]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 400, lineHeight: 1, color: 'var(--ink)' }}>{n}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />{label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-row gap-sm">
              <span className="os-mono os-text-xs os-text-dim">{idx+1}/{items.length}</span>
              <FlagDot tone={s.flag} />
              <span style={{ fontSize: 22, fontFamily: 'var(--font-serif)' }}>{s.name}</span>
              <span className="os-chip">{s.domain}</span>
              <span className="os-chip">{s.stage}</span>
            </div>
            <div className="os-row gap-sm">
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.max(0, idx-1))}>← Prev</button>
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.min(items.length-1, idx+1))}>Next →</button>
            </div>
          </div>

          <div style={{ padding: '0 0 20px 0' }}>
            <ComparativeReviewModel startup={s} />
          </div>
        </div>

        <div className="os-stack">
          <div className="os-card" style={{ background: 'var(--artlight)', border: '1px solid transparent' }}>
            <div className="os-row between" style={{ alignItems: 'center' }}>
              <div>
                <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: '0.12em', color: 'var(--artblue)' }}>Reviewer Overall</span>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Weighted reviewer consensus</div>
              </div>
              <span className="os-num-big" style={{ fontSize: 34, fontFamily: 'var(--font-serif)', fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--artblue)' }}>
                {(window.calculateWeightedReviewerAverage ? window.calculateWeightedReviewerAverage(s, 'overall') : (s.rev ? s.rev.overall : 0)).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Decision</div>
            <div className="os-reco-group">
              <button className={'os-reco-btn approve ' + (decisions[s.id]==='approve' ? 'active':'')} onClick={() => decide('approve')}>Approve</button>
              <button className={'os-reco-btn waitlist ' + (decisions[s.id]==='waitlist' ? 'active':'')} onClick={() => decide('waitlist')}>Waitlist</button>
              <button className={'os-reco-btn reject ' + (decisions[s.id]==='reject' ? 'active':'')} onClick={() => decide('reject')}>Reject</button>
            </div>
            <textarea className="os-input os-w-100 os-mt" rows="3" placeholder="Decision rationale (optional)…"
              value={notes[s.id] || ''}
              onChange={e => setNotes({ ...notes, [s.id]: e.target.value })}
              onBlur={() => { s.adminRationale = notes[s.id] || ''; if (window.persistOSData) window.persistOSData(); }}
            />
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Progress</div>
            <div className="os-row gap-sm" style={{ flexWrap: 'wrap' }}>
              {items.map((it,i) => {
                const dec = decisions[it.id];
                const t = dec === 'approve'  ? { bg:'#eef5f1', fg:'#2F6F62', bd:'#bcd7cd' }
                        : dec === 'reject'   ? { bg:'#fff0f0', fg:'#d23b40', bd:'#f8c2c4' }
                        : dec === 'waitlist' ? { bg:'#fff8e6', fg:'#9a6206', bd:'#f6d98a' }
                        : { bg:'var(--bg-soft)', fg:'var(--ink-dim)', bd:'var(--line)' };
                return (
                  <div key={i} onClick={() => setIdx(i)}
                       style={{ width: 26, height: 26, borderRadius: 6, display:'grid', placeItems:'center',
                                background: t.bg, color: t.fg, border: '1px solid ' + t.bd,
                                fontFamily:'var(--font-sans)', fontSize:12, fontWeight:600, cursor:'pointer',
                                outline: i===idx ? '2px solid var(--accent)' : 'none', outlineOffset: 1 }}>{i+1}</div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Variant B "Triage Table" ============
function GateReviewTable() {
  const items = window.OS_DATA.STARTUPS.filter(s => s.rev).slice(0, 12);
  const [decisions, setDecisions] = useAS2(() => {
    const init = {};
    items.forEach(it => {
      const ad = (it.adminDecision || '').toUpperCase();
      if (ad === 'APPROVED') init[it.id] = 'approve';
      else if (ad === 'WAITLISTED' || ad === 'HOLD') init[it.id] = 'waitlist';
      else if (ad === 'REJECTED') init[it.id] = 'reject';
    });
    return init;
  });
  const setDec = (id, d) => setDecisions({ ...decisions, [id]: d });
  const applyAll = () => {
    const n = Object.keys(decisions).length;
    if (n === 0) { window.alert('No decisions to apply yet.'); return; }
    Object.entries(decisions).forEach(([id, d]) => applyGateDecision(items.find(x => x.id === id), d));
    window.alert(n + ' decision' + (n > 1 ? 's' : '') + ' saved.');
  };
  return (
    <div>
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT B · TABLE</span>
          <span className="os-text-soft">Whole-cohort view. Best for batch decisions and comparing across.</span>
        </div>
        <button className="os-btn" onClick={applyAll}>Apply all decisions</button>
      </div>
      <table className="os-table">
        <thead>
          <tr>
            <th>Startup</th>
            <th>Rev</th>
            <th>Categories</th>
            <th>Flags</th>
            <th style={{ width: 280 }}>Decision</th>
          </tr>
        </thead>
        <tbody>
          {items.map(s => (
            <tr key={s.id}>
              <td>
                <div className="os-row gap-sm">
                  <FlagDot tone={s.flag}/>
                  <div className="startup">{s.name}<small>{s.domain} · {s.stage}</small></div>
                </div>
              </td>
              <td className="num"><b>{s.rev.overall.toFixed(1)}</b></td>
              <td>
                <div className="os-row gap-sm" style={{ flexWrap:'wrap' }}>
                  {[['Pr','problem'],['So','solution'],['Te','tech'],['Fo','founders'],['Co','commit']].map(([abbr,k]) => (
                    <span key={abbr} title={abbr} style={{ fontFamily:'var(--font-mono)', fontSize:10, padding:'1px 5px', background:'var(--bg-soft)', border:'1px solid var(--line)' }}>
                      <span style={{ color: 'var(--cat-'+k+')' }}>{abbr}</span> {s.rev[k].toFixed(1)}
                    </span>
                  ))}
                </div>
              </td>
              <td>{s.flags.length > 0 ? <Chip tone="red">{s.flags.length}</Chip> : <span className="os-text-dim">—</span>}</td>
              <td>
                <div className="os-row gap-sm">
                  <button className={'os-btn sm ' + (decisions[s.id]==='approve' ? '' : 'ghost')} style={ decisions[s.id]==='approve' ? { background:'var(--ok)', borderColor:'var(--ok)' } : {} } onClick={() => setDec(s.id,'approve')}>Approve</button>
                  <button className={'os-btn sm ' + (decisions[s.id]==='waitlist' ? '' : 'ghost')} style={ decisions[s.id]==='waitlist' ? { background:'var(--warn)', borderColor:'var(--warn)' } : {} } onClick={() => setDec(s.id,'waitlist')}>Waitlist</button>
                  <button className={'os-btn sm ' + (decisions[s.id]==='reject' ? '' : 'ghost')} style={ decisions[s.id]==='reject' ? { background:'var(--bad)', borderColor:'var(--bad)' } : {} } onClick={() => setDec(s.id,'reject')}>Reject</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ Variant C "Histogram + Cutoff" ============
function GateReviewCutoff() {
  const items = window.OS_DATA.STARTUPS.filter(s => s.rev).slice(0, 14);
  const [cutoff, setCutoff] = useAS2(7.0);
  const sorted = items.slice().sort((a,b) => b.rev.overall - a.rev.overall);
  const above = sorted.filter(s => s.rev.overall >= cutoff);
  const below = sorted.filter(s => s.rev.overall < cutoff);
  const applyCutoff = () => {
    above.forEach(s => applyGateDecision(s, 'approve'));
    below.forEach(s => applyGateDecision(s, 'reject'));
    window.alert('Applied: ' + above.length + ' approved, ' + below.length + ' rejected.');
  };

  return (
    <div>
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT B · CUTOFF</span>
          <span className="os-text-soft">Set a score cutoff. Override individuals as needed.</span>
        </div>
        <button className="os-btn" onClick={applyCutoff}>Apply: approve {above.length}, reject {below.length}</button>
      </div>

      <div className="os-card os-mb-lg">
        <div className="os-card-head">
          <div className="os-card-title">Score distribution · cutoff at {cutoff.toFixed(1)}</div>
          <div className="os-row gap-sm">
            <button className="os-btn sm ghost" onClick={() => setCutoff(Math.max(5, cutoff-0.5))}>−0.5</button>
            <button className="os-btn sm ghost" onClick={() => setCutoff(Math.min(9, cutoff+0.5))}>+0.5</button>
          </div>
        </div>
        <div style={{ position:'relative', height: 200, padding: '0 8px' }}>
          <div className="os-row" style={{ alignItems:'flex-end', height:'100%', gap: 6 }}>
            {sorted.map((s) => {
              const avg = s.rev.overall;
              const passes = avg >= cutoff;
              return (
                <div key={s.id} style={{ flex: 1, display:'flex', flexDirection:'column', alignItems:'center', gap: 6 }}>
                  <div style={{ height: (avg*16)+'px', width: '100%', background: passes ? 'var(--ok)' : 'var(--ink-dim)', position:'relative' }}>
                    <span style={{ position:'absolute', top: -16, left:'50%', transform:'translateX(-50%)', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--ink-soft)' }}>{avg.toFixed(1)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ position:'absolute', left:8, right:8, top: (200 - cutoff*16) + 'px', borderTop: '2px dashed var(--accent)', pointerEvents:'none' }}>
            <span style={{ position:'absolute', right: 4, top: -22, background:'var(--accent)', color:'white', fontFamily:'var(--font-mono)', fontSize:11, padding:'2px 8px' }}>CUTOFF · {cutoff.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="os-grid-2">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Above cutoff · {above.length}</div>
            <span className="os-chip green">→ APPROVE</span>
          </div>
          <div className="os-stack gap-sm">
            {above.map(s => (
              <div key={s.id} className="os-row between" style={{ padding:'8px 0', borderBottom:'1px dashed var(--line)' }}>
                <span>{s.name} <span className="os-text-xs os-text-dim">· {s.domain}</span></span>
                <span className="os-mono os-text-sm">{s.rev.overall.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Below cutoff · {below.length}</div>
            <span className="os-chip red">→ REJECT</span>
          </div>
          <div className="os-stack gap-sm">
            {below.map(s => (
              <div key={s.id} className="os-row between" style={{ padding:'8px 0', borderBottom:'1px dashed var(--line)' }}>
                <span className="os-text-soft">{s.name} <span className="os-text-xs os-text-dim">· {s.domain}</span></span>
                <span className="os-row gap-sm">
                  <span className="os-mono os-text-sm">{s.rev.overall.toFixed(1)}</span>
                  <button className="os-btn sm ghost" onClick={() => { applyGateDecision(s, 'approve'); window.alert(s.name + ' approved (override).'); }}>override</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GateReviewBatchDecision() {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  
  // Pending are those that have reviewer evaluation but NO adminDecision yet.
  const pendingStartups = window.OS_DATA.STARTUPS.filter(s => s.rev && !s.adminDecision);
  
  // Get all unique batches represented in the pending queue
  const pendingBatches = Array.from(new Set(pendingStartups.map(s => s.batch || 'Unassigned'))).sort();
  
  const [selectedBatch, setSelectedBatch] = React.useState('All');
  const [draftDecisions, setDraftDecisions] = React.useState({}); // map of startup.id -> 'APPROVED' | 'HOLD' | 'REJECTED'

  // Filter based on selected batch
  const filtered = pendingStartups.filter(s => {
    if (selectedBatch === 'All') return true;
    return (s.batch || 'Unassigned') === selectedBatch;
  });

  const handleDraftSelect = (id, dec) => {
    setDraftDecisions(prev => ({
      ...prev,
      [id]: dec
    }));
  };

  const handlePushDecisions = () => {
    // Collect all startups in the filtered list that have a draft decision selected
    const selectedToPush = filtered.filter(s => draftDecisions[s.id]);
    if (selectedToPush.length === 0) return;

    // Build confirm message
    const listText = selectedToPush.map(s => {
      return `• ${s.name} (${s.batch || 'Unassigned'}) → ${draftDecisions[s.id]}`;
    }).join('\n');

    const confirmed = window.confirm(
      `You are about to push decisions for ${selectedToPush.length} startup(s):\n\n${listText}\n\nAre you sure you want to finalize these decisions?`
    );

    if (confirmed) {
      selectedToPush.forEach(s => {
        const dec = draftDecisions[s.id];
        s.adminDecision = dec;
        // Update their pipeline status accordingly
        if (dec === 'APPROVED') s.chip = 'SHORTLISTED';
        else if (dec === 'REJECTED') s.chip = 'REJECTED';
        else if (dec === 'HOLD') s.chip = 'HOLD';
      });

      if (window.persistOSData) window.persistOSData();
      
      // Clear drafts for successfully pushed startups
      const remainingDrafts = { ...draftDecisions };
      selectedToPush.forEach(s => {
        delete remainingDrafts[s.id];
      });
      setDraftDecisions(remainingDrafts);
      
      alert(`Successfully pushed decisions for ${selectedToPush.length} application(s).`);
      forceUpdate();
    }
  };

  const getRecoTone = (reco) => {
    const r = (reco || '').toLowerCase();
    if (r === 'yes' || r === 'approve') return 'green';
    if (r === 'maybe' || r === 'waitlist') return 'amber';
    return 'red';
  };

  const countPushed = filtered.filter(s => draftDecisions[s.id]).length;

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">BATCH DECISIONS</span>
          <h2 className="lp-section-title">Batch decision room</h2>
          <div className="lp-section-sub">Filter pending evaluations by batch, assign decisions in draft mode, and apply them in bulk.</div>
        </div>
      </div>

      <div className="os-row between os-mb-lg" style={{ background: 'var(--bg-soft)', padding: '12px 16px', borderRadius: 2, border: '1px solid var(--line)', marginBottom: 24, gap: 16 }}>
        <div className="os-row gap-xs" style={{ flexWrap: 'wrap' }}>
          <span className="os-text-sm os-mono os-text-dim" style={{ marginRight: 8, fontSize: 11, fontWeight: 'bold' }}>FILTER BATCH:</span>
          <button 
            className={'os-btn sm ' + (selectedBatch === 'All' ? 'primary' : 'secondary')}
            onClick={() => setSelectedBatch('All')}
          >
            All Batches ({pendingStartups.length})
          </button>
          {pendingBatches.map(b => {
            const count = pendingStartups.filter(s => (s.batch || 'Unassigned') === b).length;
            return (
              <button 
                key={b} 
                className={'os-btn sm ' + (selectedBatch === b ? 'primary' : 'secondary')}
                onClick={() => setSelectedBatch(b)}
              >
                {b} ({count})
              </button>
            );
          })}
        </div>

        <button 
          className="os-btn" 
          disabled={countPushed === 0} 
          onClick={handlePushDecisions}
          style={{ 
            background: countPushed > 0 ? 'var(--accent)' : 'var(--bg-soft)', 
            color: countPushed > 0 ? '#white' : 'var(--ink-dim)',
            fontWeight: 600,
            cursor: countPushed > 0 ? 'pointer' : 'not-allowed'
          }}
        >
          Push Decisions ({countPushed})
        </button>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            <th>Startup</th>
            <th>Batch</th>
            <th>Reviewer Score</th>
            <th>Reviewer Rec</th>
            <th>Flags</th>
            <th style={{ width: 280, textAlign: 'center' }}>Draft Decision</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-dim)', fontFamily: 'var(--font-serif)', fontSize: 16 }}>
                No pending evaluations found in this batch.
              </td>
            </tr>
          ) : (
            filtered.map((s) => {
              const draft = draftDecisions[s.id];
              return (
                <tr key={s.id}>
                  <td>
                    <b style={{ fontSize: 14 }}>{s.name}</b>
                    <div style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.batch || 'Unassigned'}</td>
                  <td className="num"><b>{s.rev.overall.toFixed(1)}</b></td>
                  <td>
                    <Chip tone={getRecoTone(s.rev.reco)}>{(s.rev.reco || 'maybe').toUpperCase()}</Chip>
                  </td>
                  <td>
                    {s.flags.length > 0 ? (
                      <span className="os-chip red" style={{ fontSize: 11, padding: '2px 6px' }}>⚐ {s.flags.length} flag{s.flags.length > 1 ? 's' : ''}</span>
                    ) : (
                      <span className="os-text-soft" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div className="os-reco-group" style={{ margin: 0, justifyContent: 'center', display: 'flex', gap: 4 }}>
                      <button 
                        className={'os-reco-btn approve ' + (draft === 'APPROVED' ? 'active' : '')} 
                        onClick={() => handleDraftSelect(s.id, draft === 'APPROVED' ? null : 'APPROVED')}
                        style={{ padding: '4px 10px', fontSize: 11, flex: 1 }}
                      >
                        Approve
                      </button>
                      <button 
                        className={'os-reco-btn waitlist ' + (draft === 'HOLD' ? 'active' : '')} 
                        onClick={() => handleDraftSelect(s.id, draft === 'HOLD' ? null : 'HOLD')}
                        style={{ padding: '4px 10px', fontSize: 11, flex: 1 }}
                      >
                        Hold
                      </button>
                      <button 
                        className={'os-reco-btn reject ' + (draft === 'REJECTED' ? 'active' : '')} 
                        onClick={() => handleDraftSelect(s.id, draft === 'REJECTED' ? null : 'REJECTED')}
                        style={{ padding: '4px 10px', fontSize: 11, flex: 1 }}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function GateReviewHistory({ goDetail }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [editingId, setEditingId] = React.useState(null);

  const startups = window.OS_DATA.STARTUPS.filter(s => s.rev && s.adminDecision);

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

  const renderHeader = (label, colKey) => {
    const isSorted = sortCol === colKey;
    return (
      <th 
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

  const sortedStartups = React.useMemo(() => {
    if (!sortCol) return startups;
    return [...startups].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortCol === 'sub') {
        valA = a.sub || '';
        valB = b.sub || '';
      } else if (sortCol === 'batch') {
        valA = a.batch || 'Unassigned';
        valB = b.batch || 'Unassigned';
      } else if (sortCol === 'rev') {
        valA = a.rev ? a.rev.overall : -1;
        valB = b.rev ? b.rev.overall : -1;
      } else if (sortCol === 'ai') {
        valA = a.ai ? a.ai.overall : -1;
        valB = b.ai ? b.ai.overall : -1;
      } else if (sortCol === 'flags') {
        valA = a.flags ? a.flags.length : 0;
        valB = b.flags ? b.flags.length : 0;
      } else if (sortCol === 'reco') {
        valA = a.rev ? a.rev.reco || '' : '';
        valB = b.rev ? b.rev.reco || '' : '';
      } else if (sortCol === 'adminDecision') {
        valA = a.adminDecision || '';
        valB = b.adminDecision || '';
      } else if (sortCol === 'match') {
        const aReviewerRec = (a.rev ? (a.rev.reco || 'maybe') : 'maybe').toLowerCase();
        const aAdminDec = (a.adminDecision || '').toLowerCase();
        const aIsMatch = (aAdminDec === 'approved' && aReviewerRec === 'yes') ||
                         (aAdminDec === 'rejected' && aReviewerRec === 'no') ||
                         (aAdminDec === 'hold' && aReviewerRec === 'maybe');
        const bReviewerRec = (b.rev ? (b.rev.reco || 'maybe') : 'maybe').toLowerCase();
        const bAdminDec = (b.adminDecision || '').toLowerCase();
        const bIsMatch = (bAdminDec === 'approved' && bReviewerRec === 'yes') ||
                         (bAdminDec === 'rejected' && bReviewerRec === 'no') ||
                         (bAdminDec === 'hold' && bReviewerRec === 'maybe');
        valA = aIsMatch ? 1 : 0;
        valB = bIsMatch ? 1 : 0;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [startups, sortCol, sortAsc]);

  // Stats
  const totalDecisions = startups.length;
  const approvedCount = startups.filter(s => s.adminDecision === 'APPROVED').length;
  const selectionRate = totalDecisions > 0 ? ((approvedCount / totalDecisions) * 100).toFixed(0) : 0;
  
  const avgRevScore = totalDecisions > 0 
    ? (startups.reduce((sum, s) => sum + s.rev.overall, 0) / totalDecisions).toFixed(1)
    : '0.0';

  const avgFlags = totalDecisions > 0
    ? (startups.reduce((sum, s) => sum + s.flags.length, 0) / totalDecisions).toFixed(1)
    : '0.0';

  const getRecoTone = (reco) => {
    const r = (reco || '').toLowerCase();
    if (r === 'yes' || r === 'approve') return 'green';
    if (r === 'maybe' || r === 'waitlist') return 'amber';
    return 'red';
  };

  const getDecisionTone = (dec) => {
    if (dec === 'APPROVED') return 'green';
    if (dec === 'HOLD') return 'amber';
    return 'red';
  };

  const handleSaveDecision = (id, newDec) => {
    const s = window.OS_DATA.STARTUPS.find(x => x.id === id);
    if (s) {
      s.adminDecision = newDec;
      if (newDec === 'APPROVED') s.chip = 'SHORTLISTED';
      else if (newDec === 'REJECTED') s.chip = 'REJECTED';
      else if (newDec === 'HOLD') s.chip = 'HOLD';
      
      if (window.persistOSData) window.persistOSData();
      setEditingId(null);
      forceUpdate();
    }
  };

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">HISTORY</span>
          <h2 className="lp-section-title">Admin decision history</h2>
          <div className="lp-section-sub">All applications decided on at Admin Review, key metrics, and alignment with human reviews. Click on a row to view the full application review page.</div>
        </div>
      </div>

      <div className="lp-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="dash-stat-tile" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', padding: '16px 20px', borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>TOTAL DECISIONS</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--ink)' }}>{totalDecisions}</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>across cohorts</div>
        </div>
        <div className="dash-stat-tile" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', padding: '16px 20px', borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>SELECTION RATE</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent)' }}>{selectionRate}%</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>approved applications</div>
        </div>
        <div className="dash-stat-tile" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', padding: '16px 20px', borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AVG FLAGS RAISED</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: '8px 0 4px 0', color: '#d23b40' }}>{avgFlags}</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>flags per startup</div>
        </div>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            {renderHeader('Startup', 'name')}
            {renderHeader('Date', 'sub')}
            {renderHeader('Batch', 'batch')}
            {renderHeader('Reviewer Score', 'rev', true)}
            {renderHeader('Flags', 'flags')}
            {renderHeader('Reviewer Rec', 'reco')}
            {renderHeader('Admin Decision', 'adminDecision')}
            {renderHeader('Match?', 'match')}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedStartups.length === 0 ? (
            <tr>
              <td colSpan="9" style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-dim)', fontFamily: 'var(--font-serif)', fontSize: 16 }}>
                No decisions recorded in history yet.
              </td>
            </tr>
          ) : (
            sortedStartups.map((s) => {
              const isEditing = editingId === s.id;
              const reviewerRec = (s.rev ? (s.rev.reco || 'maybe') : 'maybe').toLowerCase();
              const adminDec = (s.adminDecision || '').toLowerCase();
              
              // check if admin decision matches reviewer reco
              const isMatch = (adminDec === 'approved' && reviewerRec === 'yes') ||
                              (adminDec === 'rejected' && reviewerRec === 'no') ||
                              (adminDec === 'hold' && reviewerRec === 'maybe');

              const handleRowClick = (e) => {
                if (
                  e.target.closest('button') || 
                  e.target.closest('a') || 
                  e.target.closest('input') || 
                  e.target.closest('select') || 
                  isEditing
                ) {
                  return;
                }
                if (goDetail) goDetail(s.id);
              };

              return (
                <tr 
                  key={s.id} 
                  onClick={handleRowClick}
                  style={{ cursor: isEditing ? 'default' : 'pointer' }}
                >
                  <td>
                    <b style={{ fontSize: 14 }}>{s.name}</b>
                    <div style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.sub || '02 Jun 2026'}</td>
                  <td className="os-mono os-text-sm">{s.batch || 'Unassigned'}</td>
                  <td className="num"><b>{s.rev.overall.toFixed(1)}</b></td>
                  <td>
                    {s.flags.length > 0 ? (
                      <span className="os-chip red" style={{ fontSize: 11, padding: '2px 6px' }}>⚐ {s.flags.length} flag{s.flags.length > 1 ? 's' : ''}</span>
                    ) : (
                      <span className="os-text-soft" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    <Chip tone={getRecoTone(s.rev.reco)}>{(s.rev.reco || 'maybe').toUpperCase()}</Chip>
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="os-row gap-xs" style={{ flexWrap: 'nowrap' }}>
                        <button className="os-btn sm green" onClick={() => handleSaveDecision(s.id, 'APPROVED')} style={{ padding: '3px 8px', fontSize: 11 }}>Approve</button>
                        <button className="os-btn sm amber" onClick={() => handleSaveDecision(s.id, 'HOLD')} style={{ padding: '3px 8px', fontSize: 11 }}>Hold</button>
                        <button className="os-btn sm red" onClick={() => handleSaveDecision(s.id, 'REJECTED')} style={{ padding: '3px 8px', fontSize: 11 }}>Reject</button>
                      </div>
                    ) : (
                      <Chip tone={getDecisionTone(s.adminDecision)}>{(s.adminDecision || '').toUpperCase()}</Chip>
                    )}
                  </td>
                  <td>
                    {isMatch ? (
                      <span style={{ color: 'var(--ok)', fontWeight: 'bold' }}>✓</span>
                    ) : (
                      <span style={{ color: 'var(--ink-dim)' }}>—</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <button className="os-btn sm secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    ) : (
                      <button className="os-btn sm ghost" onClick={() => setEditingId(s.id)}>✎ Edit</button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdminGate1({ goDetail }) {
  const [variant, setVariant] = useAS2('stack');

  React.useEffect(() => {
    if (variant === 'table') {
      setVariant('stack');
    }
  }, [variant, setVariant]);

  return (
    <div>
      <PageHead
        eyebrow="A-4 · ADMIN REVIEW"
        title='Decide on <em>12 applications</em>'
        sub="Each one is reviewer-scored. Choose a workflow that matches your decision style."
      />
      <div className="os-row gap-sm os-mb-lg">
        <div className={'os-tab ' + (variant==='stack'?'active':'')} onClick={()=>setVariant('stack')}>A · Status</div>
        <div className={'os-tab ' + (variant==='cutoff'?'active':'')} onClick={()=>setVariant('cutoff')}>B · Cutoff slider</div>
        <div className={'os-tab ' + (variant==='batch'?'active':'')} onClick={()=>setVariant('batch')}>C · Batch decision</div>
        <div className={'os-tab ' + (variant==='history'?'active':'')} onClick={()=>setVariant('history')}>D · My history</div>
      </div>
      {variant==='stack' && <GateReviewStack/>}
      {variant==='cutoff' && <GateReviewCutoff/>}
      {variant==='batch' && <GateReviewBatchDecision/>}
      {variant==='history' && <GateReviewHistory goDetail={goDetail}/>}
    </div>
  );
}

// ============ A-5 Reviewers ============
function AdminReviewers({ decisionMode }) {
  if (!window.OS_DATA) window.OS_DATA = {};
  if (!window.OS_DATA.STARTUPS) window.OS_DATA.STARTUPS = [];
  if (!window.OS_DATA.REVIEWERS || !Array.isArray(window.OS_DATA.REVIEWERS)) {
    window.OS_DATA.REVIEWERS = [];
  }
  const isJury = decisionMode === 'jury';
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  if (isJury && (!window.OS_DATA.JURY || !Array.isArray(window.OS_DATA.JURY))) {
    window.OS_DATA.JURY = [
      { id:'j1', name:'Anand Mahindra', org:'M&M Group' },
      { id:'j2', name:'Kiran Mazumdar-Shaw', org:'Biocon' },
      { id:'j3', name:'Nandan Nilekani', org:'Infosys' },
      { id:'j4', name:'Falguni Nayar', org:'Nykaa' },
    ];
  }

  React.useEffect(() => {
    if (isJury) {
      window.OS_DATA.JURY.forEach(j => {
        if (!j.domain) j.domain = j.org || 'Strategic Partner';
        if (!j.startups) j.startups = [];
        if (!j.progress) {
          const total = j.startups.length;
          const reviewed = j.startups.filter(sid => {
            const s = window.OS_DATA.STARTUPS.find(x => x.id === sid);
            return s && s.jury && s.jury.reco;
          }).length;
          j.progress = `${reviewed} / ${total}`;
        }
        if (!j.consistency) j.consistency = 0.95;
        if (!j.weight) j.weight = 1.0;
        if (!j.last) j.last = '2h ago';
        if (!j.batches) j.batches = [];
      });
      const allJuryEmpty = window.OS_DATA.JURY.every(j => !j.startups || j.startups.length === 0);
      if (allJuryEmpty) {
        const targetStartups = window.OS_DATA.STARTUPS.filter(s => 
          s.chip === 'JURY REVIEW' || s.chip === 'SHORTLISTED' || s.chip === 'ACCEPTED'
        );
        window.OS_DATA.JURY.forEach((j, jIdx) => {
          j.startups = [];
          const chunk = targetStartups.slice(jIdx * 2, (jIdx + 1) * 2);
          chunk.forEach(s => {
            j.startups.push(s.id);
          });
          const total = j.startups.length;
          const reviewed = j.startups.filter(sid => {
            const s = window.OS_DATA.STARTUPS.find(x => x.id === sid);
            return s && s.jury && s.jury.reco;
          }).length;
          j.progress = `${reviewed} / ${total}`;
        });
        if (window.persistOSData) window.persistOSData();
        forceUpdate();
      }
    }
  }, [isJury]);

  const R = isJury ? window.OS_DATA.JURY : window.OS_DATA.REVIEWERS;

  const handleRandomAllotment = () => {
    if (window.confirm('Randomly allot all short-listed applications across the active jury members?')) {
      window.OS_DATA.JURY.forEach(j => {
        j.startups = [];
        j.progress = '0 / 0';
      });
      const targetStartups = window.OS_DATA.STARTUPS.filter(s => 
        s.chip === 'JURY REVIEW' || s.chip === 'SHORTLISTED' || s.chip === 'EVALUATED' || s.chip === 'ACCEPTED'
      );
      if (targetStartups.length === 0) {
        window.alert('No eligible applications found for Jury Review.');
        return;
      }
      const juryMembers = window.OS_DATA.JURY;
      if (juryMembers.length === 0) return;
      targetStartups.forEach(s => {
        const shuffled = [...juryMembers].sort(() => 0.5 - Math.random());
        const selectedJuries = shuffled.slice(0, Math.min(2, shuffled.length));
        selectedJuries.forEach(j => {
          if (!j.startups) j.startups = [];
          j.startups.push(s.id);
        });
      });
      window.OS_DATA.JURY.forEach(j => {
        const total = j.startups.length;
        const reviewed = j.startups.filter(sid => {
          const s = window.OS_DATA.STARTUPS.find(x => x.id === sid);
          return s && s.jury && s.jury.reco;
        }).length;
        j.progress = `${reviewed} / ${total}`;
      });
      if (window.persistOSData) window.persistOSData();
      forceUpdate();
      window.alert(`Successfully completed random allotment of ${targetStartups.length} startups to the Jury panel!`);
    }
  };

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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: isNum ? 'flex-end' : 'flex-start', width: '100%' }}>
          {label}
          {isSorted ? (sortAsc ? ' ▲' : ' ▼') : ''}
        </span>
      </th>
    );
  };

  const sortedReviewers = React.useMemo(() => {
    if (!sortCol) return R;
    return [...R].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortCol === 'domain') {
        valA = a.domain || '';
        valB = b.domain || '';
      } else if (sortCol === 'batches') {
        const getAssignedCount = (r) => {
          const rBatches = r.batches || [];
          const rStartups = r.startups || [];
          const batchCount = window.OS_DATA.STARTUPS.filter(s => rBatches.includes(s.batch)).length;
          const otherCount = window.OS_DATA.STARTUPS.filter(s => rStartups.includes(s.id) && !rBatches.includes(s.batch)).length;
          return batchCount + otherCount;
        };
        valA = getAssignedCount(a);
        valB = getAssignedCount(b);
      } else if (sortCol === 'progress') {
        const parseProg = (p) => {
          if (!p) return 0;
          const [num, den] = String(p).split('/').map(x => parseInt(x.trim()) || 0);
          return den > 0 ? num / den : 0;
        };
        valA = parseProg(a.progress);
        valB = parseProg(b.progress);
      } else if (sortCol === 'consistency') {
        valA = a.consistency || '';
        valB = b.consistency || '';
      } else if (sortCol === 'weight') {
        valA = a.weight || 1.0;
        valB = b.weight || 1.0;
      } else if (sortCol === 'lastActivity') {
        valA = a.lastActivity || '';
        valB = b.lastActivity || '';
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [R, sortCol, sortAsc]);

  const [showInviteModal, setShowInviteModal] = React.useState(false);
  const [inviteName, setInviteName] = React.useState('');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteDomain, setInviteDomain] = React.useState('');
  const [inviteBatch, setInviteBatch] = React.useState('');
  const [invitePassword, setInvitePassword] = React.useState('');

  // New states for managing reviewer's applications
  const [selectedReviewerForManage, setSelectedReviewerForManage] = React.useState(null);
  const [startupToAdd, setStartupToAdd] = React.useState('');
  const [batchForAdd, setBatchForAdd] = React.useState('');
  const [startupSearch, setStartupSearch] = React.useState('');
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);

  const getAvailableBatches = () => {
    if (!window.OS_DATA.BATCHES) {
      window.OS_DATA.BATCHES = ['Batch A', 'Batch B', 'Batch C', 'Batch D', 'Batch E'];
    }
    const set = new Set(window.OS_DATA.BATCHES);
    window.OS_DATA.STARTUPS.forEach(s => {
      if (s.batch && s.batch !== 'Unassigned') set.add(s.batch);
    });
    R.forEach(r => {
      if (r.batches) r.batches.forEach(b => set.add(b));
      else if (r.batch) set.add(r.batch);
    });
    return Array.from(set).sort();
  };

  const allBatches = getAvailableBatches();

  const currentBatches = selectedReviewerForManage
    ? (selectedReviewerForManage.batches || (selectedReviewerForManage.batch ? [selectedReviewerForManage.batch] : []))
    : [];

  const handleManageClick = (r) => {
    setSelectedReviewerForManage(r);
    const rBatches = r.batches || (r.batch ? [r.batch] : []);
    setBatchForAdd(rBatches[0] || '');
    setStartupToAdd('');
    setStartupSearch('');
    setIsDropdownOpen(false);
  };

  const handleAddApplication = () => {
    if (!startupToAdd || !selectedReviewerForManage) return;
    const s = window.OS_DATA.STARTUPS.find(x => x.id === startupToAdd);
    if (s) {
      if (!selectedReviewerForManage.startups) {
        selectedReviewerForManage.startups = [];
      }
      if (!selectedReviewerForManage.startups.includes(s.id)) {
        selectedReviewerForManage.startups.push(s.id);
      }
      
      // Update progress
      if (selectedReviewerForManage.progress) {
        const [num, den] = selectedReviewerForManage.progress.split('/').map(x => parseInt(x.trim()) || 0);
        const isReviewed = !!s.rev;
        const newNum = isReviewed ? num + 1 : num;
        const newDen = den + 1;
        selectedReviewerForManage.progress = `${newNum} / ${newDen}`;
      } else {
        selectedReviewerForManage.progress = s.rev ? "1 / 1" : "0 / 1";
      }

      setStartupToAdd('');
      setStartupSearch('');
      if (window.persistOSData) window.persistOSData();
      forceUpdate();
    }
  };

  const getAvailableStartupsForReviewer = () => {
    if (!selectedReviewerForManage) return [];
    const rBatches = selectedReviewerForManage.batches || (selectedReviewerForManage.batch ? [selectedReviewerForManage.batch] : []);
    const rStartups = selectedReviewerForManage.startups || [];
    return window.OS_DATA.STARTUPS.filter(s => {
      if (isJury) {
        const c = (s.chip || '').toUpperCase();
        if (c !== 'SHORTLISTED' && c !== 'JURY REVIEW' && c !== 'ACCEPTED' && c !== 'REJECTED' && c !== 'WAITLISTED') {
          return false;
        }
      }
      if (rBatches.includes(s.batch)) return false;
      if (rStartups.includes(s.id)) return false;
      return true;
    });
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

  const reviewerStartups = selectedReviewerForManage
    ? window.OS_DATA.STARTUPS.filter(s => {
        const rBatches = selectedReviewerForManage.batches || (selectedReviewerForManage.batch ? [selectedReviewerForManage.batch] : []);
        if (rBatches.includes(s.batch)) return true;
        const rStartups = selectedReviewerForManage.startups || [];
        if (rStartups.includes(s.id)) return true;
        return false;
      })
    : [];

  const availableStartups = getAvailableStartupsForReviewer();

  const filteredAvailableStartups = availableStartups.filter(s => 
    s.name.toLowerCase().includes(startupSearch.toLowerCase()) ||
    s.domain.toLowerCase().includes(startupSearch.toLowerCase())
  );

  return (
    <div>
      <style dangerouslySetInnerHTML={{__html: `
        .os-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(36, 36, 36, 0.4);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
          animation: osDrawerFadeIn 0.2s ease-out;
        }
        .os-drawer {
          width: 680px;
          max-width: 90vw;
          height: 100%;
          background: var(--bg-paper);
          border-left: 1px solid var(--line-strong);
          box-shadow: -10px 0 40px rgba(36, 36, 36, 0.15);
          display: flex;
          flex-direction: column;
          animation: osDrawerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .os-drawer-head {
          padding: 20px 24px;
          border-bottom: 1px solid var(--line);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .os-drawer-title {
          font-size: 18px;
          font-weight: 600;
          font-family: var(--font-sans);
          color: var(--ink);
        }
        .os-drawer-subtitle {
          font-size: 13px;
          color: var(--ink-soft);
          margin-top: 4px;
        }
        .os-drawer-body {
          padding: 24px;
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .os-drawer-foot {
          padding: 16px 24px;
          border-top: 1px solid var(--line);
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: var(--bg-soft);
        }
        @keyframes osDrawerFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes osDrawerSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}} />

      <PageHead
        eyebrow={isJury ? "A-6 · JURY PANEL" : "A-5 · REVIEWERS"}
        title={isJury ? 'Jury <em>roster</em>' : 'Reviewer <em>roster</em>'}
        sub={isJury ? "Assignments, progress, and alignment calibration." : "Assignments, progress, consistency calibration."}
        actions={isJury ? [
          <button key="inv" className="os-btn ghost" onClick={() => {
            setInvitePassword(generateBasicPassword());
            setShowInviteModal(true);
          }}>Invite member</button>,
          <button key="reb" className="os-btn" onClick={handleRandomAllotment}>Random Allotment</button>
        ] : [
          <button key="inv" className="os-btn ghost" onClick={() => {
            setInvitePassword(generateBasicPassword());
            setShowInviteModal(true);
          }}>Invite member</button>,
          <button key="reb" className="os-btn" onClick={() => window.alert('Rebalance batches — evenly redistributes assigned applications across active reviewers.')}>Rebalance batches</button>
        ]}
      />
      <table className="os-table">
        <thead>
          <tr>
            {renderHeader(isJury ? 'Jury Member' : 'Reviewer', 'name')}
            {renderHeader(isJury ? 'Organization' : 'Domain', 'domain')}
            {renderHeader('Applications Assigned', 'batches')}
            {renderHeader('Progress', 'progress')}
            {renderHeader('Consistency', 'consistency')}
            {renderHeader('Weight / Primary', 'weight')}
            {renderHeader('Last activity', 'lastActivity')}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedReviewers.map(r => {
            if (!r.batches) {
              r.batches = r.batch ? [r.batch] : [];
            }
            return (
              <tr key={r.id}>
                <td><div className="startup">{r.name}<small>{isJury ? 'Jury Member' : 'External · paid per review'}</small></div></td>
                <td className="os-text-soft">{isJury ? (r.org || r.domain) : r.domain}</td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(() => {
                      const rBatches = Array.isArray(r.batches) ? r.batches : (r.batch ? [r.batch] : []);
                      const rStartups = Array.isArray(r.startups) ? r.startups : [];
                      const batchStartups = window.OS_DATA.STARTUPS.filter(s => rBatches.includes(s.batch));
                      const otherStartups = window.OS_DATA.STARTUPS.filter(s => rStartups.includes(s.id) && !rBatches.includes(s.batch));
                      
                      const parts = [];
                      if (rBatches.length > 0) {
                        const batchNames = rBatches.join(', ');
                        parts.push(`${batchStartups.length} of ${batchNames}`);
                      }
                      if (otherStartups.length > 0) {
                        parts.push(`${otherStartups.length} (random allotment)`);
                      }
                      return (
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                          {parts.length === 0 ? 'No assignments' : parts.join(' and ')}
                        </div>
                      );
                    })()}
                    {!isJury && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {r.batches.map(b => (
                          <span key={b} className="os-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', fontSize: 11 }}>
                            {b}
                            <span 
                              style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 11, color: '#FF5A5F', marginLeft: 2 }}
                              onClick={() => {
                                r.batches = r.batches.filter(x => x !== b);
                                if (window.persistOSData) window.persistOSData();
                                forceUpdate();
                              }}
                            >
                              &times;
                            </span>
                          </span>
                        ))}
                        <select
                          className="os-select sm"
                          style={{ padding: '0 4px', fontSize: 11, height: 20, width: 36, minWidth: 36 }}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              if (!r.batches.includes(e.target.value)) {
                                r.batches.push(e.target.value);
                              }
                              if (window.persistOSData) window.persistOSData();
                              forceUpdate();
                            }
                          }}
                        >
                          <option value="" disabled>+</option>
                          {allBatches.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <div className="os-row gap-sm">
                    <div className="os-scorebar-track" style={{ width: 90 }}>
                      <div className="os-scorebar-fill" style={{ width: (() => {
                        const pStr = String(r.progress || '0 / 0');
                        const parts = pStr.split('/');
                        const num = parseInt(parts[0]) || 0;
                        const den = parseInt(parts[1]) || 1;
                        return Math.min(100, Math.max(0, (num / den) * 100));
                      })() + '%', background:'var(--ink)' }}/>
                    </div>
                    <span className="os-mono os-text-sm">{r.progress || '0 / 0'}</span>
                  </div>
                </td>
                <td>
                  <span className={'os-chip ' + (r.consistency>=0.9?'green':r.consistency>=0.8?'amber':'red')}>{(r.consistency*100).toFixed(0)}%</span>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input 
                      type="number" 
                      step="0.5" 
                      min="1.0" 
                      max="5.0" 
                      className="os-input sm" 
                      style={{ width: 62, padding: '2px 4px', height: 26, fontSize: 12, textAlign: 'center' }} 
                      value={r.weight || 1.0} 
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1.0;
                        r.weight = val;
                        if (window.persistOSData) window.persistOSData();
                        forceUpdate();
                      }}
                    />
                    {r.weight > 1.0 && <span className="os-chip purple" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 700 }}>PRIMARY</span>}
                  </div>
                </td>
                <td className="os-mono os-text-sm os-text-soft">{r.last}</td>
                <td><button className="os-btn sm secondary" onClick={() => handleManageClick(r)}>Manage</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedReviewerForManage && (
        <div className="os-drawer-backdrop" onClick={() => setSelectedReviewerForManage(null)}>
          <div className="os-drawer" onClick={e => e.stopPropagation()}>
            <div className="os-drawer-head">
              <div>
                <div className="os-drawer-title">Manage Applications</div>
                <div className="os-drawer-subtitle">
                  {isJury ? 'Jury Member' : 'Reviewer'}: <strong>{selectedReviewerForManage.name}</strong> &middot; {selectedReviewerForManage.org || selectedReviewerForManage.domain}
                </div>
              </div>
              <button 
                className="os-btn sm ghost" 
                onClick={() => setSelectedReviewerForManage(null)}
                style={{ padding: '2px 8px', fontSize: 18 }}
              >
                &times;
              </button>
            </div>
            
            <div className="os-drawer-body">
              {!isJury && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600 }}>Assigned Batches:</span>
                  {currentBatches.length > 0 ? (
                    currentBatches.map(b => (
                      <span key={b} className="os-chip" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', fontWeight: 600, padding: '3px 8px' }}>
                        {b}
                      </span>
                    ))
                  ) : (
                    <span className="os-text-soft" style={{ fontSize: 13 }}>None</span>
                  )}
                </div>
              )}

              {/* Add Application Form */}
              <div className="os-card soft" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--line)', marginBottom: '16px' }}>
                <div className="os-card-title" style={{ fontSize: '11px', letterSpacing: '0.12em' }}>
                  Assign New Application
                </div>
                
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Left field: Searchable Application Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '220px', position: 'relative' }}>
                    <label style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-dim)', letterSpacing: '0.05em' }}>
                      Application
                    </label>
                    <input
                      type="text"
                      className="os-input"
                      style={{ width: '100%', paddingRight: '24px', height: '34px', fontSize: '13px', borderColor: '#c8c8d0' }}
                      placeholder="Search by name or industry..."
                      value={startupSearch}
                      onFocus={() => setIsDropdownOpen(true)}
                      onChange={(e) => {
                        setStartupSearch(e.target.value);
                        setIsDropdownOpen(true);
                      }}
                    />
                    <span 
                      style={{ position: 'absolute', right: '10px', top: '28px', cursor: 'pointer', color: 'var(--ink-dim)', fontSize: '12px' }}
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    >
                      ▾
                    </span>

                    {isDropdownOpen && (
                      <div>
                        <div 
                          style={{ position: 'fixed', inset: 0, zIndex: 90 }} 
                          onClick={() => setIsDropdownOpen(false)} 
                        />
                        <div 
                          style={{
                            position: 'absolute',
                            top: '56px',
                            left: 0,
                            right: 0,
                            background: 'var(--bg-paper)',
                            border: '1px solid var(--line-strong)',
                            borderRadius: '4px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            zIndex: 100,
                            maxHeight: '220px',
                            overflowY: 'auto'
                          }}
                        >
                          {filteredAvailableStartups.length > 0 ? (
                            filteredAvailableStartups.map(s => (
                              <div
                                key={s.id}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  borderBottom: '1px solid var(--line)',
                                  fontSize: '12px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                                onClick={() => {
                                  setStartupToAdd(s.id);
                                  setStartupSearch(`${s.name} (${s.domain})`);
                                  setIsDropdownOpen(false);
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-soft)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                <div>
                                  <strong style={{ color: 'var(--ink)' }}>{s.name}</strong>
                                  <span style={{ color: 'var(--ink-soft)', marginLeft: '6px' }}>{s.domain}</span>
                                </div>
                                <span className="os-chip" style={{ fontSize: '9px', padding: '1px 5px' }}>
                                  {s.batch || 'Unassigned'}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '12px', color: 'var(--ink-soft)', fontSize: '12px', textAlign: 'center' }}>
                              No applications found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Middle field: Target Batch Selector */}
                  {currentBatches.length > 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--ink-dim)', letterSpacing: '0.05em' }}>
                        Target Batch
                      </label>
                      <div style={{ display: 'flex', gap: '6px', height: '34px', alignItems: 'center' }}>
                        {currentBatches.map(b => (
                          <button
                            key={b}
                            type="button"
                            className={`os-btn sm ${batchForAdd === b ? '' : 'secondary ghost'}`}
                            style={{
                              height: '34px',
                              padding: '0 12px',
                              fontSize: '12px',
                              fontWeight: 600,
                              borderColor: batchForAdd === b ? 'var(--accent)' : 'var(--line)',
                              background: batchForAdd === b ? 'var(--accent)' : 'transparent',
                              color: batchForAdd === b ? '#fff' : 'var(--ink-soft)',
                              borderRadius: '3px'
                            }}
                            onClick={() => setBatchForAdd(b)}
                          >
                            {b}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Right field: Add Button */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignSelf: 'flex-end' }}>
                    <label style={{ fontSize: '10px', height: '15px' }}></label>
                    <button
                      className="os-btn"
                      style={{
                        background: startupToAdd ? 'var(--accent)' : 'var(--line)',
                        borderColor: startupToAdd ? 'var(--accent)' : 'var(--line)',
                        color: startupToAdd ? '#fff' : 'var(--ink-dim)',
                        height: '34px',
                        padding: '0 20px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: startupToAdd ? 'pointer' : 'not-allowed',
                        transition: 'all 0.15s ease'
                      }}
                      onClick={handleAddApplication}
                      disabled={!startupToAdd}
                    >
                      Assign Application
                    </button>
                  </div>
                </div>
              </div>

              {/* Applications List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-soft)' }}>
                  Assigned Applications ({reviewerStartups.length})
                </div>

                {reviewerStartups.length > 0 ? (
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Industry</th>
                        <th>Status</th>
                        {isJury ? (
                          <>
                            <th>Avg Rev</th>
                            <th>Jury Score</th>
                          </>
                        ) : (
                          <th>Batch</th>
                        )}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewerStartups.map(s => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.name}</td>
                          <td className="os-text-soft" style={{ fontSize: 12 }}>{s.domain}</td>
                          <td>
                            <span className={`os-chip ${getChipTone(s)}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                              {getFriendlyStatus(s).toUpperCase()}
                            </span>
                          </td>
                          {isJury ? (
                            <>
                              <td className="num">{s.rev ? (s.rev.overall || 0).toFixed(1) : '—'}</td>
                              <td className="num">
                                {(() => {
                                  if (!s.jury) return '—';
                                  return <b>{globalGetJuryAvg(s).toFixed(1)}</b>;
                                })()}
                              </td>
                            </>
                          ) : (
                            <td>
                              {selectedReviewerForManage.batches && selectedReviewerForManage.batches.includes(s.batch) ? (
                                <span className="os-chip" style={{ fontSize: 10, padding: '2px 6px' }}>
                                  {s.batch}
                                </span>
                              ) : (
                                <span className="os-chip purple" style={{ fontSize: 10, padding: '2px 6px', fontWeight: 600 }}>
                                  Random allotment
                                </span>
                              )}
                            </td>
                          )}
                          <td>
                            <button
                              className="os-btn sm ghost"
                              style={{ color: '#FF5A5F', borderColor: '#ffe4e4', padding: '2px 8px', fontSize: 11 }}
                              onClick={() => {
                                const rStartups = selectedReviewerForManage.startups || [];
                                if (rStartups.includes(s.id)) {
                                  selectedReviewerForManage.startups = rStartups.filter(id => id !== s.id);
                                } else {
                                  s.batch = 'Unassigned';
                                }
                                // Update progress
                                if (selectedReviewerForManage.progress) {
                                  const [num, den] = selectedReviewerForManage.progress.split('/').map(x => parseInt(x.trim()) || 0);
                                  const isReviewed = !!s.rev;
                                  const newNum = isReviewed ? Math.max(0, num - 1) : num;
                                  const newDen = Math.max(0, den - 1);
                                  selectedReviewerForManage.progress = `${newNum} / ${newDen}`;
                                }
                                if (window.persistOSData) window.persistOSData();
                                forceUpdate();
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--ink-soft)', border: '1px dashed var(--line)', borderRadius: '2px' }}>
                    No applications currently assigned to this reviewer.
                  </div>
                )}
              </div>
            </div>

            <div className="os-drawer-foot">
              <button className="os-btn secondary" onClick={() => setSelectedReviewerForManage(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="os-modal-backdrop" onClick={() => setShowInviteModal(false)}>
          <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="os-modal-head">
              <div style={{ fontWeight: 600, fontSize: 16 }}>Invite Member</div>
              <button 
                className="os-btn sm ghost" 
                onClick={() => setShowInviteModal(false)}
                style={{ padding: '2px 8px', fontSize: 18 }}
              >
                &times;
              </button>
            </div>
            <div className="os-modal-body os-stack gap-md">
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Full Name</label>
                <input 
                  type="text" 
                  className="os-input os-w-100" 
                  placeholder="e.g. Vikram Sundar" 
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Email Address</label>
                <input 
                  type="email" 
                  className="os-input os-w-100" 
                  placeholder="name@example.in" 
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Expertise / Domains</label>
                <input 
                  type="text" 
                  className="os-input os-w-100" 
                  placeholder="e.g. Robotics, AI, CleanTech" 
                  value={inviteDomain}
                  onChange={e => setInviteDomain(e.target.value)}
                />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Initial Batch Assignment</label>
                <select 
                  className="os-select os-w-100" 
                  value={inviteBatch}
                  onChange={e => setInviteBatch(e.target.value)}
                >
                  <option value="">None (Unassigned)</option>
                  {allBatches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Temporary Password</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    type="text" 
                    className="os-input os-w-100 os-mono" 
                    style={{ fontSize: 13, background: 'var(--bg-soft)', fontWeight: 600 }}
                    value={invitePassword}
                    readOnly
                  />
                  <button 
                    className="os-btn secondary sm"
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(invitePassword);
                      alert("Password copied to clipboard!");
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="os-modal-foot">
              <button className="os-btn secondary" onClick={() => setShowInviteModal(false)}>Cancel</button>
              <button 
                className="os-btn" 
                style={{ background: '#3213b7', color: '#fff' }}
                onClick={() => {
                  if (!inviteName || !inviteEmail) {
                    alert("Please enter Name and Email.");
                    return;
                  }
                  window.OS_DATA.REVIEWERS.push({
                    id: 'r' + (window.OS_DATA.REVIEWERS.length + 1),
                    name: inviteName,
                    domain: inviteDomain || 'Unspecified',
                    batches: inviteBatch ? [inviteBatch] : [],
                    progress: '0 / 0',
                    consistency: 1.0,
                    last: 'Just invited'
                  });
                  alert(`Member invited successfully!\n\nEmail: ${inviteEmail}\nPassword: ${invitePassword}\n\nYou can now copy and send these login credentials to the user.`);
                  setInviteName('');
                  setInviteEmail('');
                  setInviteDomain('');
                  setInviteBatch('');
                  setShowInviteModal(false);
                  if (window.persistOSData) window.persistOSData();
                  forceUpdate();
                }}
              >
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ A-6 AI Pipeline status ============
function AdminAIStatus() {
  const tasks = [
    { name:'Pravaha Water · Layer 2 scoring', step:'Extracting evidence from pitch.pdf', pct:62 },
    { name:'Kaleido Quantum · Layer 1 validation', step:'Checking deck completeness', pct:88 },
    { name:'Mihira Diagnostics · Reviewer assignment', step:'Matching to domain experts', pct:34 },
  ];
  const logText = [
    '[10:42:18] OK Pravaha Water · scoring complete · 7.0',
    '[10:38:02] -> Pravaha Water · extracting team data',
    '[10:36:14] -> Pravaha Water · parsing pitch.pdf',
    '[10:35:03] .. Pravaha Water · job started',
    '[10:31:55] OK Karkhana Robotics · review submitted',
    '[10:24:11] OK Tarang Acoustics · scoring complete · 5.4',
    '[10:18:33] !! Tarang Acoustics · 3 flags raised',
    '[10:14:02] .. Tarang Acoustics · job started',
  ].join('\n');
  return (
    <div>
      <PageHead
        eyebrow="A-6 · AI PIPELINE"
        title='AI <em>pipeline status</em>'
        sub="Layer 2 (auto-scoring) and Layer 3 (reviewer matching) execution status."
        actions={[<button key="cfg" className="os-btn ghost">Configure</button>]}
      />
      <div className="os-stats-row os-mb-lg">
        <Stat tone="l2" num="237" label="Scored today" meta="↑ 11 since 9 AM" />
        <Stat tone="l2" num="3" label="Running now" meta="Avg 4m 12s" />
        <Stat tone="l3" num="11" label="Queued" meta="Next: 2 min" />
        <Stat tone="l4" num="98.4%" label="Success rate" meta="7d trailing" />
      </div>

      <div className="os-grid-sidebar">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Active jobs</div>
            <span className="os-chip green">● 3 RUNNING</span>
          </div>
          <div className="os-stack">
            {tasks.map((t,i) => (
              <div key={i} style={{ padding:'12px 0', borderBottom: i<tasks.length-1 ? '1px dashed var(--line)' : 'none' }}>
                <div className="os-row between os-mb-sm">
                  <span style={{ fontWeight:600 }}>{t.name}</span>
                  <span className="os-mono os-text-xs">{t.pct}%</span>
                </div>
                <div className="os-text-xs os-text-soft os-mb-sm">→ {t.step}</div>
                <div className="os-scorebar-track">
                  <div className="os-scorebar-fill" style={{ width: t.pct+'%', background:'var(--l2-cyan)' }}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="os-card">
          <div className="os-card-title os-mb">Pipeline log</div>
          <div className="os-rubric" style={{ maxHeight: 360, overflow:'auto' }}>
            <div className="head"><span>$ artpark-ai watch</span><span className="ver">v3.1</span></div>
            <pre>{logText}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ A-7 Audit ============
function AdminAudit() {
  const log = [
    { ts:'2026-04-21 10:46:11', actor:'admin@artpark.in', act:'GATE_1_DECIDE', desc:'approved Karkhana Robotics → Layer 5' },
    { ts:'2026-04-21 10:45:50', actor:'admin@artpark.in', act:'GATE_1_DECIDE', desc:'rejected Tarang Acoustics' },
    { ts:'2026-04-21 10:31:03', actor:'vikram@external', act:'REVIEW_SUBMIT', desc:'Karkhana Robotics · 7.9 / 10 · Yes' },
    { ts:'2026-04-21 10:14:22', actor:'system.ai', act:'AI_SCORE', desc:'Pravaha Water · 7.0 · 83% conf' },
    { ts:'2026-04-21 10:14:02', actor:'system.ai', act:'AI_RUN_START', desc:'Pravaha Water (job-9874)' },
    { ts:'2026-04-21 09:58:11', actor:'aishwarya@external', act:'FLAG_RAISE', desc:'GridPulse · variance Founders 6.5 vs 5.0' },
    { ts:'2026-04-21 09:46:00', actor:'admin@artpark.in', act:'BATCH_PROMOTE', desc:'5 startups → Layer 5 Psychometry' },
    { ts:'2026-04-21 09:22:48', actor:'system.ai', act:'AI_SCORE', desc:'Tarang Acoustics · 5.4 · 62% conf · 3 flags' },
    { ts:'2026-04-20 18:14:30', actor:'cm@artpark.in', act:'NUDGE_SEND', desc:'3 orange-flag founders nudged' },
    { ts:'2026-04-20 16:02:11', actor:'admin@artpark.in', act:'CONFIG_UPDATE', desc:'Gate 1 cutoff threshold 6.5 → 7.0' },
  ];
  return (
    <div>
      <PageHead
        eyebrow="A-7 · AUDIT LOG"
        title='Cohort <em>audit trail</em>'
        sub="Every state-changing action. Immutable. Downloadable for compliance."
        actions={[<button key="dl" className="os-btn ghost">Download CSV</button>,<button key="dlj" className="os-btn">Download JSON</button>]}
      />
      <div className="os-filterbar">
        <span className="label">Actor</span>
        <select className="os-select"><option>All</option><option>Admins</option><option>Reviewers</option><option>System.ai</option></select>
        <span className="label">Action</span>
        <select className="os-select"><option>All</option><option>GATE_*</option><option>AI_*</option><option>REVIEW_*</option></select>
        <span className="label">Date</span>
        <select className="os-select"><option>Last 7 days</option><option>Last 30 days</option><option>All time</option></select>
      </div>
      <div className="os-card" style={{ borderTop:'none' }}>
        <div className="os-audit">
          <div className="os-audit-row" style={{ fontWeight:600, color:'var(--ink-dim)', textTransform:'uppercase', fontSize:10, letterSpacing:'0.14em' }}>
            <span>Timestamp</span><span>Actor</span><span>Action / Description</span>
          </div>
          {log.map((r,i) => (
            <div key={i} className="os-audit-row">
              <span className="ts">{r.ts}</span>
              <span className="act">{r.actor}</span>
              <span><b style={{ color:'var(--accent)', marginRight: 8 }}>{r.act}</b><span className="desc">{r.desc}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ A-5 Psychometry ============
function AdminPsychometry() {
  return (
    <div>
      <PageHead eyebrow="A-5 · PSYCHOMETRY" title='Psychometry <em>Pipeline</em>' sub="Manage Korn Ferry test distribution and archetype reviews." />
      <div className="os-card">
        <table className="os-table">
          <thead><tr><th>Startup</th><th>Founders Invited</th><th>Tests Completed</th><th>Archetypes Gen</th><th>Jury Shortlisted</th><th>Actions</th></tr></thead>
          <tbody>
            <tr><td><b>Karkhana Robotics</b></td><td>2</td><td><Chip tone="green">2/2</Chip></td><td><Chip tone="green">YES</Chip></td><td><Chip tone="blue">YES</Chip></td><td><button className="os-btn sm secondary" onClick={() => window.alert('Karkhana Robotics — psychometry profile report.')}>View Profile</button></td></tr>
            <tr><td><b>Mihira Diagnostics</b></td><td>3</td><td><Chip tone="amber">1/3</Chip></td><td><Chip>NO</Chip></td><td><Chip>NO</Chip></td><td><button className="os-btn sm ghost" onClick={() => window.alert('Psychometry invite resent to Mihira Diagnostics.')}>Resend Invite</button></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ A-6 Jury Mgmt ============
function AdminJury() {
  return (
    <div>
      <PageHead eyebrow="A-6 · JURY MANAGEMENT" title='Jury <em>Assignments</em>' sub="Manage external jury members, their assignments, and score aggregation." />
      <div className="os-card">
        <table className="os-table">
          <thead><tr><th>Startup</th><th>Assigned Jury</th><th>Scores In</th><th>Avg Jury Score</th><th>Actions</th></tr></thead>
          <tbody>
            <tr><td><b>Karkhana Robotics</b></td><td>Dr. R. Iyer, Dr. P. Suresh</td><td><Chip tone="green">2/2</Chip></td><td className="num"><b>8.4</b></td><td><button className="os-btn sm secondary" onClick={() => window.alert('Jury scoring detail — Karkhana Robotics.')}>Details</button></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ A-7 Gate 2 Final ============
// Apply an admin final gate decision to a startup and persist it.
function applyJuryGateDecision(st, decision, note) {
  if (!st) return;
  const d = (decision || '').toLowerCase();
  if (d === 'approve' || d === 'approved') { 
    st.chip = 'ACCEPTED'; 
    st.adminDecision = 'APPROVED'; 
  } else if (d === 'waitlist' || d === 'waitlisted' || d === 'hold') { 
    st.chip = 'WAITLISTED'; 
    st.adminDecision = 'WAITLISTED'; 
  } else if (d === 'reject' || d === 'rejected') { 
    st.chip = 'REJECTED'; 
    st.adminDecision = 'REJECTED'; 
  }
  if (note != null && note !== '') st.adminRationale = note;
  if (window.persistOSData) window.persistOSData();
}
window.applyJuryGateDecision = applyJuryGateDecision;

// ============ Jury Gate Stack (Variant A) ============
function JuryGateStack({ goDetail }) {
  const items = window.OS_DATA.STARTUPS.filter(s => {
    const c = (s.chip || '').toUpperCase();
    return c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
  });

  const [idx, setIdx] = useAS2(0);
  const [decisions, setDecisions] = useAS2(() => {
    const init = {};
    items.forEach(it => {
      const ad = (it.adminDecision || '').toUpperCase();
      if (ad === 'APPROVED' || it.chip === 'ACCEPTED') init[it.id] = 'approve';
      else if (ad === 'WAITLISTED' || it.chip === 'WAITLISTED') init[it.id] = 'waitlist';
      else if (ad === 'REJECTED' || it.chip === 'REJECTED') init[it.id] = 'reject';
    });
    return init;
  });
  const [notes, setNotes] = useAS2({});

  if (items.length === 0) {
    return (
      <div className="os-card" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-soft)' }}>
        No shortlisted startups available for Final Gate evaluation.
      </div>
    );
  }

  const s = items[idx] || items[0];

  const decide = (d) => {
    setDecisions({ ...decisions, [s.id]: d });
    applyJuryGateDecision(s, d, notes[s.id]);
    if (idx < items.length - 1) setTimeout(() => setIdx(idx+1), 200);
  };
  const decided = Object.keys(decisions).length;

  const counts = { approve: 0, waitlist: 0, reject: 0 };
  Object.values(decisions).forEach(d => { if (counts[d] !== undefined) counts[d]++; });

  const getJuryMetricScore = (scores, key, startupId) => {
    let val = scores ? scores[key] : null;
    if (val == null || val < 5) {
      const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + key.charCodeAt(0) + 12;
      val = 5.0 + (seed % 45) * 0.1;
    }
    return parseFloat(val.toFixed(1));
  };

  const getJuryMetricComment = (jId, metricKey, startupId) => {
    const comments = {
      problem: [
        "Highly lucrative market size with strong, immediate customer pain points.",
        "Demonstrates clear expansion path and high customer lifetime value.",
        "Massive addressable market with high growth potential in the target sector.",
        "Addresses a critical market gap with a highly scalable business model."
      ],
      solution: [
        "Completeness of execution is top-notch; solves the user flow end-to-end.",
        "Very thoughtful solution design with a highly intuitive user interface.",
        "Demonstrates excellent integration capabilities and operational efficiency.",
        "Deep understanding of technical requirements and edge cases."
      ],
      tech: [
        "Strong proprietary algorithms and technical moats to fend off copycats.",
        "Good defensibility with early IP generation and deep tech integration.",
        "Hard-to-replicate hardware-software stack with solid first-mover advantage.",
        "Deep technical barriers to entry and strong patent potential."
      ],
      founders: [
        "Aligned perfectly with the core cohort strategy and technical mandates.",
        "Excellent match for our cohort network, resources, and technical support.",
        "Team displays high coachability and matches our program goals precisely.",
        "Perfect incubation fit; can leverage our strategic partner ecosystem."
      ],
      commit: [
        "Full-time commitment verified; founders are completely dedicated.",
        "High availability and willingness to pivot core competencies as needed.",
        "Demonstrated intense dedication during the preliminary validation phases.",
        "Strong long-term dedication to building a lasting venture."
      ]
    };
    const arr = comments[metricKey] || ["Good performance and solid metrics."];
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + (jId || '').charCodeAt((jId || '').length - 1) + metricKey.charCodeAt(0);
    return arr[seed % arr.length];
  };

  const getJuryAvg = (st) => {
    if (!st.jury) return 0;
    const allJury = (window.OS_DATA && window.OS_DATA.JURY) || [];
    const assigned = allJury.filter(j => st.juryAssigned && st.juryAssigned.includes(j.id));
    const list = assigned.length > 0 ? assigned : [{ id: 'j0', name: 'Jury Panel' }];
    let sum = 0;
    list.forEach((j, ji) => {
      const scores = ji === 0 ? st.jury : (st.juryScores && st.juryScores[j.id]) || st.jury;
      sum += getJuryMetricScore(scores, 'problem', st.id);
      sum += getJuryMetricScore(scores, 'solution', st.id);
      sum += getJuryMetricScore(scores, 'tech', st.id);
      sum += getJuryMetricScore(scores, 'founders', st.id);
      sum += getJuryMetricScore(scores, 'commit', st.id);
    });
    return sum / (list.length * 5);
  };

  const getCombined = (st) => {
    const rScore = window.calculateWeightedReviewerAverage ? window.calculateWeightedReviewerAverage(st, 'overall') : (st.rev ? (st.rev.overall || 0) : 0);
    const jScore = getJuryAvg(st);
    if (rScore > 0 && jScore > 0) return (rScore + jScore) / 2;
    return rScore > 0 ? rScore : jScore;
  };

  const getJuryReco = (scores, jId, startupId) => {
    if (scores && scores.reco) return scores.reco;
    const seed = (startupId || '').charCodeAt((startupId || '').length - 1) + (jId || '').charCodeAt((jId || '').length - 1);
    const recos = ['yes', 'maybe', 'interview', 'no'];
    return recos[seed % recos.length];
  };

  const TIR_METRICS = [
    { key: 'problem', label: 'Problem Statement Impact and Importance' },
    { key: 'solution', label: 'Completeness, Depth of Solution' },
    { key: 'tech', label: 'Technical Depth' },
    { key: 'founders', label: 'Professional Profile of Founder' },
    { key: 'commit', label: 'Commitment to be fully available' }
  ];

  const getTIRSignalScore = (st, key) => {
    if (st.tirSignals && st.tirSignals[key] != null) return st.tirSignals[key];
    const seed = st.id.charCodeAt(st.id.length - 1) + key.charCodeAt(0) + key.charCodeAt(key.length - 1);
    const val = 6.0 + (seed % 36) * 0.1;
    if (!st.tirSignals) st.tirSignals = {};
    st.tirSignals[key] = parseFloat(val.toFixed(1));
    return st.tirSignals[key];
  };

  const getTIRSignalOverall = (st) => {
    const sum = TIR_METRICS.reduce((acc, m) => acc + getTIRSignalScore(st, m.key), 0);
    return parseFloat((sum / TIR_METRICS.length).toFixed(2));
  };

  const isInterviewRequested = s.jury && (s.jury.reco === 'interview' || s.jury.reco === 'maybe' || s.jury.reco === 'yes');

  return (
    <div>
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT A · STATUS</span>
          <span className="os-text-soft">Decide final cohort accepted/waitlisted startups one at a time.</span>
        </div>
        <span className="os-mono os-text-sm">{decided} / {items.length} decided</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 280px))', gap: 14, marginBottom: 24 }}>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Shortlisted Startups</span>
          <span className="gate-kpi-num">{items.length}</span>
          <span className="gate-kpi-sub">Ready for final gate decision</span>
        </div>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Cohort Onboarding</span>
          <div style={{ display: 'flex', gap: 26, marginTop: 8 }}>
            {[['Approve', counts.approve, '#2F6F62'], ['Waitlist', counts.waitlist, '#FFB703'], ['Reject', counts.reject, '#FF5A5F']].map(([label, n, c]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 400, lineHeight: 1, color: 'var(--ink)' }}>{n}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />{label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        <div className="os-card">
          <div className="os-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="os-row gap-sm" style={{ flexWrap: 'wrap' }}>
              <span className="os-mono os-text-xs os-text-dim">{idx+1}/{items.length}</span>
              <FlagDot tone={s.flag} />
              <span style={{ fontSize: 22, fontFamily: 'var(--font-serif)' }}>{s.name}</span>
              <span className="os-chip">{s.domain}</span>
              <span className="os-chip">{s.stage}</span>
              {isInterviewRequested && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'linear-gradient(135deg,#6366f1,#7c3aed)',
                  color: '#fff', border: 'none', borderRadius: 4,
                  fontWeight: 700, fontSize: 11, padding: '3px 10px',
                  letterSpacing: '0.04em', boxShadow: '0 0 0 3px #c4b5fd55'
                }}>Interview requested</span>
              )}
              {s.interviewCompleted && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#eef5f1', color: '#2F6F62',
                  border: '1.5px solid #2F6F62', borderRadius: 4,
                  fontWeight: 700, fontSize: 11, padding: '3px 10px'
                }}>Interviewed</span>
              )}
            </div>
            <div className="os-row gap-sm">
              {goDetail && (
                <button className="os-btn sm secondary" onClick={() => goDetail(s.id)}>View App &rarr;</button>
              )}
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.max(0, idx-1))}>&larr; Prev</button>
              <button className="os-btn sm ghost" onClick={() => setIdx(Math.min(items.length-1, idx+1))}>Next &rarr;</button>
            </div>
          </div>
          <div style={{ padding: '0 0 20px 0' }}>
            <ComparativeReviewModel startup={s} />
            {/* Jury Scorecard */}
            {s.jury && (() => {
              const allJury = (window.OS_DATA && window.OS_DATA.JURY) || [];
              let assigned = allJury.filter(j => s.juryAssigned && s.juryAssigned.includes(j.id));
              if (assigned.length === 0) assigned = allJury.slice(0, 2);
              if (assigned.length === 1) assigned = [...assigned, allJury.find(j => j.id !== assigned[0].id) || { id:'jx', name:'Jury Member 2', org:'' }];
              assigned = assigned.slice(0, 2); // cap at 2

              const jMetrics = [
                { key: 'problem', label: 'Problem statement' },
                { key: 'solution', label: 'Solution depth' },
                { key: 'tech', label: 'Technical depth' },
                { key: 'founders', label: 'Founder profile' },
                { key: 'commit', label: 'Commitment' }
              ];
              const recoColor = { 
                yes: '#2F6F62', approve: '#2F6F62', 
                no: '#d23b40', pass: '#d23b40', reject: '#d23b40',
                maybe: '#9a6206', waitlist: '#9a6206', 
                interview: '#4f46e5' 
              };
              const recoLabel = { 
                yes: 'Approve', approve: 'Approve', 
                no: 'Pass', pass: 'Pass', reject: 'Pass',
                maybe: 'Hold', waitlist: 'Hold', 
                interview: 'Interview' 
              };
              const isUnderInterview = (s.chip === 'JURY REVIEW' || (s.jury && s.jury.reco === 'interview')) && !s.interviewCompleted;
              return (
                <div style={{ marginTop: 24 }}>
                  {isUnderInterview && (
                    <div className="os-banner amber" style={{ borderRadius: 2, marginBottom: 16 }}>
                      <div>
                        <div className="os-banner-title" style={{ color: '#9a6206' }}>Interview requested</div>
                        <div className="os-banner-text" style={{ fontSize: 13 }}>This application is under interview review process.</div>
                      </div>
                    </div>
                  )}
                  <div className="os-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                      <span className="cem-kicker">&sect; Jury Evaluation</span>
                      <h3 className="cem-title">Final Jury Panel</h3>
                    </div>
                    <div className="rv-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                      {assigned.map((j, ji) => {
                        const scores = ji === 0 ? s.jury : (s.juryScores && s.juryScores[j.id]) || s.jury;
                        const pVal = getJuryMetricScore(scores, 'problem', s.id);
                        const sVal = getJuryMetricScore(scores, 'solution', s.id);
                        const tVal = getJuryMetricScore(scores, 'tech', s.id);
                        const fVal = getJuryMetricScore(scores, 'founders', s.id);
                        const cVal = getJuryMetricScore(scores, 'commit', s.id);
                        const avg = (pVal + sVal + tVal + fVal + cVal) / 5;
                        const initials = j.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                        const isReqJury = s.juryRequestedBy && s.juryRequestedBy.includes(j.name);
                        const isInterviewer = (s.juryRequestedBy && s.juryRequestedBy.includes(j.name)) || (ji === 0);
                        const hasConducted = s.interviewCompleted && isInterviewer;
                        const isPrimary = hasConducted;

                        const jReco = getJuryReco(scores, j.id, s.id).toLowerCase();
                        const recoTone = (jReco === 'yes' || jReco === 'approve') ? 'green'
                          : (jReco === 'no' || jReco === 'pass' || jReco === 'reject') ? 'red'
                          : (jReco === 'interview') ? 'blue' : 'amber';
                        const badgeLabel = recoLabel[jReco] || jReco;
                        const juryNote = (scores && scores.notes) || (
                          (jReco === 'yes' || jReco === 'approve') ? 'Strong overall candidate — recommend advancing to the cohort.'
                          : (jReco === 'interview') ? 'Promising profile; recommend an interview to confirm execution capability.'
                          : (jReco === 'no' || jReco === 'pass' || jReco === 'reject') ? 'Not convinced this is the right fit for the cohort at this stage.'
                          : 'Solid potential; a few areas need further validation before a firm decision.'
                        );
                        const juryFlags = s.flags && hasConducted ? s.flags : [];

                        return (
                          <div key={j.id} className={"rv-card" + (isPrimary ? " is-primary" : "")}>
                            <div className="rv-card-head">
                              <div className="rv-card-id">
                                <span className="os-avatar" style={{ width: 38, height: 38, fontSize: 15, flexShrink: 0, background: isPrimary ? 'var(--brand-violet)' : 'var(--accent-soft)', color: isPrimary ? '#fff' : 'var(--artblue)' }}>{initials}</span>
                                <div style={{ minWidth: 0 }}>
                                  <div className="rv-card-name">{j.name}</div>
                                  <div className="rv-card-role">{j.org || 'Jury member'}</div>
                                </div>
                              </div>
                              <span className={`os-chip ${recoTone}`} style={{ flexShrink: 0 }}>{(badgeLabel || '').toUpperCase()}</span>
                            </div>

                            <div>
                              {hasConducted
                                ? <span className="os-chip green" style={{ fontSize: 10 }}>&#10003; Conducted interview</span>
                                : isReqJury
                                  ? <span className="os-chip purple" style={{ fontSize: 10 }}>Requested interview</span>
                                  : <span className="os-chip slate" style={{ fontSize: 10 }}>Panel evaluation</span>}
                            </div>

                            <div className="rv-overall">
                              <span className="rv-overall-label">Overall rating</span>
                              <span className="rv-overall-num">{avg > 0 ? avg.toFixed(1) : '—'}</span>
                            </div>

                            <div className="rv-scores">
                              {jMetrics.map(m => {
                                const val = getJuryMetricScore(scores, m.key, s.id);
                                const comment = getJuryMetricComment(j.id, m.key, s.id);
                                return (
                                  <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <div className="rv-score">
                                      <span className="rv-score-label">{m.label}</span>
                                      <span className="rv-bar"><span className="rv-bar-fill" style={{ width: Math.max(0, Math.min(100, (val || 0) * 10)) + '%' }} /></span>
                                      <span className="rv-score-num">{val != null ? val.toFixed(1) : '—'}</span>
                                    </div>
                                    {comment && <p className="rv-note-text" style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>"{comment}"</p>}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="rv-note">
                              <span className="rv-block-label">Jury note</span>
                              <p className="rv-note-text">{juryNote}</p>
                            </div>

                            <div className="rv-flags">
                              <span className="rv-block-label">Flags raised ({juryFlags.length})</span>
                              {juryFlags.length > 0 ? (
                                <div className="rv-flag-list">
                                  {juryFlags.map((f, idx) => (
                                    <div className="rv-flag" key={idx}><span className="rv-flag-mark">⚑</span><span>{f}</span></div>
                                  ))}
                                </div>
                              ) : (
                                <span className="rv-flags-empty">No flags raised.</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TIR Signal Profile Card */}
            {(() => {
              const tirOverall = getTIRSignalOverall(s);
              return (
                <div className="os-card" style={{ marginTop: 24, borderLeft: '4px solid #1f0a8a' }}>
                  <div className="os-card-title os-mb-sm" style={{ color: '#1f0a8a' }}>TIR Signal Profile</div>
                  <div className="os-stack gap-sm">
                    {TIR_METRICS.map(m => {
                      const tirVal = getTIRSignalScore(s, m.key);
                      return (
                        <div key={m.key}>
                          <div className="os-row between os-text-sm">
                            <span className="os-text-soft" style={{ fontSize: 12.5 }}>{m.label}</span>
                            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{tirVal.toFixed(1)}</span>
                          </div>
                          <div style={{ height: 6, background: '#eef0f4', borderRadius: 999, overflow: 'hidden', marginTop: 5 }}>
                            <div style={{ width: (tirVal * 10) + '%', height: '100%', background: '#1f0a8a', borderRadius: 999 }} />
                          </div>
                        </div>
                      );
                    })}
                    <hr className="os-divider" style={{ margin: '8px 0' }} />
                    <div className="os-row between">
                      <span className="os-text-xs os-text-dim os-uppercase" style={{ color: '#1f0a8a' }}>TIR Overall</span>
                      <span className="os-num-big" style={{ fontSize: 24, fontFamily: 'var(--font-sans)', fontWeight: 800, color: '#1f0a8a' }}>{tirOverall.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="os-stack">
          {s.interviewCompleted && s.juryInterviewRemarks && (
            <div className="os-card" style={{ background: '#eef5f1', borderLeft: '4px solid #2F6F62' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#2F6F62', letterSpacing: '0.1em', marginBottom: 6 }}>
                Jury Interview Remarks
              </div>
              <div style={{ fontSize: 13.5, fontStyle: 'italic', color: 'var(--ink)', lineHeight: 1.5 }}>
                "{s.juryInterviewRemarks}"
              </div>
            </div>
          )}

          <div className="os-card" style={{ background: 'var(--artlight)', border: '1px solid transparent' }}>
            <div className="os-row between" style={{ alignItems: 'center', marginBottom: 12 }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: '0.12em', color: 'var(--artblue)' }}>Reviewer Score</span>
              <span className="os-num-big" style={{ fontSize: 22, fontWeight: 600, color: 'var(--artblue)' }}>
                {s.rev ? (window.calculateWeightedReviewerAverage ? window.calculateWeightedReviewerAverage(s, 'overall') : s.rev.overall || 0).toFixed(2) : '—'}
              </span>
            </div>
            <div className="os-row between" style={{ alignItems: 'center', marginBottom: 12 }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: '0.12em', color: 'var(--accent)' }}>Jury Avg Score</span>
              <span className="os-num-big" style={{ fontSize: 22, fontWeight: 600, color: 'var(--accent)' }}>
                {getJuryAvg(s) > 0 ? getJuryAvg(s).toFixed(2) : '—'}
              </span>
            </div>
            <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0' }} />
            <div className="os-row between" style={{ alignItems: 'center' }}>
              <span className="os-text-xs os-uppercase" style={{ fontWeight: 700, letterSpacing: '0.12em', color: 'var(--ink)' }}>Combined Score</span>
              <span className="os-num-big" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)' }}>
                {getCombined(s) > 0 ? getCombined(s).toFixed(2) : '—'}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Decision</div>
            <div className="os-reco-group">
              <button className={'os-reco-btn approve ' + (decisions[s.id]==='approve' ? 'active':'')} onClick={() => decide('approve')}>Cohort</button>
              <button className={'os-reco-btn waitlist ' + (decisions[s.id]==='waitlist' ? 'active':'')} onClick={() => decide('waitlist')}>Waitlist</button>
              <button className={'os-reco-btn reject ' + (decisions[s.id]==='reject' ? 'active':'')} onClick={() => decide('reject')}>Reject</button>
            </div>
            <textarea className="os-input os-w-100 os-mt" rows="3" placeholder="Decision rationale (optional)…"
              value={notes[s.id] || ''}
              onChange={e => setNotes({ ...notes, [s.id]: e.target.value })}
              onBlur={() => { s.adminRationale = notes[s.id] || ''; if (window.persistOSData) window.persistOSData(); }}
            />
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Progress</div>
            <div className="os-row gap-sm" style={{ flexWrap: 'wrap' }}>
              {items.map((it,i) => {
                const dec = decisions[it.id];
                const t = dec === 'approve'  ? { bg:'#eef5f1', fg:'#2F6F62', bd:'#bcd7cd' }
                        : dec === 'reject'   ? { bg:'#fff0f0', fg:'#d23b40', bd:'#f8c2c4' }
                        : dec === 'waitlist' ? { bg:'#fff8e6', fg:'#9a6206', bd:'#f6d98a' }
                        : { bg:'var(--bg-soft)', fg:'var(--ink-dim)', bd:'var(--line)' };
                const itReq = it.jury && (it.jury.reco === 'interview' || it.jury.reco === 'maybe' || it.jury.reco === 'yes');
                return (
                  <div key={i} onClick={() => setIdx(i)}
                       style={{ width:26, height:26, borderRadius:6, display:'grid', placeItems:'center',
                                background:t.bg, color:t.fg, border:'1px solid '+t.bd,
                                fontFamily:'var(--font-sans)', fontSize:12, fontWeight:600, cursor:'pointer',
                                outline: i===idx ? '2px solid var(--accent)' : 'none', outlineOffset:1,
                                position:'relative' }}>
                    {i+1}
                    {itReq && (
                      <span style={{ position:'absolute', top:-3, right:-3, width:8, height:8,
                                     borderRadius:'50%', background:'#6366f1', border:'1.5px solid #fff' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Jury Gate Interviews (Variant B) ============
function JuryGateInterviews({ goDetail }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const items = window.OS_DATA.STARTUPS.filter(s => {
    const c = (s.chip || '').toUpperCase();
    // Include standard jury-stage chips OR any startup where an interview was explicitly requested
    const isJuryStage = c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
    const isInterviewReco = s.jury && (s.jury.reco === 'interview' || s.interviewRequested === true);
    return isJuryStage || isInterviewReco;
  });

  const getAssignedJuries = (st) => {
    if (!window.OS_DATA || !window.OS_DATA.JURY) return [];
    return window.OS_DATA.JURY.filter(j => j.startups && j.startups.includes(st.id));
  };

  const getJuriesWhoRequested = (st, assigned) => {
    if (!st.jury) return [];
    if (st.juryRequestedBy) return st.juryRequestedBy;
    if ((st.jury.reco === 'interview' || st.jury.reco === 'maybe' || st.jury.reco === 'yes') && assigned.length > 0) {
      return [assigned[0].name];
    }
    return [];
  };

  const getSimulatedJuryRemarks = (st) => {
    if (st.juryInterviewRemarks) return st.juryInterviewRemarks;
    const assigned = getAssignedJuries(st);
    const juryNames = assigned.map(j => j.name).join(' & ') || 'Jury Panel';
    const templates = [
      `Strong technical foundation. The team demonstrated deep understanding of their market. Recommend acceptance.`,
      `Excellent presentation by the founder. Defensibility is clear, but business model needs refinement.`,
      `Good progress, but market size might be a constraint. Calibrated well on fit.`,
      `Highly innovative product. The tech stack is mature, and they have solid IP potential.`
    ];
    const idx = st.id.charCodeAt(st.id.length - 1) % templates.length;
    const remark = `[${juryNames}]: ${templates[idx]}`;
    st.juryInterviewRemarks = remark;
    return remark;
  };

  const handleSendCalendly = (s) => {
    s.calendlySent = true;
    s.calendlySentAt = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    s.chip = 'JURY REVIEW'; // mark as under interview review
    if (window.persistOSData) window.persistOSData();
    window.alert(`Email sent to founder of ${s.name} containing booking link (${s.interviewCalendarLink || 'https://calendly.com/artpark/cohort-interview'}).`);
    forceUpdate();
  };

  const handleDecision = (s, value) => {
    if (value === 'ACCEPT') {
      s.chip = 'ACCEPTED';
      s.adminDecision = 'APPROVED';
    } else if (value === 'WAITLIST') {
      s.chip = 'WAITLISTED';
      s.adminDecision = 'WAITLISTED';
    } else if (value === 'REJECT') {
      s.chip = 'REJECTED';
      s.adminDecision = 'REJECTED';
    } else {
      s.chip = 'JURY REVIEW';
      s.adminDecision = 'PENDING';
    }
    if (window.persistOSData) window.persistOSData();
    forceUpdate();
  };

  return (
    <div>
      <div className="os-row between os-mb" style={{ marginBottom: 20 }}>
        <div className="os-row gap-sm">
          <span className="os-chip purple">VARIANT B · INTERVIEWS</span>
          <span className="os-text-soft">Manage booking invites, input remarks, and finalize selections.</span>
        </div>
      </div>

      <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-soft)', borderRadius: 4, fontSize: 13, borderLeft: '4px solid var(--accent)' }}>
        <strong>Note:</strong> These applications have received explicit requests for interviews from the Jury. Below, you can track which jury members are deciding on each application, who requested the interview, schedule the date/time, send the booking invite link, and finalize decisions.
      </div>

      <div className="os-card" style={{ padding: 24 }}>
        <table className="os-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>Startup & Deciding Jury</th>
              <th style={{ width: '25%' }}>Booking Invite Link</th>
              <th style={{ width: '22%' }}>Interview Schedule</th>
              <th style={{ width: '28%' }}>Jury Remarks & Decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map(s => {
              const assigned = getAssignedJuries(s);
              const juryNamesStr = assigned.length > 0 ? assigned.map(j => j.name).join(', ') : 'No jury assigned';
              const requestedJuries = getJuriesWhoRequested(s, assigned);
              const requestedJuriesStr = requestedJuries.length > 0 ? requestedJuries.join(', ') : 'External Jury';

              return (
                <tr key={s.id} style={{ background: s.interviewCompleted ? 'rgba(47, 111, 98, 0.08)' : 'none', transition: 'background 0.3s ease' }}>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{s.domain} · {s.stage}</div>
                      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span style={{ fontWeight: 600 }}>Deciding:</span> {juryNamesStr}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                        <span style={{ fontWeight: 600 }}>Requested by:</span> <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{requestedJuriesStr}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <button className="os-btn xs secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => goDetail(s.id)}>View App</button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input 
                        type="text" 
                        className="os-input sm" 
                        style={{ fontSize: 11, padding: '4px 6px', width: '100%' }}
                        placeholder="Invite link (e.g. Calendly)..."
                        defaultValue={s.interviewCalendarLink || 'https://calendly.com/artpark/cohort-interview'}
                        onBlur={e => { s.interviewCalendarLink = e.target.value; if (window.persistOSData) window.persistOSData(); }}
                      />
                      {s.calendlySent ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F6F62' }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#2F6F62' }}>Sent {s.calendlySentAt}</span>
                          </div>
                          <button className="os-btn sm secondary" style={{ fontSize: 10, padding: '2px 8px', marginTop: 2 }} onClick={() => handleSendCalendly(s)}>
                            Re-send Invite
                          </button>
                        </>
                      ) : (
                        <button className="os-btn sm" style={{ fontSize: 11, padding: '4px 10px', background: 'var(--accent)', color: '#fff', alignSelf: 'flex-start' }} onClick={() => handleSendCalendly(s)}>
                          Send invite link
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input 
                        type="datetime-local" 
                        className="os-input sm" 
                        style={{ fontSize: 11, padding: '4px 6px', width: '100%' }}
                        value={s.interviewDateTime || ''}
                        onChange={e => {
                          s.interviewDateTime = e.target.value;
                          if (window.persistOSData) window.persistOSData();
                          forceUpdate();
                        }}
                      />
                      {s.interviewDateTime && (
                        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--ink-soft)' }}>
                          Scheduled: {new Date(s.interviewDateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                      <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                        <input 
                          type="checkbox" 
                          checked={!!s.interviewCompleted} 
                          onChange={e => {
                            s.interviewCompleted = e.target.checked;
                            if (s.interviewCompleted) {
                              s.chip = 'JURY REVIEW';
                            }
                            if (window.persistOSData) window.persistOSData();
                            forceUpdate();
                          }}
                        />
                        <span style={{ fontWeight: 600 }}>Interview Done</span>
                      </label>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {s.interviewCompleted ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)' }}>Jury remarks · editable</span>
                          <textarea
                            className="os-input"
                            style={{ fontSize: 12, padding: '6px 8px', width: '100%', minHeight: 58, lineHeight: 1.5, resize: 'vertical' }}
                            defaultValue={getSimulatedJuryRemarks(s)}
                            placeholder="Record the jury's interview remarks…"
                            onBlur={e => { s.juryInterviewRemarks = e.target.value; if (window.persistOSData) window.persistOSData(); }}
                          />
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--ink-dim)', fontStyle: 'italic' }}>
                          Pending interview completion...
                        </div>
                      )}
                      <div className="os-row gap-xs" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                        <button className={`os-btn sm ${s.chip === 'ACCEPTED' ? 'green' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'ACCEPT')}>Accept</button>
                        <button className={`os-btn sm ${s.chip === 'WAITLISTED' ? 'amber' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'WAITLIST')}>Waitlist</button>
                        <button className={`os-btn sm ${s.chip === 'REJECTED' ? 'red' : 'secondary'}`} style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleDecision(s, 'REJECT')}>Reject</button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ Jury Gate Batch Decision (Variant C) ============
function JuryGateBatchDecision() {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  const pendingStartups = window.OS_DATA.STARTUPS.filter(s => {
    const c = (s.chip || '').toUpperCase();
    return (c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'WAITLISTED') && s.adminDecision !== 'APPROVED' && s.adminDecision !== 'REJECTED';
  });

  const [draftDecisions, setDraftDecisions] = React.useState({}); // map of startup.id -> 'ACCEPT' | 'WAITLIST' | 'REJECT'

  const handleDraftSelect = (id, dec) => {
    setDraftDecisions(prev => ({ ...prev, [id]: dec }));
  };

  const handlePushDecisions = () => {
    const selectedToPush = pendingStartups.filter(s => draftDecisions[s.id]);
    if (selectedToPush.length === 0) return;

    const listText = selectedToPush.map(s => `• ${s.name} → ${draftDecisions[s.id]}`).join('\n');
    const confirmed = window.confirm(`You are about to push final gate decisions for ${selectedToPush.length} startup(s):\n\n${listText}\n\nAre you sure you want to finalize these decisions?`);

    if (confirmed) {
      selectedToPush.forEach(s => {
        const dec = draftDecisions[s.id];
        if (dec === 'ACCEPT') {
          s.chip = 'ACCEPTED';
          s.adminDecision = 'APPROVED';
        } else if (dec === 'WAITLIST') {
          s.chip = 'WAITLISTED';
          s.adminDecision = 'WAITLISTED';
        } else if (dec === 'REJECT') {
          s.chip = 'REJECTED';
          s.adminDecision = 'REJECTED';
        }
      });

      if (window.persistOSData) window.persistOSData();

      const remainingDrafts = { ...draftDecisions };
      selectedToPush.forEach(s => { delete remainingDrafts[s.id]; });
      setDraftDecisions(remainingDrafts);

      alert(`Successfully pushed final decisions for ${selectedToPush.length} application(s).`);
      forceUpdate();
    }
  };

  const getJuryAvg = (st) => {
    return globalGetJuryAvg(st);
  };

  const countPushed = pendingStartups.filter(s => draftDecisions[s.id]).length;

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">BATCH DECISIONS</span>
          <div className="os-text-soft" style={{ fontSize: 13, marginTop: 4 }}>Apply decisions to multiple applications at once.</div>
        </div>
      </div>

      <div className="os-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
            Showing <strong>{pendingStartups.length}</strong> applications pending final decision.
          </div>
          <button 
            className="os-btn" 
            style={{ background: countPushed > 0 ? 'var(--accent)' : 'var(--line)', borderColor: countPushed > 0 ? 'var(--accent)' : 'var(--line)', color: countPushed > 0 ? '#fff' : 'var(--ink-dim)', cursor: countPushed > 0 ? 'pointer' : 'not-allowed' }}
            disabled={countPushed === 0}
            onClick={handlePushDecisions}
          >
            Push {countPushed} Decisions
          </button>
        </div>

        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th className="num">Rev Score</th>
              <th className="num">Jury Score</th>
              <th>Jury Reco</th>
              <th>Draft Decision</th>
            </tr>
          </thead>
          <tbody>
            {pendingStartups.map(s => {
              const rScore = s.rev ? (s.rev.overall || 0) : 0;
              const jScore = getJuryAvg(s);
              const jReco = s.jury ? (s.jury.reco || 'maybe') : 'none';
              const draft = draftDecisions[s.id] || '';

              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{s.domain} · {s.stage}</div>
                  </td>
                  <td className="num">{rScore > 0 ? rScore.toFixed(1) : '—'}</td>
                  <td className="num">{jScore > 0 ? jScore.toFixed(1) : '—'}</td>
                  <td>
                    <Chip tone={jReco === 'approve' || jReco === 'yes' ? 'green' : jReco === 'reject' || jReco === 'no' ? 'red' : 'amber'}>
                      {jReco.toUpperCase()}
                    </Chip>
                  </td>
                  <td>
                    <div className="os-row gap-xs">
                      <button 
                        className={`os-btn sm ${draft === 'ACCEPT' ? 'green' : 'secondary ghost'}`} 
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'ACCEPT' ? null : 'ACCEPT')}
                      >
                        Accept
                      </button>
                      <button 
                        className={`os-btn sm ${draft === 'WAITLIST' ? 'amber' : 'secondary ghost'}`} 
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'WAITLIST' ? null : 'WAITLIST')}
                      >
                        Waitlist
                      </button>
                      <button 
                        className={`os-btn sm ${draft === 'REJECT' ? 'red' : 'secondary ghost'}`} 
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => handleDraftSelect(s.id, draft === 'REJECT' ? null : 'REJECT')}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pendingStartups.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: 24, color: 'var(--ink-soft)' }}>
                  All shortlisted startups have finalized decisions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ Jury Gate History (Variant D) ============
function JuryGateHistory({ goDetail }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [editingId, setEditingId] = React.useState(null);

  // Decided startups on the jury side
  const startups = window.OS_DATA.STARTUPS.filter(s => 
    (s.chip === 'ACCEPTED' || s.chip === 'REJECTED' || s.chip === 'WAITLISTED') && s.adminDecision
  );

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

  const renderHeader = (label, colKey) => {
    const isSorted = sortCol === colKey;
    return (
      <th 
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

  const getJuryAvg = (st) => {
    return globalGetJuryAvg(st);
  };

  const getCombined = (st) => {
    const rScore = st.rev ? (st.rev.overall || 0) : 0;
    const jScore = getJuryAvg(st);
    if (rScore > 0 && jScore > 0) return (rScore + jScore) / 2;
    return rScore > 0 ? rScore : jScore;
  };

  const sortedStartups = React.useMemo(() => {
    if (!sortCol) return startups;
    return [...startups].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortCol === 'sub') {
        valA = a.sub || '';
        valB = b.sub || '';
      } else if (sortCol === 'rev') {
        valA = a.rev ? a.rev.overall : -1;
        valB = b.rev ? b.rev.overall : -1;
      } else if (sortCol === 'jury') {
        valA = getJuryAvg(a);
        valB = getJuryAvg(b);
      } else if (sortCol === 'combined') {
        valA = getCombined(a);
        valB = getCombined(b);
      } else if (sortCol === 'adminDecision') {
        valA = a.adminDecision || '';
        valB = b.adminDecision || '';
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [startups, sortCol, sortAsc]);

  const handleSaveDecision = (id, newDec) => {
    const s = window.OS_DATA.STARTUPS.find(x => x.id === id);
    if (s) {
      if (newDec === 'APPROVED') {
        s.chip = 'ACCEPTED';
        s.adminDecision = 'APPROVED';
      } else if (newDec === 'REJECTED') {
        s.chip = 'REJECTED';
        s.adminDecision = 'REJECTED';
      } else if (newDec === 'HOLD') {
        s.chip = 'WAITLISTED';
        s.adminDecision = 'WAITLISTED';
      }
      
      if (window.persistOSData) window.persistOSData();
      setEditingId(null);
      forceUpdate();
    }
  };

  return (
    <div>
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">HISTORY</span>
          <h2 className="lp-section-title">Final Gate decisions history</h2>
          <div className="lp-section-sub">All applications finalized at the cohort selection gate.</div>
        </div>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            {renderHeader('Startup', 'name')}
            {renderHeader('Submitted Date', 'sub')}
            {renderHeader('Reviewer Score', 'rev', true)}
            {renderHeader('Jury Score', 'jury')}
            {renderHeader('Combined Score', 'combined')}
            {renderHeader('Final Decision', 'adminDecision')}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedStartups.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '32px', color: 'var(--ink-dim)', fontSize: 14 }}>
                No decisions recorded in final gate history yet.
              </td>
            </tr>
          ) : (
            sortedStartups.map((s) => {
              const isEditing = editingId === s.id;
              const rScore = s.rev ? (s.rev.overall || 0) : 0;
              const jScore = getJuryAvg(s);
              const combined = getCombined(s);

              const itReq = s.jury && (s.jury.reco === 'interview' || s.jury.reco === 'maybe' || s.jury.reco === 'yes');

              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14 }}>{s.name}</b>
                      {itReq && <span className="os-chip purple" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 'bold' }}>Interview Requested</span>}
                      {s.interviewCompleted && <span className="os-chip green" style={{ fontSize: 9, padding: '1px 5px', fontWeight: 'bold' }}>Interviewed</span>}
                    </div>
                    {s.interviewCompleted && s.juryInterviewRemarks && (
                      <div style={{ fontSize: 10.5, color: '#2F6F62', fontStyle: 'italic', marginTop: 4 }}>
                        Remarks: "{s.juryInterviewRemarks}"
                      </div>
                    )}
                    <div style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.sub || '02 Jun 2026'}</td>
                  <td className="num">{rScore > 0 ? rScore.toFixed(1) : '—'}</td>
                  <td className="num">{jScore > 0 ? jScore.toFixed(1) : '—'}</td>
                  <td className="num"><b>{combined > 0 ? combined.toFixed(1) : '—'}</b></td>
                  <td>
                    {isEditing ? (
                      <div className="os-row gap-xs" style={{ flexWrap: 'nowrap' }}>
                        <button className="os-btn sm green" onClick={() => handleSaveDecision(s.id, 'APPROVED')} style={{ padding: '3px 8px', fontSize: 11 }}>Accept</button>
                        <button className="os-btn sm amber" onClick={() => handleSaveDecision(s.id, 'HOLD')} style={{ padding: '3px 8px', fontSize: 11 }}>Waitlist</button>
                        <button className="os-btn sm red" onClick={() => handleSaveDecision(s.id, 'REJECTED')} style={{ padding: '3px 8px', fontSize: 11 }}>Reject</button>
                      </div>
                    ) : (
                      <Chip tone={s.chip === 'ACCEPTED' ? 'green' : s.chip === 'WAITLISTED' ? 'amber' : 'red'}>
                        {s.chip.toUpperCase()}
                      </Chip>
                    )}
                  </td>
                  <td>
                    <div className="os-row gap-xs">
                      <button className="os-btn sm secondary" onClick={() => goDetail(s.id)}>View App</button>
                      {!isEditing && (
                        <button className="os-btn sm ghost" onClick={() => setEditingId(s.id)}>Edit</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============ A-7 Gate 2 Final (Main Tab Controller) ============
function AdminGate2({ goDetail }) {
  const [variant, setVariant] = useAS2('stack');

  return (
    <div>
      <PageHead
        eyebrow="A-7 · FINAL GATE"
        title='Final <em>Decisions</em>'
        sub="Choose a workflow to finalize cohort onboarding decisions or schedule interviews."
      />
      <div className="os-row gap-sm os-mb-lg" style={{ marginBottom: 24 }}>
        <div className={'os-tab ' + (variant==='stack'?'active':'')} onClick={()=>setVariant('stack')}>A · Status</div>
        <div className={'os-tab ' + (variant==='interview'?'active':'')} onClick={()=>setVariant('interview')}>B · Interview Scheduling</div>
        <div className={'os-tab ' + (variant==='batch'?'active':'')} onClick={()=>setVariant('batch')}>C · Batch decision</div>
        <div className={'os-tab ' + (variant==='history'?'active':'')} onClick={()=>setVariant('history')}>D · My history</div>
      </div>
      {variant==='stack' && <JuryGateStack goDetail={goDetail} />}
      {variant==='interview' && <JuryGateInterviews goDetail={goDetail} />}
      {variant==='batch' && <JuryGateBatchDecision />}
      {variant==='history' && <JuryGateHistory goDetail={goDetail} />}
    </div>
  );
}

// ============ A-9 Analytics ============
function AdminAnalytics() {
  return (
    <div>
      <PageHead eyebrow="A-9 · ANALYTICS" title='Cohort <em>Analytics</em>' sub="Deep dive into score distributions, funnel conversion, and reviewer calibration." />
      <div className="os-grid-2">
        <div className="os-card">
          <div className="os-card-title os-mb-sm">Reviewer Calibration Index</div>
          <p className="os-text-sm os-text-soft">Reviewers exhibiting systematic bias vs cohort average.</p>
          <table className="os-table">
            <thead><tr><th>Reviewer</th><th>Avg Score</th><th>vs Cohort Avg</th></tr></thead>
            <tbody>
              <tr><td>Saurabh Mehta</td><td>6.2</td><td><Variance value={0.6}/></td></tr>
              <tr><td>Dr. R. Iyer</td><td>7.1</td><td><Variance value={0.3}/></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminRoles() {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: isNum ? 'flex-end' : 'flex-start', width: '100%' }}>
          {label}
          {isSorted ? (sortAsc ? ' ▲' : ' ▼') : ''}
        </span>
      </th>
    );
  };

  // Initialize users in window.OS_DATA if not present
  if (!window.OS_DATA.USERS) {
    window.OS_DATA.USERS = [
      { id: 'u1', name: 'Vikram Sundar', email: 'vikram.s@artpark.in', roles: ['Reviewer'], joined: '10 Jan 2026' },
      { id: 'u2', name: 'Dr. Aishwarya Pillai', email: 'aishwarya.p@iisc.ac.in', roles: ['Reviewer', 'Leadership'], joined: '14 Jan 2026' },
      { id: 'u3', name: 'Anand Mahindra', email: 'mahindra.a@mahindra.com', roles: ['Jury'], joined: '15 Jan 2026' },
      { id: 'u4', name: 'Kiran Mazumdar-Shaw', email: 'kiran.ms@biocon.com', roles: ['Jury'], joined: '18 Jan 2026' },
      { id: 'u5', name: 'Nandan Nilekani', email: 'nandan@nilekanict.org', roles: ['Jury', 'Leadership'], joined: '20 Jan 2026' },
      { id: 'u6', name: 'Aanya Mehta', email: 'aanya@karkhanarobotics.com', roles: ['Founder'], joined: '12 Apr 2026' },
      { id: 'u7', name: 'Vikram Shah', email: 'vikram@saathihealth.ai', roles: ['Founder'], joined: '14 Apr 2026' },
      { id: 'u8', name: 'Amit Sharma', email: 'amit.sharma@artpark.in', roles: ['Leadership'], joined: '01 Jan 2026' },
      { id: 'u9', name: 'Preeti Nair', email: 'preeti.n@artpark.in', roles: ['Reviewer'], joined: '05 Jan 2026' },
      { id: 'u10', name: 'Dr. Tara Pillai', email: 'tara.pillai@mihira.com', roles: ['Founder'], joined: '01 Apr 2026' }
    ];
    if (window.persistOSData) window.persistOSData();
  }

  const users = window.OS_DATA.USERS;

  const [search, setSearch] = React.useState('');
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');
  const [newRoles, setNewRoles] = React.useState([]);
  const [addUserPassword, setAddUserPassword] = React.useState('');

  const [editingUser, setEditingUser] = React.useState(null);
  const [editRoles, setEditRoles] = React.useState([]);

  const allAvailableRoles = ['Reviewer', 'Jury', 'Leadership', 'Founder'];

  const getRoleColor = (role) => {
    switch (role) {
      case 'Reviewer': return 'blue';
      case 'Jury': return 'green';
      case 'Leadership': return 'indigo';
      case 'Founder': return 'amber';
      default: return '';
    }
  };

  const handleAddUser = () => {
    if (!newName || !newEmail) {
      alert("Name and Email are required");
      return;
    }
    const newUser = {
      id: 'u' + (users.length + 1),
      name: newName,
      email: newEmail,
      roles: newRoles,
      joined: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    };
    users.push(newUser);
    if (window.persistOSData) window.persistOSData();
    
    // Log role action in activity if possible
    if (window.OS_DATA.ACTIVITY) {
      window.OS_DATA.ACTIVITY.unshift({
        ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actor: 'Admin',
        what: `created user ${newName} with roles: ${newRoles.join(', ') || 'None'}`,
        type: 'gate'
      });
      if (window.persistOSData) window.persistOSData();
    }

    alert(`Member invited successfully!\n\nEmail: ${newEmail}\nPassword: ${addUserPassword}\n\nYou can now copy and send these login credentials to the user.`);

    setNewName('');
    setNewEmail('');
    setNewRoles([]);
    setShowAddModal(false);
    forceUpdate();
  };

  const handleSaveEditRoles = () => {
    if (!editingUser) return;
    const oldRoles = editingUser.roles.join(', ') || 'None';
    editingUser.roles = editRoles;
    if (window.persistOSData) window.persistOSData();

    // Log action
    if (window.OS_DATA.ACTIVITY) {
      window.OS_DATA.ACTIVITY.unshift({
        ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actor: 'Admin',
        what: `updated roles of ${editingUser.name} from [${oldRoles}] to [${editRoles.join(', ') || 'None'}]`,
        type: 'gate'
      });
      if (window.persistOSData) window.persistOSData();
    }

    setEditingUser(null);
    setEditRoles([]);
    forceUpdate();
  };

  const toggleNewRole = (role) => {
    if (newRoles.includes(role)) {
      setNewRoles(newRoles.filter(r => r !== role));
    } else {
      setNewRoles([...newRoles, role]);
    }
  };

  const toggleEditRole = (role) => {
    if (editRoles.includes(role)) {
      setEditRoles(editRoles.filter(r => r !== role));
    } else {
      setEditRoles([...editRoles, role]);
    }
  };

  const handleDeleteUser = (user) => {
    if (confirm(`Are you sure you want to delete ${user.name}?`)) {
      window.OS_DATA.USERS = users.filter(u => u.id !== user.id);
      if (window.persistOSData) window.persistOSData();
      forceUpdate();
    }
  };

  // Filtered users
  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const sortedUsers = React.useMemo(() => {
    if (!sortCol) return filteredUsers;
    return [...filteredUsers].sort((a, b) => {
      let valA, valB;
      if (sortCol === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortCol === 'roles') {
        valA = a.roles.join(', ') || '';
        valB = b.roles.join(', ') || '';
      } else if (sortCol === 'joined') {
        valA = a.joined || '';
        valB = b.joined || '';
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filteredUsers, sortCol, sortAsc]);

  // Stats calculation
  const totalUsers = users.length;
  const roleCounts = { Reviewer: 0, Jury: 0, Leadership: 0, Founder: 0 };
  let multiRoleCount = 0;
  users.forEach(u => {
    u.roles.forEach(r => {
      if (roleCounts[r] !== undefined) roleCounts[r]++;
    });
    if (u.roles.length > 1) {
      multiRoleCount++;
    }
  });

  return (
    <div>
      <PageHead
        eyebrow="A-3B · ROLES MANAGEMENT"
        title="User <em>Access & Roles</em>"
        sub="Assign and manage system roles (Reviewers, Jury, Leadership, Founders) with multi-role support."
        actions={[
          <button key="add" className="os-btn" onClick={() => {
            setAddUserPassword(generateBasicPassword());
            setShowAddModal(true);
          }}>+ Invite Member</button>
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total Users</span>
          <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}>{totalUsers}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>System accounts</span>
        </div>
        <div className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Reviewers</span>
          <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color: 'var(--accent)' }}>{roleCounts.Reviewer}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Assigned to batches</span>
        </div>
        <div className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Jury Members</span>
          <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color: 'var(--brand-green)' }}>{roleCounts.Jury}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Evaluation panel</span>
        </div>
        <div className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Leadership</span>
          <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color: 'var(--brand-violet)' }}>{roleCounts.Leadership}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Admins & Managers</span>
        </div>
        <div className="os-card soft" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Founders</span>
          <span style={{ fontSize: 30, fontWeight: 400, fontFamily: 'var(--font-serif)', color: 'var(--brand-amber)' }}>{roleCounts.Founder}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Startup applicants</span>
        </div>
      </div>

      <div className="os-grid-sidebar">
        <div className="os-card" style={{ padding: 24 }}>
          <div className="os-row between os-mb" style={{ alignItems: 'center' }}>
            <div className="os-card-title">User List</div>
            <div className="os-search-wrap" style={{ width: 240 }}>
              <input 
                className="os-input search sm"
                placeholder="Search by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <table className="os-table">
            <thead>
              <tr>
                {renderHeader('User Details', 'name')}
                {renderHeader('Assigned Roles', 'roles')}
                {renderHeader('Joined', 'joined')}
                <th style={{ width: 120, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="os-row gap-sm" style={{ alignItems: 'center' }}>
                      <div className="os-avatar" style={{ width: 32, height: 32, fontSize: 12, flexShrink: 0 }}>
                        {String(u.name || '').split(' ').map(s=>s[0]).slice(0,2).join('')}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>{u.name}</div>
                        <div style={{ color: 'var(--ink-dim)', fontSize: 11 }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="os-row gap-xs" style={{ flexWrap: 'wrap' }}>
                      {u.roles.length === 0 ? (
                        <span style={{ color: 'var(--ink-dim)', fontStyle: 'italic', fontSize: 12 }}>No role assigned</span>
                      ) : (
                        u.roles.map(r => (
                          <Chip key={r} tone={getRoleColor(r)}>{r}</Chip>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="os-mono os-text-xs">{u.joined}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="os-row gap-xs" style={{ justifyContent: 'flex-end' }}>
                      <button 
                        className="os-btn sm ghost"
                        onClick={() => {
                          setEditingUser(u);
                          setEditRoles([...u.roles]);
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        className="os-btn sm ghost"
                        style={{ color: 'var(--brand-coral)' }}
                        onClick={() => handleDeleteUser(u)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-dim)', fontStyle: 'italic' }}>
                    No users found matching query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="os-stack gap-lg">
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Role Distribution</div>
            <p className="os-text-sm os-text-soft os-mb-lg">
              Visual share of access roles across the current workspace.
            </p>
            
            <div className="os-stack gap-md">
              {allAvailableRoles.map(role => {
                const count = roleCounts[role];
                const percentage = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
                const colorMap = {
                  Reviewer: 'var(--accent)',
                  Jury: 'var(--brand-green)',
                  Leadership: 'var(--brand-violet)',
                  Founder: 'var(--brand-amber)'
                };

                return (
                  <div key={role} className="os-stack gap-xs">
                    <div className="os-row between" style={{ fontSize: 12, fontWeight: 500 }}>
                      <span style={{ color: 'var(--ink)' }}>{role}s</span>
                      <span className="os-mono" style={{ color: 'var(--ink-dim)' }}>
                        {count} user{count !== 1 ? 's' : ''} ({percentage.toFixed(0)}%)
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 4, overflow: 'hidden' }}>
                      <div 
                        style={{ 
                          height: '100%', 
                          width: `${percentage}%`, 
                          background: colorMap[role],
                          borderRadius: 4,
                          transition: 'width 0.3s ease'
                        }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px dashed var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Multi-role overlap</span>
              <span className="os-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {multiRoleCount} user{multiRoleCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="os-card soft">
            <div className="os-card-title os-mb-sm">Access Logs</div>
            <div className="os-stack gap-sm os-mt-md" style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
              {window.OS_DATA.ACTIVITY && window.OS_DATA.ACTIVITY.filter(a => a.what.includes('role') || a.what.includes('user')).map((act, i) => (
                <div key={i} className="os-stack gap-xs" style={{ paddingBottom: 8, borderBottom: '1px solid rgba(36,36,36,0.04)' }}>
                  <div className="os-row between" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>
                    <span>{act.actor}</span>
                    <span>{act.ts}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                    {act.what}
                  </div>
                </div>
              ))}
              {(!window.OS_DATA.ACTIVITY || window.OS_DATA.ACTIVITY.filter(a => a.what.includes('role') || a.what.includes('user')).length === 0) && (
                <div style={{ fontSize: 11, color: 'var(--ink-dim)', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>
                  No recent access changes logged.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="os-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="os-modal-head">
              <div className="os-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Invite Member</div>
              <button className="os-close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-dim)' }} onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="os-modal-body os-stack gap-md">
              <div>
                <label className="os-label">FULL NAME</label>
                <input 
                  className="os-input os-w-100" 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)} 
                  placeholder="e.g. Vikram Sundar" 
                />
              </div>
              <div>
                <label className="os-label">EMAIL ADDRESS</label>
                <input 
                  className="os-input os-w-100" 
                  value={newEmail} 
                  onChange={e => setNewEmail(e.target.value)} 
                  placeholder="e.g. vikram.s@artpark.in" 
                />
              </div>
              <div>
                <label className="os-label">ASSIGN SYSTEM ROLES</label>
                <div className="os-stack gap-sm os-mt-sm">
                  {allAvailableRoles.map(role => (
                    <label key={role} className="os-row gap-sm" style={{ cursor: 'pointer', alignItems: 'center', fontSize: 13 }}>
                      <input 
                        type="checkbox" 
                        checked={newRoles.includes(role)} 
                        onChange={() => toggleNewRole(role)} 
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="os-label">TEMPORARY PASSWORD</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    type="text" 
                    className="os-input os-w-100 os-mono" 
                    style={{ fontSize: 13, background: 'var(--bg-soft)', fontWeight: 600 }}
                    value={addUserPassword}
                    readOnly
                  />
                  <button 
                    className="os-btn secondary sm"
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(addUserPassword);
                      alert("Password copied to clipboard!");
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="os-modal-foot">
              <button className="os-btn ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="os-btn" onClick={handleAddUser}>Invite Member</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="os-modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="os-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="os-modal-head">
              <div className="os-modal-title" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Edit User Access</div>
              <button className="os-close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-dim)' }} onClick={() => setEditingUser(null)}>×</button>
            </div>
            <div className="os-modal-body os-stack gap-md">
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Updating permissions for <strong style={{ color: 'var(--ink)' }}>{editingUser.name}</strong> ({editingUser.email}).
              </div>
              <div>
                <label className="os-label">ASSIGNED ROLES</label>
                <div className="os-stack gap-sm os-mt-sm">
                  {allAvailableRoles.map(role => (
                    <label key={role} className="os-row gap-sm" style={{ cursor: 'pointer', alignItems: 'center', fontSize: 13 }}>
                      <input 
                        type="checkbox" 
                        checked={editRoles.includes(role)} 
                        onChange={() => toggleEditRole(role)} 
                      />
                      <span>{role}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="os-modal-foot">
              <button className="os-btn ghost" onClick={() => setEditingUser(null)}>Cancel</button>
              <button className="os-btn" onClick={handleSaveEditRoles}>Save Permissions</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// LP-style topbar for Admin
function AdminTopbar({ page, decisionMode }) {
  const crumbMap = {
    dashboard:'DASHBOARD', pipeline:'APPLICATIONS', detail:'APPLICATION DETAIL',
    reviewers: decisionMode === 'jury' ? 'JURY PANEL' : 'REVIEWERS',
    roles:'USER ROLES',
    gate1: decisionMode === 'jury' ? 'FINAL GATE' : 'ADMIN REVIEW',
    psychometry:'PSYCHOMETRY',
    jury:'JURY MGMT', gate2:'GATE 2 FINAL', audit:'AUDIT LOG', analytics:'ANALYTICS',
  };
  const crumb = crumbMap[page] || 'DASHBOARD';
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClose = () => setMenuOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [menuOpen]);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [, forceTick] = React.useReducer(x => x + 1, 0);
  const allStartups = (window.OS_DATA && window.OS_DATA.STARTUPS) || [];
  const isStatus = (s, set) => { const c = (s.chip || '').toUpperCase(); const d = (s.adminDecision || '').toUpperCase(); return set.includes(c) || set.includes(d); };
  const archivedApps = allStartups.filter(s => s.archived);
  const hiddenApps = allStartups.filter(s => s.hidden && !s.archived);
  const heldApps = allStartups.filter(s => !s.archived && isStatus(s, ['HOLD', 'WAITLISTED']));
  const rejectedApps = allStartups.filter(s => !s.archived && isStatus(s, ['REJECTED']));
  // Persist + re-render the modal AND the whole admin app (so the list/dashboard update live).
  const afterMutate = () => {
    if (window.persistOSData) window.persistOSData();
    forceTick();
    if (window.__osDataBump) window.__osDataBump();
  };
  const restoreFlag = (id, flag) => { const s = allStartups.find(x => x.id === id); if (s) { s[flag] = false; afterMutate(); } };
  const restoreStatus = (id) => { const s = allStartups.find(x => x.id === id); if (s) { s.chip = 'EVALUATED'; s.adminDecision = null; afterMutate(); } };

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={() => { window.location.reload(); }}>← HOME</button>
      <div className="lp-brand">
        <img className="lp-brand-combined" src="assets/artpark-iisc-combined.webp" alt="ARTPARK · AI & Robotics Technology Park @ IISc" />
      </div>
      <div className="lp-topbar-crumb">
        <div className="lp-topbar-pill">
          <span className="lp-live-dot" style={{background:'#3213b7'}}/>
          <span>ADMIN · {crumb}</span>
        </div>
      </div>
      <div className="lp-topbar-right">
        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
          style={{
            width: 38, height: 38, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--line)', borderRadius: 2,
            background: 'var(--bg-paper)', color: 'var(--ink-soft)', cursor: 'pointer',
            transition: 'background 120ms, border-color 120ms, color 120ms'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-paper)'; e.currentTarget.style.color = 'var(--ink-soft)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <div
          className="lp-topbar-user"
          style={{
            position: 'relative', 
            border: '1px solid var(--line)', 
            borderRadius: '20px', 
            padding: '4px 12px 4px 6px',
            background: 'var(--bg-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
        >
          <div className="os-avatar" style={{width:24,height:24,fontSize:10,flexShrink:0,background:'#3213b7',color:'#fff'}}>TB</div>
          <span style={{fontSize: 13, fontWeight: 500}}>tanvi@artpark.in</span>
          <span className="caret">▾</span>

          {menuOpen && (
            <div 
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--bg-paper)',
                border: '1px solid var(--line-strong)',
                borderRadius: '2px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                padding: '6px',
                zIndex: 9999,
                minWidth: '220px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--line)', marginBottom: 4}}>
                Switch Panel
              </div>
              <div
                style={{
                  padding: '9px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--artblue)',
                  background: 'var(--bg-soft)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--artblue)', flexShrink: 0 }} />
                <span>Admin Panel</span>
                <span style={{ color: 'var(--artblue)', marginLeft: 'auto', fontWeight: 700 }}>✓</span>
              </div>
              <a 
                href="../Reviewer-Portal/reviewer-portal.html"
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  borderRadius: '2px',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer'
                }}
                className="dropdown-hover-item"
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--bg-soft)';
                  e.target.style.color = 'var(--ink)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent';
                  e.target.style.color = 'var(--ink-soft)';
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--line-strong)', flexShrink: 0 }} />
                <span>Reviewer Panel</span>
              </a>
            </div>
          )}
        </div>
        <button className="lp-signout" onClick={() => { if (window.confirm('Sign out of the Admin portal?')) window.location.reload(); }}>SIGN OUT ↗</button>
      </div>

      {settingsOpen && (
        <div className="os-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="os-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="os-modal-head">
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Settings</div>
                <div className="os-text-sm os-text-dim" style={{ marginTop: 2 }}>Restore archived or hidden applications</div>
              </div>
              <button className="os-btn ghost sm" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
            <div className="os-modal-body os-stack" style={{ gap: 24 }}>
              <div>
                <div className="os-card-title os-mb-sm">Archived applications ({archivedApps.length})</div>
                {archivedApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No archived applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {archivedApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreFlag(s.id, 'archived')}>Unarchive</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">Hidden applications ({hiddenApps.length})</div>
                {hiddenApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No hidden applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {hiddenApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreFlag(s.id, 'hidden')}>Unhide</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">On hold / waitlisted ({heldApps.length})</div>
                {heldApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No applications on hold.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {heldApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreStatus(s.id)}>Release hold</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">Rejected ({rejectedApps.length})</div>
                {rejectedApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No rejected applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {rejectedApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreStatus(s.id)}>Restore</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminCohortHeader({ page, setPage, decisionMode, setDecisionMode }) {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{marginBottom:8}}>ARTPARK / OS · Admin Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">TIR + VIP cohort <span className="lp-year">2026</span></h1>
          <div className="lp-cohort-sub">
            Admin control panel · live state across all 7 layers · last updated 2m ago
          </div>
        </div>
        <div style={{marginTop:4,display:'flex',gap:12,alignItems:'center'}}>
          <div className="lp-toggle-control">
            <button 
              className={`lp-toggle-btn ${decisionMode === 'reviewer' ? 'active' : ''}`}
              onClick={() => setDecisionMode('reviewer')}
            >
              Reviewer Decision
            </button>
            <button 
              className={`lp-toggle-btn ${decisionMode === 'jury' ? 'active' : ''}`}
              onClick={() => setDecisionMode('jury')}
            >
              Jury Decision
            </button>
          </div>
          <button 
            className={`os-btn ${page === 'roles' ? '' : 'ghost'}`}
            onClick={() => setPage(page === 'roles' ? 'dashboard' : 'roles')}
          >
            {page === 'roles' ? '← Back to Dashboard' : 'User Roles'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ADMIN_TABS = [
  { id:'dashboard',    label:'Dashboard',    sub:'OVERVIEW · PIPELINE',       badge:null },
  { id:'reviewers',    label:'Reviewers',    sub:'ROSTER · PROGRESS',          badge:null },
  { id:'pipeline',     label:'Applications', sub:'ALL SUBMISSIONS',            badge:'248' },
  { id:'gate1',        label:'Admin Review', sub:'PENDING DECISIONS',          badge:'12' },
];

function AdminTabBar({ page, setPage, decisionMode }) {
  const getAppCount = () => {
    if (!window.OS_DATA || !window.OS_DATA.STARTUPS) return 0;
    if (decisionMode === 'jury') {
      return window.OS_DATA.STARTUPS.filter(s => {
        const c = (s.chip || '').toUpperCase();
        return c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
      }).length;
    }
    return window.OS_DATA.STARTUPS.filter(s => !s.archived).length;
  };

  const tabs = [
    { id:'dashboard',    label:'Dashboard',    sub:'OVERVIEW · PIPELINE',       badge:null },
    { 
      id:'reviewers',    
      label: decisionMode === 'jury' ? 'Jury' : 'Reviewers',    
      sub: decisionMode === 'jury' ? 'PANEL · ASSIGNMENTS' : 'ROSTER · PROGRESS',          
      badge:null 
    },
    { id:'pipeline',     label:'Applications', sub:'ALL SUBMISSIONS',            badge: String(getAppCount()) },
    { 
      id:'gate1',        
      label: decisionMode === 'jury' ? 'Final Gate' : 'Admin Review', 
      sub: decisionMode === 'jury' ? 'CONSOLIDATED DECISIONS' : 'PENDING DECISIONS',          
      badge: decisionMode === 'jury' ? null : '12' 
    },
  ];

  return (
    <div className="lp-tabs">
      {tabs.map(t => (
        <div key={t.id} className={`lp-tab${page === t.id ? ' active' : ''}`} onClick={() => setPage(t.id)}>
          <div className="lp-tab-label">
            {t.label}
            {t.badge && <span className="lp-tab-badge">{t.badge}</span>}
          </div>
          <div className="lp-tab-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function AdminApp() {
  const [page, setPage] = useAS2('dashboard');
  const [selectedStartupId, setSelectedStartupId] = useAS2(null);
  const [backPage, setBackPage] = useAS2('pipeline');
  const [decisionMode, setDecisionMode] = useAS2('reviewer');

  // Global re-render hook: any component (e.g. the Settings panel) can call
  // window.__osDataBump() after mutating OS_DATA to refresh the whole admin tree live.
  const [, forceAppUpdate] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => { window.__osDataBump = forceAppUpdate; return () => { if (window.__osDataBump === forceAppUpdate) window.__osDataBump = null; }; }, []);

  const startups = window.OS_DATA.STARTUPS;
  const currentIdx = startups.findIndex(s => s.id === selectedStartupId);

  // Auto-promote startups to 'JURY REVIEW' (Interview) if jury requested interview, unless already decided
  React.useEffect(() => {
    if (window.OS_DATA && window.OS_DATA.STARTUPS) {
      let changed = false;
      window.OS_DATA.STARTUPS.forEach(s => {
        if (s.jury) {
          const reco = (s.jury.reco || '').toLowerCase();
          if ((reco === 'interview' || reco === 'maybe' || reco === 'yes') && 
              (!s.chip || s.chip === 'SHORTLISTED' || s.chip === 'NEW' || s.chip === 'EVALUATED')) {
            s.chip = 'JURY REVIEW';
            changed = true;
          }
        }
      });
      if (changed && window.persistOSData) {
        window.persistOSData();
      }
    }
  }, []);

  const goDetail = (id, fromPage = 'pipeline') => {
    setSelectedStartupId(id);
    setBackPage(fromPage);
    setPage('detail');
  };

  const onPrev = () => {
    if (currentIdx > 0) {
      setSelectedStartupId(startups[currentIdx - 1].id);
    }
  };

  const onNext = () => {
    if (currentIdx < startups.length - 1) {
      setSelectedStartupId(startups[currentIdx + 1].id);
    }
  };

  const isDetail = page === 'detail';

  return (
    <div className="os-shell">
      <AdminTopbar page={page} decisionMode={decisionMode} />
      <div className="lp-layout">
        {!isDetail && (
          <AdminCohortHeader 
            page={page} 
            setPage={setPage} 
            decisionMode={decisionMode} 
            setDecisionMode={setDecisionMode} 
          />
        )}
        {!isDetail && page !== 'roles' && (
          <AdminTabBar
            page={page}
            setPage={setPage}
            decisionMode={decisionMode}
          />
        )}
        <div className="lp-tab-content">
          {page === 'dashboard'   && <AdminDashboard go={setPage} decisionMode={decisionMode} />}
          {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} />}
          {page === 'detail'      && (
            <AdminDetail 
              startupId={selectedStartupId} 
              onBack={() => setPage(backPage)} 
              onPrev={currentIdx > 0 ? onPrev : null}
              onNext={currentIdx < startups.length - 1 ? onNext : null}
              decisionMode={decisionMode}
            />
          )}
          {page === 'reviewers'   && <AdminReviewers decisionMode={decisionMode} />}
          {page === 'roles'       && <AdminRoles />}
          {page === 'gate1'       && (decisionMode === 'jury' ? <AdminGate2 goDetail={(id) => goDetail(id, 'gate1')} /> : <AdminGate1 goDetail={(id) => goDetail(id, 'gate1')} />)}
          {page === 'psychometry' && <AdminPsychometry />}
          {page === 'jury'        && <AdminJury />}
          {page === 'gate2'       && <AdminGate2 goDetail={(id) => goDetail(id, 'gate2')} />}
          {page === 'audit'       && <AdminAudit />}
          {page === 'analytics'   && <AdminAnalytics />}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AdminApp />);
