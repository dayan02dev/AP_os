// AdminAuditLog — A-8 Audit Log (Task 20)
//
// Immutable, filterable trail of every state-changing action. Reads
// GET /admin/platform/audit-log (adminPlatformApi.getAuditLog) with server-side
// filters held in component state; re-fetches whenever a filter changes.
//
//   Response: { entries: [{ ts, actor, action, target, detail }] }
//
// "Download CSV" re-issues the same query with format:"csv" — the backend
// returns text/csv, which lib/api.js surfaces as a plain string (non-JSON
// content type). We wrap that text in a Blob and trigger a client-side
// download via an anchor.
//
// Every field access is guarded — any of ts/actor/action/target/detail can be
// null and must render "—", never crash.

import { useState } from "react";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "./ui.jsx";

const EMPTY_FILTERS = { actor: "", action: "", from: "", to: "" };

// Translate component filter state → query params, dropping empty sentinels.
function toQuery(f) {
  const params = {};
  if (f.actor.trim()) params.actor = f.actor.trim();
  if (f.action.trim()) params.action = f.action.trim();
  if (f.from) params.from = f.from;
  if (f.to) params.to = f.to;
  return params;
}

function hasActiveFilters(f) {
  return (
    f.actor.trim() !== "" ||
    f.action.trim() !== "" ||
    f.from !== "" ||
    f.to !== ""
  );
}

function triggerDownload(text, filename) {
  const blob = new Blob(["﻿" + (text || "")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminAuditLog() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const queryKey = JSON.stringify(toQuery(filters));

  const { data, loading, error, reload } = useAsync(
    () => adminPlatformApi.getAuditLog(toQuery(filters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey],
  );

  const entries = data?.entries ?? [];

  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState(null);

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const downloadCsv = async () => {
    if (downloading) return;
    setDownloading(true);
    setDlError(null);
    try {
      const csv = await adminPlatformApi.getAuditLog({
        ...toQuery(filters),
        format: "csv",
      });
      triggerDownload(
        typeof csv === "string" ? csv : "",
        "artpark-audit-log.csv",
      );
    } catch (e) {
      setDlError(e?.message || "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="dash-scroll">
      <style>{AUDIT_CSS}</style>

      {/* Header + CSV export */}
      <div className="pl-head">
        <div>
          <div className="dash-section-tag">A-8 · AUDIT LOG</div>
          <div className="dash-card-title">Cohort audit trail</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            Every state-changing action. Immutable. Downloadable for compliance.
          </div>
        </div>
        <button
          className="os-btn ghost"
          onClick={downloadCsv}
          disabled={downloading}
        >
          {downloading ? "Preparing…" : "Download CSV ↓"}
        </button>
      </div>

      {dlError && (
        <div className="pl-note is-error">
          <span>{dlError}</span>
          <button
            className="pl-note-x"
            onClick={() => setDlError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Filters */}
      <div
        className="os-filterbar"
        style={{ borderRadius: 4, border: "1px solid var(--line)" }}
      >
        <span className="label">Actor</span>
        <input
          className="os-input"
          placeholder="e.g. admin@artpark.in"
          value={filters.actor}
          onChange={(e) => setFilter({ actor: e.target.value })}
          style={{ minWidth: 180 }}
        />

        <span className="label">Action</span>
        <input
          className="os-input"
          placeholder="e.g. gate1_decide"
          value={filters.action}
          onChange={(e) => setFilter({ action: e.target.value })}
          style={{ minWidth: 160 }}
        />

        <span className="label">From</span>
        <input
          type="date"
          className="os-input"
          value={filters.from}
          onChange={(e) => setFilter({ from: e.target.value })}
        />

        <span className="label">To</span>
        <input
          type="date"
          className="os-input"
          value={filters.to}
          onChange={(e) => setFilter({ to: e.target.value })}
        />

        {hasActiveFilters(filters) && (
          <button className="pl-clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table / states */}
      {loading ? (
        <LoadingState label="Loading audit log…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : entries.length === 0 ? (
        <EmptyState label="No audit entries match these filters." />
      ) : (
        <div className="pl-table-wrap">
          <table className="os-table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e?.ts ?? ""}-${i}`}>
                  <td className="os-mono os-text-xs os-text-soft">
                    {e?.ts ?? "—"}
                  </td>
                  <td className="os-text-sm">{e?.actor ?? "—"}</td>
                  <td>
                    {e?.action ? (
                      <span className="aud-action">{e.action}</span>
                    ) : (
                      <span className="os-text-soft">—</span>
                    )}
                  </td>
                  <td className="os-text-soft os-text-sm">
                    {e?.target ?? "—"}
                  </td>
                  <td className="os-text-sm">{e?.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Reuses pl-head / pl-table-wrap / pl-note / pl-clear from AdminPipeline's
// scoped styles where present; defines only the action-pill accent here.
const AUDIT_CSS = `
.adm-portal .pl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.adm-portal .pl-table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; }
.adm-portal .pl-clear {
  background:none; border:none; cursor:pointer; padding:0 4px;
  font-family:var(--font-sans); font-size:13px; font-weight:600; color:#d23b40;
}
.adm-portal .pl-clear:hover { text-decoration:underline; }
.adm-portal .pl-note {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans);
  margin-bottom:12px;
}
.adm-portal .pl-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .pl-note-x {
  background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px;
}
.adm-portal .aud-action {
  font-family:var(--font-mono); font-size:11px; font-weight:600; letter-spacing:0.02em;
  color:var(--accent); background:var(--accent-soft, #eef3ff);
  border:1px solid var(--line); border-radius:3px; padding:2px 7px; white-space:nowrap;
}
`;
