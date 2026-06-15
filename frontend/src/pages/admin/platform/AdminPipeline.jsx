// AdminPipeline — A-1 Applications Pipeline / Intake (Task 16)
//
// The admin portal's working list. Reads GET /admin/platform/applications
// (adminPlatformApi.getPipeline) with server-side filters held in component
// state, and re-fetches whenever a filter changes. Each row is one application
// (TIR or SIP); the table mirrors the A-1 prototype's column set.
//
// Beyond the filtered table this screen drives the gate-1 working actions:
//   • multi-select rows → bulk decision (shortlist / hold / reject / waitlist)
//     via POST /admin/platform/decisions/bulk. hold/reject/waitlist require a
//     rationale (backend returns `rationale_required` otherwise), so those
//     prompt before sending. Per-id failures in the response (illegal_transition
//     / rationale_required / not_found / error) surface as an inline note.
//   • bulk Hide / Archive → PATCH .../meta per selected row.
//   • assign-to-batch → POST /admin/platform/batches/{id}/applications.
//   • CSV export of the currently-loaded rows (client-side, mirrors the
//     reviewer queue export).
//
// Row click (outside the checkbox) navigates to the T17 detail route
// /admin/application/{track}/{id}. That route 404s until T17 ships; the link
// target is intentionally the future path.
//
// Every field access is guarded — the row shape can carry nulls (no decision,
// no batch, no score) and a missing key must render "—", never crash.

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import {
  useAsync,
  LoadingState,
  ErrorState,
  EmptyState,
  Chip,
  ScoreBar,
} from "./ui.jsx";

// ─── Status / decision presentation ────────────────────────────────────────
const STATUS_OPTIONS = [
  { id: "", label: "All statuses" },
  { id: "submitted", label: "Submitted" },
  { id: "ai_screening", label: "AI screening" },
  { id: "under_review", label: "Under review" },
  { id: "evaluated", label: "Evaluated" },
  { id: "shortlisted", label: "Shortlisted" },
  { id: "interview", label: "Interview" },
  { id: "on_hold", label: "On hold" },
  { id: "offered", label: "Offered" },
  { id: "onboarded", label: "Onboarded" },
  { id: "rejected", label: "Rejected" },
  { id: "waitlisted", label: "Waitlisted" },
  { id: "withdrawn", label: "Withdrawn" },
];

const DECISION_OPTIONS = [
  { id: "", label: "Any decision" },
  { id: "shortlisted", label: "Shortlisted" },
  { id: "on_hold", label: "On hold" },
  { id: "rejected", label: "Rejected" },
  { id: "waitlisted", label: "Waitlisted" },
];

// Bulk decision verbs → the wire `decision` value + whether a rationale is
// mandatory (backend rejects hold/reject/waitlist with no rationale).
const BULK_DECISIONS = [
  { id: "shortlisted", label: "Shortlist", needsRationale: false },
  { id: "on_hold", label: "Hold", needsRationale: true },
  { id: "rejected", label: "Reject", needsRationale: true },
  { id: "waitlisted", label: "Waitlist", needsRationale: true },
];

const STATUS_TONE = {
  shortlisted: "green",
  offered: "green",
  onboarded: "green",
  interview: "blue",
  evaluated: "purple",
  under_review: "amber",
  ai_screening: "amber",
  on_hold: "amber",
  submitted: "",
  rejected: "red",
  waitlisted: "slate",
  withdrawn: "slate",
};

const DECISION_TONE = {
  shortlisted: "green",
  on_hold: "amber",
  rejected: "red",
  waitlisted: "slate",
};

function prettify(v) {
  if (!v) return "";
  return String(v)
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const BULK_RESULT_LABEL = {
  rationale_required: "rationale required",
  illegal_transition: "illegal transition",
  not_found: "not found",
  error: "error",
};

// ─── CSV (pure, unit-tested) ────────────────────────────────────────────────
const CSV_HEADERS = [
  "ID",
  "Track",
  "Name",
  "Founder",
  "Industry",
  "Stage",
  "AI Score",
  "Status",
  "Decision",
  "Batch",
  "Submitted",
];

function csvCell(v) {
  const str = v == null ? "" : String(v);
  return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

// Build a CSV string from the currently-loaded rows. Exported for the unit
// test; pure, no DOM.
export function buildPipelineCsv(rows) {
  const lines = (rows || []).map((r) => [
    r?.applicationId ?? r?.id ?? "",
    r?.track === "sip" ? "SIP" : r?.track === "tir" ? "TIR" : r?.track ?? "",
    r?.name ?? "",
    r?.founder ?? "",
    r?.industry ?? "",
    r?.stage ?? "",
    typeof r?.ai_score_overall === "number"
      ? r.ai_score_overall.toFixed(1)
      : "",
    prettify(r?.status),
    prettify(r?.decision),
    r?.batch ?? "",
    r?.submitted_at ?? "",
  ]);
  return [CSV_HEADERS, ...lines]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function downloadCsv(rows) {
  const csv = buildPipelineCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "artpark-applications.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Filters ────────────────────────────────────────────────────────────────
const EMPTY_FILTERS = {
  track: "all",
  status: "",
  industry: "",
  decision: "",
  search: "",
  include_hidden: false,
  include_archived: false,
};

// Translate component filter state → the getPipeline query params, dropping
// the "all"/empty sentinels the backend would otherwise treat as a literal.
function toQuery(f) {
  const params = {};
  if (f.track && f.track !== "all") params.track = f.track;
  if (f.status) params.status = f.status;
  if (f.industry) params.industry = f.industry;
  if (f.decision) params.decision = f.decision;
  if (f.search.trim()) params.search = f.search.trim();
  if (f.include_hidden) params.include_hidden = true;
  if (f.include_archived) params.include_archived = true;
  return params;
}

function hasActiveFilters(f) {
  return (
    f.track !== "all" ||
    f.status !== "" ||
    f.industry !== "" ||
    f.decision !== "" ||
    f.search.trim() !== "" ||
    f.include_hidden ||
    f.include_archived
  );
}

export default function AdminPipeline() {
  const navigate = useNavigate();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // {kind, text} surfaced after a bulk op

  // Re-fetch whenever the filter inputs change (the query string is the dep so
  // toggling between two states that yield the same params won't refetch).
  const query = useMemo(() => toQuery(filters), [filters]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getPipeline(query),
    [queryKey],
  );

  // Industry dropdown options come from the shared leadership taxonomy.
  const { data: industryData } = useAsync(
    () => leadershipApi.getIndustryCategories(),
    [],
  );
  // Batches for the assign-to-batch picker.
  const { data: batchData } = useAsync(() => adminPlatformApi.getBatches(), []);

  const rows = useMemo(() => data?.applications ?? [], [data]);
  const total = data?.total ?? rows.length;
  const industries = industryData?.categories ?? [];
  const batches = useMemo(() => {
    if (Array.isArray(batchData)) return batchData;
    return batchData?.batches ?? [];
  }, [batchData]);

  // A row's stable identity for selection (track + the row id used by writes).
  const rowKey = useCallback((r) => `${r?.track}:${r?.id}`, []);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelectedKeys(new Set());
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSelectedKeys(new Set());
  };

  const toggleRow = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));
  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(allKeys));
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(rowKey(r))),
    [rows, selectedKeys, rowKey],
  );

  const finishBulk = useCallback(
    async (resultNote) => {
      setSelectedKeys(new Set());
      setNote(resultNote || null);
      await reload();
    },
    [reload],
  );

  // ── Bulk: decisions ──────────────────────────────────────────────────────
  const runBulkDecision = async (opt) => {
    if (busy || selectedRows.length === 0) return;
    let rationale = "";
    if (opt.needsRationale) {
      const entered = window.prompt(
        `Rationale for "${opt.label}" on ${selectedRows.length} application(s) (required):`,
        "",
      );
      if (entered == null) return; // cancelled
      rationale = entered.trim();
      if (!rationale) {
        setNote({ kind: "error", text: "A rationale is required for that decision." });
        return;
      }
    }
    setBusy(true);
    setNote(null);
    try {
      const resp = await adminPlatformApi.bulkDecide({
        items: selectedRows.map((r) => ({
          track: r.track,
          application_id: r.id,
          decision: opt.id,
          rationale: rationale || undefined,
        })),
      });
      const results = resp?.results ?? [];
      const failures = results.filter((x) => x?.status && x.status !== "decided");
      const ok = results.length - failures.length;
      if (failures.length === 0) {
        await finishBulk({ kind: "ok", text: `${opt.label}: ${ok} updated.` });
      } else {
        const detail = failures
          .map((x) => `${x.application_id} (${BULK_RESULT_LABEL[x.status] || x.status})`)
          .join(", ");
        await finishBulk({
          kind: "error",
          text: `${opt.label}: ${ok} updated, ${failures.length} failed — ${detail}`,
        });
      }
    } catch (e) {
      setNote({ kind: "error", text: `Bulk decision failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  // ── Bulk: hide / archive (one PATCH per row) ─────────────────────────────
  const runBulkMeta = async (patch, label) => {
    if (busy || selectedRows.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const settled = await Promise.allSettled(
        selectedRows.map((r) => adminPlatformApi.patchMeta(r.track, r.id, patch)),
      );
      const failed = settled.filter((s) => s.status === "rejected").length;
      const ok = settled.length - failed;
      await finishBulk(
        failed === 0
          ? { kind: "ok", text: `${label}: ${ok} updated.` }
          : { kind: "error", text: `${label}: ${ok} updated, ${failed} failed.` },
      );
    } catch (e) {
      setNote({ kind: "error", text: `${label} failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  // ── Bulk: assign to batch ────────────────────────────────────────────────
  const runAssignBatch = async (batchId) => {
    if (busy || !batchId || selectedRows.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.assignBatch(batchId, {
        items: selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
      });
      const batchName =
        batches.find((b) => String(b?.id) === String(batchId))?.name || "batch";
      await finishBulk({
        kind: "ok",
        text: `Assigned ${selectedRows.length} to ${batchName}.`,
      });
    } catch (e) {
      setNote({ kind: "error", text: `Batch assign failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  const onRowClick = (r) => {
    if (!r?.track || r?.id == null) return;
    navigate(`/admin/application/${r.track}/${r.id}`);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const selectedCount = selectedRows.length;

  return (
    <div className="dash-scroll">
      <style>{BULK_BAR_CSS}</style>

      {/* Header + CSV export */}
      <div className="pl-head">
        <div>
          <div className="dash-section-tag">A-1 · PIPELINE</div>
          <div className="dash-card-title">All applications</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            {loading ? "Loading…" : `${rows.length} of ${total} shown`}
          </div>
        </div>
        <button
          className="os-btn ghost"
          onClick={() => downloadCsv(rows)}
          disabled={rows.length === 0}
        >
          Export CSV ↓
        </button>
      </div>

      {/* Filters */}
      <div className="os-filterbar" style={{ borderRadius: 4, border: "1px solid var(--line)" }}>
        <div className="os-search-wrap">
          <input
            className="os-input search"
            placeholder="Search name, founder, ID"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
        </div>

        <span className="label">Track</span>
        <select
          className="os-select"
          value={filters.track}
          onChange={(e) => setFilter({ track: e.target.value })}
        >
          <option value="all">All tracks</option>
          <option value="tir">TIR</option>
          <option value="sip">SIP</option>
        </select>

        <span className="label">Status</span>
        <select
          className="os-select"
          value={filters.status}
          onChange={(e) => setFilter({ status: e.target.value })}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        <span className="label">Industry</span>
        <select
          className="os-select"
          value={filters.industry}
          onChange={(e) => setFilter({ industry: e.target.value })}
        >
          <option value="">All industries</option>
          {industries.map((c) => (
            <option key={c?.id ?? c?.label} value={c?.id ?? c?.label}>
              {c?.label ?? c?.id}
              {typeof c?.count === "number" ? ` (${c.count})` : ""}
            </option>
          ))}
        </select>

        <span className="label">Decision</span>
        <select
          className="os-select"
          value={filters.decision}
          onChange={(e) => setFilter({ decision: e.target.value })}
        >
          {DECISION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        <label className="pl-toggle">
          <input
            type="checkbox"
            checked={filters.include_hidden}
            onChange={(e) => setFilter({ include_hidden: e.target.checked })}
          />
          Show hidden
        </label>
        <label className="pl-toggle">
          <input
            type="checkbox"
            checked={filters.include_archived}
            onChange={(e) => setFilter({ include_archived: e.target.checked })}
          />
          Show archived
        </label>

        {hasActiveFilters(filters) && (
          <button className="pl-clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Surface the last bulk-op outcome (per-id failures included). */}
      {note && (
        <div className={"pl-note " + (note.kind === "error" ? "is-error" : "is-ok")}>
          <span>{note.text}</span>
          <button className="pl-note-x" onClick={() => setNote(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* Table / states */}
      {loading ? (
        <LoadingState label="Loading applications…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState label="No applications match these filters." />
      ) : (
        <div className="pl-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th>ID</th>
                <th>Name</th>
                <th>Founder</th>
                <th>Industry</th>
                <th>Stage</th>
                <th style={{ minWidth: 150 }}>AI Score</th>
                <th>Status</th>
                <th>Decision</th>
                <th>Batch</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = rowKey(r);
                const dimmed = r?.isHidden || r?.isArchived;
                return (
                  <tr
                    key={key}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.5 : 1 }}
                    onClick={() => onRowClick(r)}
                  >
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        onChange={() => toggleRow(key)}
                        aria-label={`Select ${r?.name || r?.id}`}
                      />
                    </td>
                    <td className="os-mono os-text-xs">{r?.applicationId ?? "—"}</td>
                    <td className="startup">
                      {r?.name ?? "—"}
                      {r?.isHidden && (
                        <span className="os-chip red" style={{ fontSize: 9, padding: "1px 5px", marginLeft: 6 }}>
                          HIDDEN
                        </span>
                      )}
                      {r?.isArchived && (
                        <span className="os-chip slate" style={{ fontSize: 9, padding: "1px 5px", marginLeft: 6 }}>
                          ARCHIVED
                        </span>
                      )}
                    </td>
                    <td>{r?.founder ?? "—"}</td>
                    <td className="os-text-soft">{r?.industry ?? "—"}</td>
                    <td className="os-text-soft">{r?.stage ?? "—"}</td>
                    <td>
                      {typeof r?.ai_score_overall === "number" ? (
                        <ScoreBar label="" value={r.ai_score_overall} />
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>
                    <td>
                      {r?.status ? (
                        <Chip tone={STATUS_TONE[r.status] || ""}>
                          {prettify(r.status).toUpperCase()}
                        </Chip>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>
                    <td>
                      {r?.decision ? (
                        <Chip tone={DECISION_TONE[r.decision] || ""}>
                          {prettify(r.decision).toUpperCase()}
                        </Chip>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>
                    <td className="os-text-soft">{r?.batch ?? "—"}</td>
                    <td className="os-text-soft os-text-xs">{r?.submitted_at ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk action bar (selection-driven) */}
      {selectedCount > 0 && (
        <div className="pl-bulkbar" role="region" aria-label="Bulk actions">
          <span className="pl-bulk-count">{selectedCount} selected</span>
          <span className="pl-bulk-div" />
          {BULK_DECISIONS.map((opt) => (
            <button
              key={opt.id}
              className={"pl-bulk-btn" + (opt.id === "shortlisted" ? " primary" : "")}
              disabled={busy}
              onClick={() => runBulkDecision(opt)}
            >
              {opt.label}
            </button>
          ))}
          <span className="pl-bulk-div" />
          <button
            className="pl-bulk-btn"
            disabled={busy}
            onClick={() => runBulkMeta({ is_hidden: true }, "Hide")}
          >
            Hide
          </button>
          <button
            className="pl-bulk-btn"
            disabled={busy}
            onClick={() => runBulkMeta({ is_archived: true }, "Archive")}
          >
            Archive
          </button>
          <span className="pl-bulk-div" />
          <select
            className="pl-bulk-select"
            value=""
            disabled={busy || batches.length === 0}
            onChange={(e) => {
              if (e.target.value) runAssignBatch(e.target.value);
            }}
          >
            <option value="">
              {batches.length === 0 ? "No batches" : "Assign to batch…"}
            </option>
            {batches.map((b) => (
              <option key={b?.id} value={b?.id}>
                {b?.name ?? b?.id}
              </option>
            ))}
          </select>
          <button
            className="pl-bulk-btn ghost"
            disabled={busy}
            onClick={() => setSelectedKeys(new Set())}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

// Scoped styles for the toggles, inline note, and the floating bulk bar.
// Everything else reuses classes already in admin-portal.css.
const BULK_BAR_CSS = `
.adm-portal .pl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.adm-portal .pl-toggle {
  display:inline-flex; align-items:center; gap:6px;
  font-family:var(--font-sans); font-size:12.5px; color:var(--ink-soft);
  cursor:pointer; user-select:none;
}
.adm-portal .pl-toggle input { cursor:pointer; }
.adm-portal .pl-clear {
  background:none; border:none; cursor:pointer; padding:0 4px;
  font-family:var(--font-sans); font-size:13px; font-weight:600; color:#d23b40;
}
.adm-portal .pl-clear:hover { text-decoration:underline; }
.adm-portal .pl-note {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans);
}
.adm-portal .pl-note.is-ok { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .pl-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .pl-note-x {
  background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px;
}
.adm-portal .pl-table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; }
.adm-portal .pl-bulkbar {
  position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  background:rgba(239,246,255,0.97); backdrop-filter:blur(12px);
  border:1.5px solid #3213b7; border-radius:6px; padding:10px 16px;
  box-shadow:0 10px 30px rgba(37,99,235,0.18); z-index:1000;
}
.adm-portal .pl-bulk-count {
  font-family:var(--font-sans); font-size:12px; font-weight:600; color:#1f0a8a;
  background:#e9e4fb; border:1px solid #cdc4f1; border-radius:4px; padding:4px 10px; white-space:nowrap;
}
.adm-portal .pl-bulk-div { width:1px; height:18px; background:var(--line); }
.adm-portal .pl-bulk-btn {
  height:32px; padding:0 12px; border:1px solid var(--line); background:#fff;
  font-family:var(--font-sans); font-size:12px; font-weight:600; color:var(--ink-soft);
  border-radius:4px; cursor:pointer; white-space:nowrap;
}
.adm-portal .pl-bulk-btn:hover:not(:disabled) { background:var(--bg-soft); border-color:var(--line-strong); color:var(--ink); }
.adm-portal .pl-bulk-btn.primary { background:var(--ink); border-color:var(--ink); color:#fff; }
.adm-portal .pl-bulk-btn.primary:hover:not(:disabled) { background:var(--accent); border-color:var(--accent); }
.adm-portal .pl-bulk-btn.ghost { border-color:transparent; background:transparent; color:var(--ink-dim); }
.adm-portal .pl-bulk-btn:disabled { opacity:0.5; cursor:not-allowed; }
.adm-portal .pl-bulk-select {
  height:32px; padding:0 10px; border:1px solid var(--line); background:#fff;
  font-family:var(--font-sans); font-size:12px; font-weight:600; color:var(--ink-soft);
  border-radius:4px; cursor:pointer;
}
.adm-portal .pl-bulk-select:disabled { opacity:0.5; cursor:not-allowed; }
`;
