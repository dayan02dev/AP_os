// The §2 Key Metrics grid (spec §5.4): 13 catalog metrics grouped into 4
// families, each row a Target/Actual/RAG/Commentary line plus a
// server-computed `vs_last` comparison. Presentational only, no
// `founderApi` import — everything framework-specific (which 13 keys
// exist, their labels/units/groups) already lives on `metrics`
// (`bundle.metrics` — every catalog metric is pre-seeded blank by the
// backend before a founder ever reaches this page, per models/mis.py's
// `MetricIn` docstring) and `metricGroups` (`bundle.catalog.metric_groups`),
// both server-owned. Nothing here hardcodes the 13-key list.
//
// Two rows get absolute, structural (not template-content) special-casing,
// matching the same "hardcode the shape, not the words" idiom LeverPanel
// uses for q1/q2/q3 and EvidenceRow uses for its MIME allow-list:
//   - `trl_level` is never an editable input, in any state — sending any
//     `actual` for it 422s `computed_metric` server-side (models/mis.py).
//   - `product_metric_1`/`product_metric_2` get an editable label input;
//     every other row's label is fixed by the catalog and rendered plain.
// A third case is signalled by the row itself, not hardcoded here at all:
// `row.is_custom` (server-set — `put_metrics` 422s `unknown_field` for any
// key outside the 13-key catalog today, per E10, so a custom row can only
// ever be one carried forward from before that rule, never one this UI
// created) makes the whole row read-only with E10's copy.
//
// vs_last (E5-E8): `actual == null` renders nothing (E5 — nothing to
// compare from). Otherwise a `null` vs_last means either "first period of
// its kind" (E6) or "earlier period's own actual was blank" (E7) — the two
// causes get different copy, per `isFirstPeriod` (computed by the caller,
// Task 7, from whether an earlier period of the same kind exists). A real
// `vs_last`, including exactly `0`, always renders the literal number —
// `!= null`, never a truthiness check, so a real "no change" never reads as
// "no comparable figure."
const RAG_OPTIONS = [
  { value: "", label: "—" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "red", label: "Red" },
];

function numOrNull(raw) {
  const t = String(raw ?? "").trim();
  return t === "" ? null : Number(t);
}
function textOrNull(raw) {
  const t = String(raw ?? "").trim();
  return t === "" ? null : raw;
}

function VsLastCell({ actual, vsLastValue, isFirstPeriod }) {
  if (actual == null) return null; // E5
  if (vsLastValue == null) {
    return (
      <span className="mis-vs-last">
        {isFirstPeriod
          ? "First reporting period — nothing to compare yet." // E6
          : "No comparable figure last period." /* E7 */}
      </span>
    );
  }
  // E8: a real 0 (or any other number) renders verbatim — `vsLastValue`
  // has already passed the `== null` gate above, so this branch is only
  // ever reached for a real, reportable number.
  const cls = vsLastValue > 0 ? "is-up" : vsLastValue < 0 ? "is-down" : "is-flat";
  const text = vsLastValue > 0 ? `+${vsLastValue}` : String(vsLastValue);
  return <span className={`mis-vs-last ${cls}`}>{text}</span>;
}

function MetricRow({ metricRow, vsLastValue, isFirstPeriod, disabled, onChange }) {
  const isTrl = metricRow.metric_key === "trl_level";
  const isCustom = !isTrl && metricRow.is_custom === true;
  const labelEditable =
    metricRow.metric_key === "product_metric_1" || metricRow.metric_key === "product_metric_2";

  // trl_level: never an input, in any state (E9 / "never editable" rule).
  if (isTrl) {
    return (
      <div className="mis-metric-row mis-metric-readonly" data-metric-key={metricRow.metric_key}>
        <span className="mis-metric-label">{metricRow.label}</span>
        <span className="mis-metric-actual">
          {metricRow.actual != null
            ? metricRow.actual
            : "Populated automatically once ARTPARK has verified all six AIR levers this quarter."}
        </span>
      </div>
    );
  }

  // Carried-forward / unrecognised metric (E10): read-only, no controls.
  if (isCustom) {
    return (
      <div className="mis-metric-row mis-metric-readonly" data-metric-key={metricRow.metric_key}>
        <span className="mis-metric-label">{metricRow.label}</span>
        <span className="mis-metric-target">{metricRow.target ?? "—"}</span>
        <span className="mis-metric-actual">{metricRow.actual ?? "—"}</span>
        <span className="mis-metric-commentary">{metricRow.commentary ?? "—"}</span>
        <span className="mis-metric-custom-note">
          Carried forward from an earlier period. Contact ARTPARK to update it.
        </span>
      </div>
    );
  }

  return (
    <div className="mis-metric-row" data-metric-key={metricRow.metric_key}>
      {labelEditable ? (
        <input
          type="text"
          aria-label="Label"
          defaultValue={metricRow.label ?? ""}
          disabled={disabled}
          onBlur={(e) => onChange(metricRow.metric_key, "label", textOrNull(e.target.value))}
        />
      ) : (
        <span className="mis-metric-label">{metricRow.label}</span>
      )}
      <input
        type="number"
        aria-label="Target"
        defaultValue={metricRow.target ?? ""}
        disabled={disabled}
        onBlur={(e) => onChange(metricRow.metric_key, "target", numOrNull(e.target.value))}
      />
      <input
        type="number"
        aria-label="Actual"
        defaultValue={metricRow.actual ?? ""}
        disabled={disabled}
        onBlur={(e) => onChange(metricRow.metric_key, "actual", numOrNull(e.target.value))}
      />
      <VsLastCell actual={metricRow.actual} vsLastValue={vsLastValue} isFirstPeriod={isFirstPeriod} />
      <select
        aria-label="RAG"
        value={metricRow.rag ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(metricRow.metric_key, "rag", e.target.value === "" ? null : e.target.value)}
      >
        {RAG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input
        type="text"
        aria-label="Commentary"
        defaultValue={metricRow.commentary ?? ""}
        disabled={disabled}
        onBlur={(e) => onChange(metricRow.metric_key, "commentary", textOrNull(e.target.value))}
      />
    </div>
  );
}

export default function MetricsGrid({ metrics, metricGroups, vsLast, isFirstPeriod, disabled, onChange }) {
  const groups = metricGroups || [];
  const buckets = groups.map((g) => ({ key: g.key, label: g.label, rows: [] }));
  const otherRows = [];
  for (const r of metrics || []) {
    const bucket = buckets.find((b) => b.key === r.group_key);
    if (bucket) bucket.rows.push(r);
    else otherRows.push(r);
  }
  // A row whose group_key doesn't match any known group (a defensive case —
  // see E10) still has to be reachable somewhere, per the same "every row
  // must be shown, at its own level" principle EvidenceRow's `otherRows`
  // establishes for orphaned AIR evidence.
  if (otherRows.length > 0) buckets.push({ key: "__other__", label: "Other", rows: otherRows });

  return (
    <div className="mis-metrics-grid">
      {buckets
        .filter((b) => b.rows.length > 0)
        .map((b) => (
          <div className="mis-metric-group" key={b.key}>
            <h4 className="mis-metric-group-label">{b.label}</h4>
            {b.rows.map((r) => (
              <MetricRow
                key={r.metric_key}
                metricRow={r}
                vsLastValue={vsLast ? vsLast[r.metric_key] : null}
                isFirstPeriod={isFirstPeriod}
                disabled={disabled}
                onChange={onChange}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
