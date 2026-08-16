// AdminVipMisPeriod — one MIS period, read-only (spec §7: "opening one
// renders it read-only"). Renders every section generically from the
// catalog slice the bundle ships (mis_query.period_bundle), the same
// catalog-driven approach air_catalog/mis_catalog use everywhere else in
// this feature — no per-section hardcoding that could drift from a catalog
// revision.
//
// Reopen returns a submitted period to draft. The one write this screen
// makes can be refused with 409 mis_later_period_submitted — reopening an
// EARLIER period while a LATER one is already submitted would silently move
// that later period's own derived comparisons (vs last, headcount net
// change) the next time it's read. That refusal is surfaced as a named,
// clickable link to the blocking period (via onNavigatePeriod), never a
// generic error banner.

import React, { useState } from "react";
import { adminVipApi } from "../../../../lib/adminVipApi.js";
import { useAsync } from "../ui.jsx";
import { LoadingState, ErrorState } from "../ui.jsx";
import { PageHead } from "../shell/osAtoms";
import {
  formatDate, formatDateTime, fieldValueText, groupExtraEntries, humanize, vipErrorInfo,
} from "./vipCohortHelpers.js";

function NarrativeField({ prompt, value }) {
  return (
    <div className="vipc-narrative-field">
      <div className="prompt">{prompt}</div>
      <div className="value">
        {value ? value : <span className="os-text-dim">Not filled in.</span>}
      </div>
    </div>
  );
}

function EntriesTable({ title, fields, rows }) {
  return (
    <div>
      {title && <div className="vipc-extra-title">{title}</div>}
      {rows.length === 0 ? (
        <div className="os-text-dim os-text-sm" style={{ marginTop: 6 }}>
          No entries recorded for this section yet.
        </div>
      ) : (
        <table className="vipc-mini-table">
          <thead>
            <tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => <td key={f.key}>{fieldValueText(f, r.data?.[f.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricsSection({ catalog, metrics, derived }) {
  if (!metrics || metrics.length === 0) {
    return <div className="os-text-dim os-text-sm">No metrics recorded yet.</div>;
  }
  const groups = catalog.metric_groups || [];
  const byGroup = {};
  for (const m of metrics) (byGroup[m.group_key] = byGroup[m.group_key] || []).push(m);
  const vsLast = derived?.metrics?.vs_last || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map((g) => {
        const rows = byGroup[g.key] || [];
        if (rows.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="vipc-extra-title">{g.label}</div>
            <table className="vipc-mini-table">
              <thead>
                <tr><th>Metric</th><th>Target</th><th>Actual</th><th>vs last</th><th>RAG</th><th>Commentary</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.metric_key}>
                    <td>{m.label}</td>
                    <td>{m.target ?? "—"}</td>
                    <td>{m.actual ?? "—"}</td>
                    <td>{vsLast[m.metric_key] ?? "—"}</td>
                    <td>{m.rag || "—"}</td>
                    <td>{m.commentary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function FinancialsSection({ catalog, financials, derived }) {
  const series = catalog.financial_series || {};
  const buckets = catalog.financial_buckets || {};
  const byKey = {};
  for (const r of financials || []) byKey[`${r.series}:${r.bucket}`] = r.amount;
  const needsGap = derived?.financials?.needs_gap || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {Object.entries(series).map(([groupKey, rows]) => {
        const bucketList = buckets[groupKey] || [];
        return (
          <table key={groupKey} className="vipc-mini-table">
            <thead>
              <tr><th /> {bucketList.map((b) => <th key={b}>{b}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  {bucketList.map((b) => {
                    const val = s.key === "needs_gap" ? needsGap[b] : byKey[`${s.key}:${b}`];
                    return <td key={b}>{val ?? "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

function HeadcountSection({ catalog, headcount, derived }) {
  const categories = catalog.headcount_categories || [];
  const byCategory = {};
  for (const r of headcount || []) byCategory[r.category] = r;
  const netChange = derived?.headcount?.net_change || {};
  const total = derived?.headcount?.total || {};
  return (
    <table className="vipc-mini-table">
      <thead>
        <tr><th>Category</th><th>Current</th><th>Exited</th><th>Net change</th><th>Remarks</th></tr>
      </thead>
      <tbody>
        {categories.map((c) => {
          const r = byCategory[c.key] || {};
          return (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td>{r.current_count ?? "—"}</td>
              <td>{r.exited ?? "—"}</td>
              <td>{netChange[c.key] ?? "—"}</td>
              <td>{r.remarks || "—"}</td>
            </tr>
          );
        })}
        <tr>
          <td><strong>Total</strong></td>
          <td>{total.current_count ?? "—"}</td>
          <td>{total.exited ?? "—"}</td>
          <td>—</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function SectionBlock({ section, catalog, extras, metrics, financials, headcount, entries, narrative, derived }) {
  const narrativeFields = catalog.narrative_fields?.[section.id] || [];
  return (
    <div className="vipc-section">
      <div className="vipc-section-head">
        <span className="num">§{section.number}</span>
        <strong>{section.title}</strong>
        {section.hint && <div className="os-text-xs os-text-dim" style={{ marginTop: 4 }}>{section.hint}</div>}
      </div>
      <div className="vipc-section-body">
        {narrativeFields.map((f) => (
          <NarrativeField key={f.id} prompt={f.prompt} value={narrative[f.id]} />
        ))}

        {section.type === "entries" && (
          <>
            <EntriesTable fields={catalog.entry_fields?.[section.id] || []} rows={entries[section.id] || []} />
            {extras.map((key) => (
              <EntriesTable key={key} title={humanize(key)} fields={catalog.entry_fields?.[key] || []} rows={entries[key] || []} />
            ))}
          </>
        )}

        {section.type === "metrics" && <MetricsSection catalog={catalog} metrics={metrics} derived={derived} />}
        {section.type === "financials" && <FinancialsSection catalog={catalog} financials={financials} derived={derived} />}
        {section.type === "headcount" && <HeadcountSection catalog={catalog} headcount={headcount} derived={derived} />}
      </div>
    </div>
  );
}

function ReopenModal({ onClose, onConfirm, busy, error, onNavigateBlocker }) {
  return (
    <div
      className="os-modal-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="os-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4 }}>
        <div className="os-modal-head" style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Reopen period</div>
        </div>
        <div className="os-modal-body" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="os-text-sm">
            This returns the period to draft so the founder can correct it. Whatever they change will need to be resubmitted.
          </div>
          {error && (
            <div className="vipc-banner error">
              <div>{error.message}</div>
              {error.blockerPeriodKey && (
                <button
                  className="os-btn sm ghost"
                  style={{ marginTop: 8 }}
                  onClick={() => onNavigateBlocker(error.blockerPeriodKey)}
                >
                  Go to {error.blockerLabel || error.blockerPeriodKey} →
                </button>
              )}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <button className="os-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={onConfirm} disabled={busy}>
              {busy ? "Reopening…" : "Reopen period"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminVipMisPeriod({ applicationId, kind, periodKey, canWrite, onBack, onChanged, onNavigatePeriod }) {
  const { data, loading, error, reload } = useAsync(
    () => adminVipApi.getMisPeriod(applicationId, kind, periodKey),
    [applicationId, kind, periodKey],
  );
  const [reopenOpen, setReopenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reopenErr, setReopenErr] = useState(null);

  if (loading) return <LoadingState label="Loading this period…" />;
  if (error) {
    return (
      <div>
        <PageHead breadcrumb={[{ label: "MIS submissions matrix", onClick: onBack }]} eyebrow="VIP COHORT · MIS" title="Period" />
        <ErrorState error={{ message: vipErrorInfo(error).message }} onRetry={reload} />
      </div>
    );
  }

  const { catalog, period, metrics, financials, headcount, entries, narrative, derived, startup } = data;
  const extras = groupExtraEntries(catalog);

  const doReopen = async () => {
    setBusy(true); setReopenErr(null);
    try {
      await adminVipApi.reopenMisPeriod(applicationId, kind, periodKey);
      setReopenOpen(false);
      reload();
      onChanged?.();
    } catch (e) {
      setReopenErr(vipErrorInfo(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead
        breadcrumb={[{ label: "MIS submissions matrix", onClick: onBack }]}
        eyebrow="VIP COHORT · MIS"
        title={startup}
        sub={`${period.label} · ${period.status === "submitted" ? "Submitted" : "Draft"}${period.due_date ? ` · Due ${formatDate(period.due_date)}` : ""}`}
        actions={canWrite && period.status === "submitted" ? [
          <button key="reopen" className="os-btn secondary" onClick={() => setReopenOpen(true)}>Reopen</button>,
        ] : undefined}
      />

      {period.reopened_at && (
        <div className="vipc-banner info">
          Reopened {formatDateTime(period.reopened_at)}. Awaiting the founder's correction and resubmission.
        </div>
      )}

      {catalog.sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          catalog={catalog}
          extras={extras[section.id] || []}
          metrics={metrics}
          financials={financials}
          headcount={headcount}
          entries={entries}
          narrative={narrative}
          derived={derived}
        />
      ))}

      {reopenOpen && (
        <ReopenModal
          busy={busy}
          error={reopenErr}
          onClose={() => { setReopenOpen(false); setReopenErr(null); }}
          onConfirm={doReopen}
          onNavigateBlocker={(pk) => { setReopenOpen(false); onNavigatePeriod?.(pk); }}
        />
      )}
    </div>
  );
}

export default AdminVipMisPeriod;
