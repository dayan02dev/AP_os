// ── helpers from admin-1.jsx ──────────────────────────────────────────────────

export function fieldBullets(f) {
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

export function isFactField(f) {
  if (f.short === true) return true;
  if (Array.isArray(f.bullets)) return false;
  const v = String(f.value || '');
  return v.length <= 48 && !/[.!?]/.test(v);
}

// ── helpers from admin-2.jsx ──────────────────────────────────────────────────

export function getThreeReviewers(s) {
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

// Apply an admin decision to a startup and persist it. Shared by all Admin Review variants.
export function applyGateDecision(st, decision, note) {
  if (!st) return;
  const d = (decision || '').toLowerCase();
  if (d === 'approve' || d === 'approved') { st.chip = 'SHORTLISTED'; st.adminDecision = 'APPROVED'; }
  else if (d === 'waitlist' || d === 'waitlisted') { st.chip = 'WAITLISTED'; st.adminDecision = 'WAITLISTED'; }
  else if (d === 'hold') { st.chip = 'HOLD'; st.adminDecision = 'HOLD'; }
  else if (d === 'reject' || d === 'rejected') { st.chip = 'REJECTED'; st.adminDecision = 'REJECTED'; }
  if (note != null && note !== '') st.adminRationale = note;
  if (window.persistOSData) window.persistOSData();
}

// Build + download a CSV from a list of startups (client-side export).
export function downloadApplicationsCSV(rows, filename) {
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

export function getReviewerWeight(name) {
  if (!name) return 1.0;
  const R = window.OS_DATA?.REVIEWERS || [];
  const found = R.find(r => r.name && r.name.toLowerCase() === name.toLowerCase());
  return found && typeof found.weight === 'number' ? found.weight : 1.0;
}

export function calculateWeightedReviewerAverage(s, metricKey) {
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

export function revInitials(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export function generateBasicPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pass = 'Pass-';
  for (let i = 0; i < 6; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}
