// AdminAudit — A-7 Audit Log
//
// Faithful port of prototype AdminAudit (admin-2.jsx:2040) with live data.
// Replaces static mock rows with entries from useAdminData("audit", params).
//
// Filter approach reused from the old AdminAuditLog.jsx:
//   - actor/action (text inputs), from/to (date pickers) held in component state
//   - toQuery() maps state → API params, dropping empty values
//   - params object passed to useAdminData — the hook keys on JSON.stringify(params)
//     so changing any filter triggers a re-fetch automatically
//   - CSV download re-issues the same query with format:"csv" and triggers a
//     client-side anchor download (UTF-8 BOM included)
//
// Prototype markup preserved verbatim:
//   os-filterbar / os-select / os-card / os-audit / os-audit-row / aud-action
//   PageHead eyebrow "A-7 · AUDIT LOG", title, sub, actions array

import { useState } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi.js";

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

export function AdminAudit() {
  const [filters, setFilters] = useStickyState("admin.audit", "filters", EMPTY_FILTERS);
  const params = toQuery(filters);

  const { data, loading, error, reload } = useAdminData("audit", params);
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
        ...params,
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
    <div>
      <style>{AUDIT_CSS}</style>

      <PageHead
        eyebrow="A-7 · AUDIT LOG"
        title='Cohort <em>audit trail</em>'
        sub="Every state-changing action. Immutable. Downloadable for compliance."
        actions={[
          <button
            key="dl"
            className="os-btn ghost"
            onClick={downloadCsv}
            disabled={downloading}
          >
            {downloading ? "Preparing…" : "Download CSV"}
          </button>,
        ]}
      />

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

      {/* Filters — prototype uses selects; we use text+date inputs for server-side filtering */}
      <div className="os-filterbar">
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
          placeholder="e.g. GATE_1_DECIDE"
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
        <div className="os-card" style={{ borderTop: "none" }}>
          <div className="os-audit">
            <div
              className="os-audit-row"
              style={{
                fontWeight: 600,
                color: "var(--ink-dim)",
                textTransform: "uppercase",
                fontSize: 10,
                letterSpacing: "0.14em",
              }}
            >
              <span>Timestamp</span>
              <span>Actor</span>
              <span>Action / Description</span>
            </div>
            {entries.map((e, i) => (
              <div key={`${e?.ts ?? ""}-${i}`} className="os-audit-row">
                <span className="ts">{e?.ts ?? "—"}</span>
                <span className="act">{e?.actor ?? "—"}</span>
                <span>
                  {e?.action ? (
                    <b className="aud-action" style={{ marginRight: 8 }}>
                      {e.action}
                    </b>
                  ) : null}
                  {e?.target ? (
                    <span className="desc">{e.target}</span>
                  ) : null}
                  {e?.detail ? (
                    <span className="desc">{e?.target ? " · " : ""}{e.detail}</span>
                  ) : null}
                  {!e?.action && !e?.target && !e?.detail ? (
                    <span className="os-text-soft">—</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAudit;

// Scoped styles — reuses pl-* utilities shared with AdminPipeline/AdminAnalytics;
// adds aud-action pill and os-audit grid layout
const AUDIT_CSS = `
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
