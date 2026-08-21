// AdminPipeline — Task 9 faithful port of the A-2 prototype Pipeline screen.
//
// Markup ported VERBATIM from admin-1.jsx AdminPipeline (prototype), including:
//   • collapsible filter panel with lp-filter-* classes
//   • removable filter pills (lp-active-chip*)
//   • sortable os-table
//   • floating bulk-action bar with os-floating-* classes + inline <style>
//   • per-row batch dropdown (non-jury) / jury-assign column (jury mode)
//
// Data is sourced from the real API via useAdminData("pipeline", {}) which
// returns adapted rows (chip, founders, domain, sub, ai.overall, batch, hidden,
// archived, track fields). Client-side filter/sort/search logic from prototype
// operates on that array unchanged.
//
// Mutations reuse exact call shapes from the old AdminPipeline.jsx:
//   bulkDecide:  { items:[{track,application_id,decision,rationale?}] }
//   patchMeta:   adminPlatformApi.patchMeta(track, id, { is_hidden | is_archived })
//   assignBatch: adminPlatformApi.assignBatch(batchId, { items:[{track,application_id}] })
//   createBatch: adminPlatformApi.createBatch({ name })
//   renameBatch: adminPlatformApi.renameBatch(batchId, { name })

import React from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { Chip } from "../ui.jsx";
import { buildPipelineCsv } from "../helpers/pipelineCsv.js";
import { relabelDisplayId, trackLabel } from "../../../../lib/trackLabel.js";
import { chipLabel, chipStatusId, chipTone } from "../../../../lib/adminDataAdapter";
import { RecoCell, aggregateReco } from "../../../../components/RecoCell";

// Real industry chip counts from the loaded pipeline rows, scoped to the
// selected track. Excludes hidden/archived rows and rows without an industry
// ("—"). Returns [{ name, count }] sorted by count desc (name tiebreak).
export function industryCountsFor(rows, track) {
  const counts = new Map();
  for (const s of rows || []) {
    if (s.hidden || s.archived) continue;
    if (track && track !== "all" && s.track !== track) continue;
    const name = s.domain && s.domain !== "—" ? s.domain : null;
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ─── Status/Chip helpers ────────────────────────────────────────────────────
// Thin adapters over the shared CHIP_META source of truth in adminDataAdapter.
// Do NOT re-inline a private status→label map here: the "JURY REVIEW" chip once
// drifted to "Interview" precisely because this screen kept its own copy.

const getFriendlyStatus = (s) => chipLabel(s.chip);
const getStatusId = (s) => chipStatusId(s.chip);
const getChipTone = (s) => chipTone(s.chip);

// ─── Filter data ────────────────────────────────────────────────────────────

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Submitted', color: '#b7a06a' },
  { id: 'under-review', label: 'Under review', color: '#3213b7' },
  { id: 'evaluated', label: 'Evaluated', color: '#3213b7' },
  { id: 'shortlisted', label: 'Shortlisted', color: '#2a8f5a' },
  { id: 'jury_review', label: 'Jury review', color: '#2a8f5a' },
  { id: 'hold', label: 'Hold', color: '#b7a06a' },
  { id: 'offered', label: 'Offered', color: '#242424' },
  { id: 'onboarded', label: 'Onboarded', color: '#242424' },
  { id: 'not-selected', label: 'Not selected', color: '#242424' },
  { id: 'waitlisted', label: 'Waitlisted', color: '#242424' },
  { id: 'withdrawn', label: 'Withdrawn', color: '#242424' },
];

// ─── CSV download using the exported pure helper ────────────────────────────

function downloadCsv(rows) {
  const csv = buildPipelineCsv(rows.map(s => ({
    applicationId: s.applicationId,
    track: s.track,
    name: s.name,
    founder: (s.founders && s.founders[0]) || '',
    industry: s.domain,
    stage: s.stage,
    ai_score_overall: s.ai?.overall ?? null,
    status: (() => {
      const c = s.chip ? s.chip.toUpperCase() : 'NEW';
      const inv = {
        'NEW': 'submitted', 'PROCESSING': 'ai_screening', 'IN REVIEW': 'under_review',
        'EVALUATED': 'evaluated', 'SHORTLISTED': 'shortlisted', 'JURY REVIEW': 'jury_review',
        'ACCEPTED': 'offered', 'REJECTED': 'rejected', 'WAITLISTED': 'waitlisted',
        'HOLD': 'on_hold', 'WITHDRAWN': 'withdrawn',
      };
      return inv[c] || 'submitted';
    })(),
    decision: s.adminDecision ? (
      s.adminDecision === 'APPROVED' ? 'shortlisted' :
      s.adminDecision === 'HOLD' ? 'on_hold' :
      s.adminDecision === 'REJECTED' ? 'rejected' :
      s.adminDecision === 'WAITLISTED' ? 'waitlisted' : ''
    ) : '',
    batch: s.batch && s.batch !== 'Unassigned' ? s.batch : '',
    submitted_at: s.sub,
  })));
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'artpark-applications.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Main component ──────────────────────────────────────────────────────────

// `lockTrack` ("tir" | "sip") hard-scopes the list to one EFFECTIVE track and
// hides the track switcher. Do NOT use the server-side `track` filter for this:
// that one selects by NATIVE track (which table the row is read from), while a
// row's displayed `track` is the effective one under the track-move overlay. A
// TIR app moved to VIP would land in the wrong bucket, and a VIP app moved to
// TIR would vanish from both. Filtering client-side on the effective track is
// the only split that agrees with what the row claims to be.
// `scopeKey` namespaces the sticky filters. The Applications and Rejected tabs
// both render this component, so they need distinct scopes — otherwise
// filtering one silently filters the other.
export function AdminPipeline({ goDetail, decisionMode, baseFilter = {}, readOnly = false, heading,
  lockTrack = null, scopeKey = 'applications' }) {
  const scope = `admin.pipeline.${scopeKey}`;
  const { data, loading, error, reload } = useAdminData("pipeline", baseFilter);
  const S = data?.startups || [];

  // Also fetch batches for the batch dropdown / assign action
  const { data: batchData, reload: reloadBatches } = useAdminData("batches", {});
  const batches = React.useMemo(() => {
    if (!batchData) return [];
    if (Array.isArray(batchData)) return batchData;
    return batchData.batches || [];
  }, [batchData]);

  const [search, setSearch] = useStickyState(scope, 'search', '');
  const [trackState, setTrack] = useStickyState(scope, 'track', 'all');
  // A locked track always wins, so "Clear filters" can't widen the list past
  // the tab's own scope — and neither can a restored value.
  const track = lockTrack || trackState;
  const [status, setStatus] = useStickyState(scope, 'status', 'all');
  const [industry, setIndustry] = useStickyState(scope, 'industry', 'all');
  const [batchFilter, setBatchFilter] = useStickyState(scope, 'batch', 'all');
  const [recoFilter, setRecoFilter] = useStickyState(scope, 'reco', null);
  const industries = React.useMemo(() => industryCountsFor(S, track), [S, track]);
  const recoCounts = React.useMemo(() => {
    const m = { yes: 0, maybe: 0, no: 0, none: 0 };
    S.forEach((s) => { m[aggregateReco(s.reco) || "none"] += 1; });
    return m;
  }, [S]);
  const [filtersOpen, setFiltersOpen] = useStickyState(scope, 'filtersOpen', false);
  // Row selection is deliberately NOT sticky: coming back to a pre-selected set
  // of rows makes the bulk-action bar act on a selection you no longer remember
  // making.
  const [selectedIds, setSelectedIds] = React.useState([]);

  const [sortCol, setSortCol] = useStickyState(scope, 'sortCol', null);
  const [sortAsc, setSortAsc] = useStickyState(scope, 'sortAsc', true);

  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(null);

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
    const set = new Set(batches.map(b => b.name).filter(Boolean));
    S.forEach(s => {
      if (s.batch && s.batch !== 'Unassigned') set.add(s.batch);
    });
    return Array.from(set).sort();
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const hasFilters = search !== '' || (!lockTrack && track !== 'all') || status !== 'all' || industry !== 'all' || batchFilter !== 'all' || !!recoFilter;
  const clearAll = () => {
    setSearch('');
    setTrack('all');
    setStatus('all');
    setIndustry('all');
    setBatchFilter('all');
    setRecoFilter(null);
  };

  const filtered = React.useMemo(() => S.filter(s => {
    if (s.archived) return false;
    if (s.hidden) return false;

    if (decisionMode === 'jury') {
      const c = (s.chip || '').toUpperCase();
      if (c !== 'SHORTLISTED' && c !== 'JURY REVIEW' && c !== 'ACCEPTED' && c !== 'REJECTED' && c !== 'WAITLISTED') {
        return false;
      }
    }

    if (batchFilter !== 'all') {
      const names = (s.batches || []).map(x => x.name);
      const match = names.includes(batchFilter)
        || (names.length === 0 && batchFilter === 'Unassigned');
      if (!match) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchFounder = (s.founders || []).some(f => (f || '').toLowerCase().includes(q));
      const matchDomain = (s.domain || '').toLowerCase().includes(q);
      if (!matchName && !matchFounder && !matchDomain) return false;
    }

    // Track filter: prototype used hardcoded id lists; we use s.track field instead
    if (track === 'tir') {
      if (s.track !== 'tir') return false;
    } else if (track === 'sip') {
      if (s.track !== 'sip') return false;
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
      if ((s.domain || '') !== industry) return false;
    }

    if (recoFilter && (aggregateReco(s.reco) || "none") !== recoFilter) return false;

    return true;
  }), [S, search, track, status, industry, batchFilter, recoFilter, decisionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAll = () => {
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(x => x.id));
    }
  };

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
        valA = a.ai ? a.ai.overall ?? 0 : 0;
        valB = b.ai ? b.ai.overall ?? 0 : 0;
      } else if (sortCol === 'rev') {
        valA = a.rev ? a.rev.overall ?? -1 : -1;
        valB = b.rev ? b.rev.overall ?? -1 : -1;
      } else if (sortCol === 'reviewers') {
        valA = a.reviewers ? a.reviewers.submitted : -1;
        valB = b.reviewers ? b.reviewers.submitted : -1;
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

  // Active (applied) filters shown as removable pills
  const activeChips = [];
  if (status !== 'all') activeChips.push({ label: 'Status · ' + ((STATUSES.find(x => x.id === status) || {}).label || status), clear: () => setStatus('all') });
  if (industry !== 'all') activeChips.push({ label: industry, clear: () => setIndustry('all') });
  if (batchFilter !== 'all') activeChips.push({ label: 'Batch · ' + batchFilter, clear: () => setBatchFilter('all') });
  if (recoFilter) activeChips.push({ label: 'Reco · ' + (recoFilter === 'none' ? '—' : recoFilter), clear: () => setRecoFilter(null) });
  const activeCount = activeChips.length;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const selectedRows = S.filter(s => selectedIds.includes(s.id));

  const finishBulk = async (resultNote) => {
    setSelectedIds([]);
    setNote(resultNote || null);
    await reload();
  };

  // Bulk Hold → on_hold; Bulk Reject → rejected; "Send to Next Level" → shortlisted
  // "next level" maps to shortlist — the only real advance action in the API
  const runBulkDecision = async (decision, label, needsRationale) => {
    if (busy || selectedRows.length === 0) return;
    let rationale = '';
    if (needsRationale) {
      const entered = window.prompt(
        `Rationale for "${label}" on ${selectedRows.length} application(s) (required):`,
        '',
      );
      if (entered == null) return;
      rationale = entered.trim();
      if (!rationale) {
        setNote({ kind: 'error', text: 'A rationale is required for that decision.' });
        return;
      }
    }
    setBusy(true);
    setNote(null);
    try {
      // bulkDecide body shape: { items:[{track, application_id, decision, rationale?}] }
      const resp = await adminPlatformApi.bulkDecide({
        items: selectedRows.map((r) => ({
          track: r.track,
          application_id: r.id,
          decision,
          rationale: rationale || undefined,
        })),
      });
      const results = resp?.results ?? [];
      const failures = results.filter((x) => x?.status && x.status !== 'decided');
      const ok = results.length - failures.length;
      if (failures.length === 0) {
        await finishBulk({ kind: 'ok', text: `${label}: ${ok} updated.` });
      } else {
        const detail = failures
          .map((x) => `${x.application_id} (${x.status})`)
          .join(', ');
        await finishBulk({ kind: 'error', text: `${label}: ${ok} updated, ${failures.length} failed — ${detail}` });
      }
    } catch (e) {
      setNote({ kind: 'error', text: `Bulk decision failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkReject = () => runBulkDecision('rejected', 'Reject', true);

  // Assign batch to selected rows
  // assignBatch body shape: { items:[{track, application_id}] }
  const applyBatchToSelected = async (batchNameOrNew) => {
    if (busy || selectedRows.length === 0) return;
    if (batchNameOrNew === 'Unassigned') {
      setBusy(true);
      setNote(null);
      try {
        const resp = await adminPlatformApi.unassignBatch(
          selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
        );
        await finishBulk({ kind: 'ok', text: `Removed ${resp?.removed ?? selectedRows.length} from their batch.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch unassign failed: ${e?.message || e}` });
      } finally {
        setBusy(false);
      }
      return;
    }
    let targetBatchId = null;
    let targetBatchName = batchNameOrNew;

    if (batchNameOrNew === 'new') {
      const custom = window.prompt('Enter new batch name:');
      if (!custom) return;
      targetBatchName = custom;
      try {
        setBusy(true);
        const created = await adminPlatformApi.createBatch({ name: custom });
        targetBatchId = created?.id;
        await reloadBatches();
      } catch (e) {
        setNote({ kind: 'error', text: `Create batch failed: ${e?.message || e}` });
        setBusy(false);
        return;
      }
    } else {
      // Find batch by name
      const found = batches.find(b => b.name === batchNameOrNew);
      targetBatchId = found?.id;
    }

    if (!targetBatchId) {
      setNote({ kind: 'error', text: `Batch not found: ${targetBatchName}` });
      setBusy(false);
      return;
    }

    setBusy(true);
    setNote(null);
    try {
      const resp = await adminPlatformApi.assignBatch(targetBatchId, {
        items: selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
      });
      await finishBulk({ kind: 'ok', text: `Assigned ${selectedRows.length} to ${targetBatchName}. ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
    } catch (e) {
      setNote({ kind: 'error', text: `Batch assign failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  // Per-row batch dropdown change
  const changeIndividualBatch = async (startup, val) => {
    if (val === 'Unassigned') {
      try {
        await adminPlatformApi.unassignBatch([
          { track: startup.track, application_id: startup.id },
        ]);
        await reload();
        setNote({ kind: 'ok', text: 'Removed from batch.' });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch unassign failed: ${e?.message || e}` });
      }
      return;
    }
    if (val === 'new') {
      const custom = window.prompt('Enter new batch name:');
      if (!custom) return;
      try {
        const created = await adminPlatformApi.createBatch({ name: custom });
        const resp = await adminPlatformApi.assignBatch(created.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reloadBatches();
        await reload();
        setNote({ kind: 'ok', text: `Assigned to ${custom} · ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch create failed: ${e?.message || e}` });
      }
    } else {
      const found = batches.find(b => b.name === val);
      if (!found) return;
      try {
        const resp = await adminPlatformApi.assignBatch(found.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reload();
        setNote({ kind: 'ok', text: `Assigned to ${val} · ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch assign failed: ${e?.message || e}` });
      }
    }
  };

  // Multi-batch: remove an app from ONE of its batches (smart remove keeps
  // reviewers still supplied by the app's other batches).
  const removeFromBatch = async (startup, batchId) => {
    try {
      await adminPlatformApi.removeAppFromBatch(batchId, [
        { track: startup.track, application_id: startup.id },
      ]);
      await reload();
      setNote({ kind: 'ok', text: 'Removed from batch.' });
    } catch (e) {
      setNote({ kind: 'error', text: `Remove from batch failed: ${e?.message || e}` });
    }
  };

  // Rename batch via API
  const renameBatch = async (oldName) => {
    const newName = window.prompt(`Rename batch "${oldName}" to:`, oldName);
    if (!newName || newName === oldName) return;
    const found = batches.find(b => b.name === oldName);
    if (!found) return;
    try {
      await adminPlatformApi.renameBatch(found.id, { name: newName });
      if (batchFilter === oldName) setBatchFilter(newName);
      await reloadBatches();
      await reload();
    } catch (e) {
      setNote({ kind: 'error', text: `Rename failed: ${e?.message || e}` });
    }
  };

  const deleteBatch = async (name) => {
    const found = batches.find(b => b.name === name);
    if (!found) return;
    if (!window.confirm(
      `Delete batch "${name}"? Its applications revert to Random allotment; ` +
      `reviewer assignments and reviews are kept.`
    )) return;
    try {
      await adminPlatformApi.deleteBatch(found.id);
      if (batchFilter === name) setBatchFilter('all');
      await reloadBatches();
      await reload();
    } catch (e) {
      setNote({ kind: 'error', text: `Delete failed: ${e?.message || e}` });
    }
  };

  // ── Render guards ──────────────────────────────────────────────────────────
  if (loading && S.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
        Loading applications…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#d23b40', fontFamily: 'var(--font-sans)' }}>
        Failed to load applications. {error?.message || String(error)}
        <br />
        <button className="os-btn ghost" style={{ marginTop: 12 }} onClick={reload}>Retry</button>
      </div>
    );
  }

  const detailSeq = sortedFiltered.map(s => ({ id: s.id, track: s.track }));

  return (
    <div>
      <style dangerouslySetInnerHTML={{__html: `
        /* Inline note */
        .adm-pipeline-note {
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans);
          margin-bottom: 16px;
        }
        .adm-pipeline-note.is-ok { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
        .adm-pipeline-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
        .adm-pipeline-note-x {
          background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px;
        }
      `}} />

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <div className="dash-section-tag">A-2 · PIPELINE</div>
          <div className="dash-card-title" style={{ fontFamily: 'var(--font-serif)' }}>{heading || <>All <em>applications</em></>}</div>
          <div style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)', fontSize: 13, marginTop: 4 }}>
            Layer 1–4 unified view. Filter, sort, batch-action.
          </div>
        </div>
        <button className="os-btn ghost" onClick={() => downloadCsv(sortedFiltered)}>Export CSV</button>
      </div>

      {/* Inline note */}
      {note && (
        <div className={`adm-pipeline-note ${note.kind === 'error' ? 'is-error' : 'is-ok'}`}>
          <span>{note.text}</span>
          <button className="adm-pipeline-note-x" onClick={() => setNote(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className={`lp-filter-area${!filtersOpen && activeChips.length === 0 ? ' is-collapsed' : ''}`}>
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
          {!lockTrack && (
            <div className="lp-track-group">
              {[['all', 'All tracks'], ['tir', 'TIR'], ['sip', 'VIP']].map(([v, label]) => (
                <button
                  key={v}
                  className={`lp-track-btn${track === v ? ' active' : ''}`}
                  onClick={() => setTrack(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {hasFilters && (
            <button
              type="button"
              className="lp-clear-btn"
              style={{ fontSize: 13 }}
              onClick={clearAll}
            >
              Clear filters
            </button>
          )}

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
                {industries.map(({ name, count }) => (
                  <button
                    key={name}
                    className={`lp-filter-btn${industry === name ? ' active' : ''}`}
                    onClick={() => setIndustry(name)}
                  >
                    {name} {count}
                  </button>
                ))}
              </div>
            </div>

            {/* RECOMMENDATION */}
            <div className="lp-filter-section">
              <span className="lp-filter-label">RECOMMENDATION</span>
              <div className="lp-filter-btns">
                <button className={`lp-filter-btn${!recoFilter ? " active" : ""}`} onClick={() => setRecoFilter(null)}>All</button>
                {[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"], ["none", "—"]].map(([v, label]) => (
                  <button key={v} className={`lp-filter-btn${recoFilter === v ? " active" : ""}`}
                    onClick={() => setRecoFilter(recoFilter === v ? null : v)}>
                    {label}<span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>{recoCounts[v]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* BATCH (not shown in jury mode) */}
            {decisionMode !== 'jury' && (
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
                      <button
                        className="lp-filter-btn-dots"
                        title={`Delete batch ${b}`}
                        onClick={(e) => { e.stopPropagation(); deleteBatch(b); }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="lp-filter-btn"
                    style={{ borderStyle: 'dashed', borderColor: 'var(--line-strong)', color: 'var(--ink)' }}
                    onClick={async () => {
                      const name = window.prompt('Enter new batch name:');
                      if (name) {
                        try {
                          await adminPlatformApi.createBatch({ name });
                          await reloadBatches();
                        } catch (e) {
                          setNote({ kind: 'error', text: `Create batch failed: ${e?.message || e}` });
                        }
                      }
                    }}
                  >
                    + Create Batch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <table className="os-table">
        <thead>
          <tr>
            {!readOnly && (
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.length === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                />
              </th>
            )}
            {renderHeader('PROJECT', 'name')}
            {renderHeader('FOUNDER', 'founder')}
            {renderHeader('INDUSTRY', 'domain')}
            {renderHeader('STAGE', 'stage')}
            {renderHeader('AI score', 'ai', true)}
            {renderHeader('Reviewer score', 'rev', true)}
            {renderHeader('Reviewers', 'reviewers', true)}
            <th>Reco</th>
            {renderHeader('STATUS', 'status')}
            {renderHeader(decisionMode === 'jury' ? 'ASSIGNED JURY' : 'BATCH', 'batch')}
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
                onClick={() => goDetail && goDetail(s.id, s.track, scopeKey === 'rejected' ? 'rejected' : 'pipeline', detailSeq)}
              >
                {!readOnly && (
                  <td onClick={e => e.stopPropagation()} style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.id)}
                      onChange={() => toggleSelect(s.id)}
                    />
                  </td>
                )}
                <td style={{ fontWeight: 600 }}>
                  {s.name}
                  {isHidden && <span className="os-chip red" style={{ fontSize: 9, padding: '1px 4px', marginLeft: 6 }}>HIDDEN</span>}
                  {s.movedToTrack && (
                    <span
                      className="os-chip"
                      title={`Moved to ${trackLabel(s.movedToTrack)}`}
                      style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.04em', background: '#fff4d6',
                        border: '1px solid #e6c34d', color: '#8a6d00',
                        borderRadius: 999, padding: '1px 7px', verticalAlign: 'middle',
                      }}
                    >
                      → {trackLabel(s.movedToTrack).toUpperCase()}
                    </span>
                  )}
                </td>
                <td>{(s.founders && s.founders[0]) || '—'}</td>
                <td className="os-text-soft">{s.domain}</td>
                <td className="os-text-soft">{s.stage}</td>
                <td className="num">
                  {s.ai && s.ai.overall != null ? (
                    <b>{s.ai.overall.toFixed(1)}</b>
                  ) : (
                    <span className="os-text-soft">—</span>
                  )}
                </td>
                <td className="num">
                  {s.rev && s.rev.overall != null ? (
                    <b>{s.rev.overall.toFixed(1)}</b>
                  ) : (
                    <span className="os-text-soft">—</span>
                  )}
                </td>
                <td className="num">
                  {s.reviewers && (s.reviewers.assigned > 0 || s.reviewers.submitted > 0)
                    ? <span className="os-mono">{s.reviewers.submitted} / {s.reviewers.assigned}</span>
                    : <span className="os-text-soft">—</span>}
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <RecoCell reco={s.reco}
                    onSelect={(v) => setRecoFilter((prev) => (prev === v ? null : v))} />
                </td>
                <td>
                  <Chip tone={getChipTone(s)}>{getFriendlyStatus(s).toUpperCase()}</Chip>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  {decisionMode === 'jury' ? (
                    (s.jury_assigned_names && s.jury_assigned_names.length) ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {s.jury_assigned_names.map((n, i) => (
                          <span key={i} className="os-chip" style={{ fontSize: 11, padding: '2px 6px' }}>{n}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="os-text-soft">Unassigned</span>
                    )
                  ) : readOnly ? (
                    <span className="os-text-sm">{s.batch || 'Unassigned'}</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      {(s.batches && s.batches.length > 0) ? s.batches.map((b, bi) => (
                        <span
                          key={b.id || b.name || bi}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            padding: '1px 6px', fontSize: 11, borderRadius: 10,
                            background: '#ede9fe', border: '1px solid #c4b5fd', color: '#5b21b6',
                          }}
                        >
                          {b.name || '—'}
                          {!readOnly && b.id && (
                            <button
                              type="button"
                              title={`Remove from ${b.name}`}
                              onClick={() => removeFromBatch(s, b.id)}
                              style={{
                                border: 'none', background: 'transparent', cursor: 'pointer',
                                fontSize: 13, lineHeight: 1, padding: 0, color: '#7c3aed',
                              }}
                            >×</button>
                          )}
                        </span>
                      )) : (
                        <span className="os-text-xs" style={{ color: '#9ca3af' }}>Unassigned</span>
                      )}
                      {!readOnly && (
                        <select
                          className="os-select sm"
                          style={{ padding: '2px 6px', fontSize: 12, height: 24 }}
                          value=""
                          onChange={e => { const v = e.target.value; if (v) changeIndividualBatch(s, v); }}
                        >
                          <option value="">+ Add…</option>
                          {getAvailableBatches()
                            .filter(name => !(s.batches || []).some(sb => sb.name === name))
                            .map(b => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                          <option value="new">+ New Batch…</option>
                        </select>
                      )}
                    </div>
                  )}
                </td>
                <td>{s.sub}</td>
                <td className="os-mono os-text-xs">{relabelDisplayId(s.applicationId) || s.id}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!readOnly && selectedIds.length > 0 && (
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
            .os-floating-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
          <button className="os-floating-btn danger-outline" disabled={busy} onClick={handleBulkReject}>Reject</button>
          {decisionMode !== 'jury' && (
            <>
              <div style={{ width: 1, height: 16, background: 'var(--line)' }} />
              <div className="os-floating-select-wrap">
                <select
                  className="os-floating-select"
                  value=""
                  disabled={busy}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
