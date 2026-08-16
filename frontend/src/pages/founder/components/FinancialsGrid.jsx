// Quarterly §6 Financials: the annual-revenue grid (2 series x 6 FY
// buckets) and the financial-needs grid (3 editable series + a read-only,
// server-computed Gap row, x 5 quarter buckets).
//
// Presentational only, matching LeverPanel.jsx / EvidenceRow.jsx: no
// founderApi import, everything reported upward through `onChange`. Unlike
// EntriesTable, `putMisFinancials` is a targeted upsert — each cell commits
// independently as a single-row array; this component never batches the
// whole grid into one write.
//
// Nothing about series/bucket labels is hardcoded — `financialSeries` and
// `financialBuckets` both come from the PERIOD-LEVEL catalog. The
// annual-revenue bucket labels in particular are fiscal-year-relative and
// computed server-side (`annual_revenue_buckets`); this component renders
// whatever six strings it is given, never recomputing or assuming a
// sequence.
//
// The Gap row is never one of the needs grid's editable rows: `needs_gap`
// is excluded from the editable rows by key and rendered separately from
// `needsGap` (bundle.derived.financials.needs_gap), which the backend
// computes and `put_financials` refuses to accept a write for
// (`computed_metric`). `null` there means "not all three inputs are filled
// in yet" (E14); `0` is a real, reportable "fully covered" (E15) and must
// render as the literal `"0"`, never fall through to E14's copy.
import { useEffect, useState } from "react";

const GAP_KEY = "needs_gap";
const GAP_EMPTY_COPY = "Shows once Total, Confirmed and Projected are all filled in.";

function toAmountMap(financials) {
  const map = {};
  (financials || []).forEach((r) => {
    map[`${r.series}::${r.bucket}`] = r.amount;
  });
  return map;
}

function FinancialsSection({ title, rows, buckets, amounts, disabled, onLocalChange, onCommit, gap }) {
  return (
    <div className="mis-financials-grid" data-grid-title={title}>
      <div className="mis-financials-row is-head" style={{ "--mis-cols": buckets.length }}>
        <div className="mis-financials-label">{title}</div>
        {buckets.map((b) => (
          <div className="mis-financials-cell" key={b}>
            {b}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div className="mis-financials-row" style={{ "--mis-cols": buckets.length }} key={row.key}>
          <div className="mis-financials-label">{row.label}</div>
          {buckets.map((bucket) => {
            const mapKey = `${row.key}::${bucket}`;
            const value = amounts[mapKey];
            return (
              <div className="mis-financials-cell" key={bucket}>
                <input
                  type="number"
                  aria-label={`${row.label} — ${bucket}`}
                  disabled={disabled}
                  value={value == null ? "" : value}
                  onChange={(e) => onLocalChange(row.key, bucket, e.target.value)}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    onCommit(row.key, bucket, raw.trim() === "" ? null : Number(raw));
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
      {gap && (
        <div className="mis-financials-row mis-gap-row" style={{ "--mis-cols": buckets.length }}>
          <div className="mis-financials-label">{gap.label}</div>
          {buckets.map((bucket) => {
            const v = gap.values ? gap.values[bucket] : undefined;
            return (
              <div className="mis-gap-cell" key={bucket}>
                {v == null ? GAP_EMPTY_COPY : String(v)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function FinancialsGrid({
  financials,
  financialSeries,
  financialBuckets,
  needsGap,
  disabled,
  onChange,
}) {
  const [amounts, setAmounts] = useState(() => toAmountMap(financials));

  // The bundle is server-truth-driven — every write's response replaces the
  // whole bundle. Resync whenever the caller hands us a new `financials`
  // array.
  useEffect(() => {
    setAmounts(toAmountMap(financials));
  }, [financials]);

  const changeLocal = (series, bucket, raw) => {
    setAmounts((prev) => ({ ...prev, [`${series}::${bucket}`]: raw }));
  };

  const commit = (series, bucket, value) => {
    setAmounts((prev) => ({ ...prev, [`${series}::${bucket}`]: value }));
    onChange(series, bucket, value);
  };

  const annualRows = financialSeries?.annual_revenue || [];
  const annualBuckets = financialBuckets?.annual_revenue || [];

  const needsRowsAll = financialSeries?.needs || [];
  const gapRow = needsRowsAll.find((r) => r.key === GAP_KEY);
  const needsRows = needsRowsAll.filter((r) => r.key !== GAP_KEY);
  const needsBuckets = financialBuckets?.needs || [];

  return (
    <div className="mis-financials">
      <FinancialsSection
        title="Annual revenue"
        rows={annualRows}
        buckets={annualBuckets}
        amounts={amounts}
        disabled={disabled}
        onLocalChange={changeLocal}
        onCommit={commit}
      />
      <FinancialsSection
        title="Financial needs"
        rows={needsRows}
        buckets={needsBuckets}
        amounts={amounts}
        disabled={disabled}
        onLocalChange={changeLocal}
        onCommit={commit}
        gap={{ label: gapRow?.label || "Gap", values: needsGap }}
      />
    </div>
  );
}
