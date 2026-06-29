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
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";
import { Chip } from "../ui.jsx";
import { buildPipelineCsv } from "../helpers/pipelineCsv.js";
import { relabelDisplayId } from "../../../../lib/trackLabel.js";

// ─── Status/Chip helpers (mirrors prototype) ───────────────────────────────

function getFriendlyStatus(s) {
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
}

function getStatusId(s) {
  if (!s.chip) return 'submitted';
  const c = s.chip.toUpperCase();
  if (c === 'NEW') return 'submitted';
  if (c === 'PROCESSING') return 'ai-screening';
  if (c === 'IN REVIEW') return 'under-review';
  if (c === 'EVALUATED') return 'evaluated';
  if (c === 'SHORTLISTED') return 'shortlisted';
  if (c === 'JURY REVIEW') return 'jury_review';
  if (c === 'ACCEPTED') return 'offered';
  if (c === 'REJECTED') return 'not-selected';
  if (c === 'WAITLISTED') return 'waitlisted';
  if (c === 'HOLD') return 'hold';
  return 'submitted';
}

function getChipTone(s) {
  const c = s.chip ? s.chip.toUpperCase() : 'NEW';
  if (c === 'ACCEPTED' || c === 'SHORTLISTED') return 'green';
  if (c === 'JURY REVIEW') return 'blue';
  if (c === 'EVALUATED') return 'purple';
  if (c === 'IN REVIEW') return 'amber';
  if (c === 'HOLD') return 'amber';
  if (c === 'REJECTED') return 'red';
  return '';
}

// ─── Filter data ────────────────────────────────────────────────────────────

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Submitted', color: '#b7a06a' },
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

export function AdminPipeline({ goDetail, decisionMode }) {
  const { data, loading, error, reload } = useAdminData("pipeline", {});
  const S = data?.startups || [];

  // Also fetch batches for the batch dropdown / assign action
  const { data: batchData, reload: reloadBatches } = useAdminData("batches", {});
  const batches = React.useMemo(() => {
    if (!batchData) return [];
    if (Array.isArray(batchData)) return batchData;
    return batchData.batches || [];
  }, [batchData]);

  const [search, setSearch] = React.useState('');
  const [track, setTrack] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [industry, setIndustry] = React.useState('all');
  const [batchFilter, setBatchFilter] = React.useState('all');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [showAssignJury, setShowAssignJury] = React.useState(null);

  const [sortCol, setSortCol] = React.useState(null);
  const [sortAsc, setSortAsc] = React.useState(true);

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
    if (s.hidden) return false;

    if (decisionMode === 'jury') {
      const c = (s.chip || '').toUpperCase();
      if (c !== 'SHORTLISTED' && c !== 'JURY REVIEW' && c !== 'ACCEPTED' && c !== 'REJECTED' && c !== 'WAITLISTED') {
        return false;
      }
    }

    if (batchFilter !== 'all') {
      const b = s.batch || 'Unassigned';
      if (b !== batchFilter) return false;
    }

    if (search) {
      const q = search.toLowerCase();
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchFounder = (s.founders || []).some(f => f.toLowerCase().includes(q));
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
      const cleanIndustry = industry.replace(/\s+\d+$/, '').trim().toLowerCase();
      const sDomain = (s.domain || '').toLowerCase().trim();
      if (sDomain !== cleanIndustry) return false;
    }

    return true;
  });

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
  }, [filtered, sortCol, sortAsc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active (applied) filters shown as removable pills
  const activeChips = [];
  if (status !== 'all') activeChips.push({ label: 'Status · ' + ((STATUSES.find(x => x.id === status) || {}).label || status), clear: () => setStatus('all') });
  if (industry !== 'all') activeChips.push({ label: industry.replace(/\s+\d+$/, '').trim(), clear: () => setIndustry('all') });
  if (batchFilter !== 'all') activeChips.push({ label: 'Batch · ' + batchFilter, clear: () => setBatchFilter('all') });
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
      await adminPlatformApi.assignBatch(targetBatchId, {
        items: selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
      });
      await finishBulk({ kind: 'ok', text: `Assigned ${selectedRows.length} to ${targetBatchName}.` });
    } catch (e) {
      setNote({ kind: 'error', text: `Batch assign failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  // Per-row batch dropdown change
  const changeIndividualBatch = async (startup, val) => {
    if (val === 'new') {
      const custom = window.prompt('Enter new batch name:');
      if (!custom) return;
      try {
        const created = await adminPlatformApi.createBatch({ name: custom });
        await adminPlatformApi.assignBatch(created.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reloadBatches();
        await reload();
      } catch (e) {
        setNote({ kind: 'error', text: `Batch create failed: ${e?.message || e}` });
      }
    } else {
      const found = batches.find(b => b.name === val);
      if (!found) return;
      try {
        await adminPlatformApi.assignBatch(found.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reload();
      } catch (e) {
        setNote({ kind: 'error', text: `Batch assign failed: ${e?.message || e}` });
      }
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
          <div className="dash-card-title" style={{ fontFamily: 'var(--font-serif)' }}>All <em>applications</em></div>
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
                onClick={() => goDetail && goDetail(s.id, s.track)}
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
                <td>{(s.founders && s.founders[0]) || '—'}</td>
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
                  {decisionMode === 'jury' ? (
                    <div style={{ fontSize: 13, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Jury assignment column — no backend; assign is a local no-op */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--ink-dim)', fontStyle: 'italic', fontSize: 12 }}>
                          Unassigned
                        </span>
                        <PreviewBadge />
                        {showAssignJury === s.id ? (
                          <select
                            className="os-select sm"
                            style={{ fontSize: 11, padding: '1px 4px', height: 20, width: 120 }}
                            autoFocus
                            value=""
                            onChange={() => setShowAssignJury(null)}
                            onBlur={() => setShowAssignJury(null)}
                          >
                            <option value="">-- Select Jury --</option>
                          </select>
                        ) : (
                          <span
                            style={{
                              cursor: 'pointer', color: '#4f46e5', fontWeight: 'bold', fontSize: 11,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 16, height: 16, borderRadius: '50%', background: '#ede9fe', border: '1px solid #c4b5fd'
                            }}
                            title="Add Jury (preview)"
                            onClick={() => setShowAssignJury(s.id)}
                          >
                            +
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
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
                  )}
                </td>
                <td>{s.sub}</td>
                <td className="os-mono os-text-xs">{relabelDisplayId(s.applicationId) || s.id}</td>
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
          {decisionMode === 'jury' ? (
            <>
              <div style={{ width: 1, height: 16, background: 'var(--line)' }} />
              <div className="os-floating-select-wrap">
                {/* Jury bulk-assign — no backend wired; PreviewBadge marks it as upcoming */}
                <select
                  className="os-floating-select"
                  value=""
                  onChange={() => {/* jury assign: no backend, local no-op */}}
                >
                  <option value="" disabled>Allot to Jury...</option>
                </select>
              </div>
              <PreviewBadge />
            </>
          ) : (
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
