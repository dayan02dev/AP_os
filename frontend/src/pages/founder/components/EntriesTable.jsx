// Generic repeating-row editor for every MIS `entries`-type section
// (milestones, risks, asks, ip_assets, collaborations, publications,
// products, funding, planned_vs_actual, next_milestones).
//
// Presentational only, matching LeverPanel.jsx / EvidenceRow.jsx: no
// founderApi import, everything reported upward through `onSave`. Nothing
// about which fields exist, their types, labels or option lists is
// hardcoded — all of it comes from the `fields` prop
// (bundle.catalog.entry_fields[sectionId]), server-owned.
//
// THE SHARPEST TRAP IN THIS COMPONENT: `PUT .../entries/{section}`
// wholesale-replaces the section. `onSave(sectionId, rows)` must therefore
// ALWAYS carry the section's complete, current row array — editing one
// field of one row, adding a row, or removing a row all call `onSave` with
// the full array, never a partial diff. Sending anything less deletes every
// row this call omits the next time the caller actually PUTs it.
//
// Bucketed sections (a `bucket`-keyed choice field present in `fields`,
// e.g. ip_assets/collaborations/publications) group displayed rows under a
// header per `field.options` value, in that catalog order — including
// buckets with zero matching rows (E13), so a founder can see a bucket
// exists before they've put anything in it. A row whose bucket value is
// `null` (freshly added, not yet assigned) or otherwise doesn't match any
// declared option is not a state the plan's E-table names, but dropping it
// silently would violate the same "every row must be reachable somewhere"
// invariant EvidenceRow's own catch-all section (F2) establishes — so it
// renders under its own "Unassigned" group instead of vanishing.
import { useEffect, useState } from "react";

function toDataArray(rows) {
  return (rows || []).map((r) => (r && r.data) || {});
}

function blankRow(fields) {
  const row = {};
  (fields || []).forEach((f) => {
    row[f.key] = null;
  });
  return row;
}

// Resolves a choice/bucket option's display text from `field.option_labels`
// when the catalog supplies one (e.g. asks.category); falls back to the raw
// stored value otherwise (e.g. ip_assets.bucket, which the catalog leaves
// unlabelled) — never a client-invented transformation of either.
function optionLabel(field, value) {
  const found = (field?.option_labels || []).find((o) => o.value === value);
  return found ? found.label : value;
}

function EntryField({ sectionId, idx, field, value, disabled, onLocalChange, onCommit }) {
  const id = `mis-entry-${sectionId}-${idx}-${field.key}`;

  if (field.type === "choice") {
    return (
      <label className="mis-entries-field" htmlFor={id}>
        <span className="mis-entries-field-label">{field.label}</span>
        <select
          id={id}
          disabled={disabled}
          value={value == null ? "" : value}
          onChange={(e) => {
            const v = e.target.value === "" ? null : e.target.value;
            onLocalChange(v);
            onCommit(v);
          }}
        >
          <option value="">—</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {optionLabel(field, opt)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "bool") {
    // Tri-state, not a checkbox: `_validate_entry_value` explicitly accepts
    // `None` for a bool field, distinct from `false` — a checkbox has no
    // third state to represent "not answered."
    const current = value === true ? "true" : value === false ? "false" : "";
    return (
      <label className="mis-entries-field" htmlFor={id}>
        <span className="mis-entries-field-label">{field.label}</span>
        <select
          id={id}
          disabled={disabled}
          value={current}
          onChange={(e) => {
            const raw = e.target.value;
            const v = raw === "" ? null : raw === "true";
            onLocalChange(v);
            onCommit(v);
          }}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    );
  }

  if (field.type === "date") {
    return (
      <label className="mis-entries-field" htmlFor={id}>
        <span className="mis-entries-field-label">{field.label}</span>
        <input
          id={id}
          type="date"
          disabled={disabled}
          value={value == null ? "" : value}
          onChange={(e) => {
            const v = e.target.value === "" ? null : e.target.value;
            onLocalChange(v);
            onCommit(v);
          }}
        />
      </label>
    );
  }

  if (field.type === "int" || field.type === "numeric") {
    return (
      <label className="mis-entries-field" htmlFor={id}>
        <span className="mis-entries-field-label">{field.label}</span>
        <input
          id={id}
          type="number"
          step={field.type === "int" ? "1" : "any"}
          disabled={disabled}
          value={value == null ? "" : value}
          onChange={(e) => onLocalChange(e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value;
            onCommit(raw.trim() === "" ? null : Number(raw));
          }}
        />
      </label>
    );
  }

  // text
  return (
    <label className="mis-entries-field" htmlFor={id}>
      <span className="mis-entries-field-label">{field.label}</span>
      <input
        id={id}
        type="text"
        disabled={disabled}
        value={value == null ? "" : value}
        onChange={(e) => onLocalChange(e.target.value)}
        onBlur={(e) => {
          const raw = e.target.value;
          onCommit(raw.trim() === "" ? null : raw);
        }}
      />
    </label>
  );
}

function EntryRow({ sectionId, idx, data, fields, disabled, onLocalChange, onCommit, onRemove }) {
  return (
    <div className="mis-entries-row" data-row-idx={idx}>
      <div className="mis-entries-row-head">
        <span className="mis-entries-row-index">Row {idx + 1}</span>
        {!disabled && (
          <button
            type="button"
            className="btn btn-sm btn-destructive mis-entries-remove"
            aria-label={`Remove row ${idx + 1}`}
            onClick={() => onRemove(idx)}
          >
            Remove
          </button>
        )}
      </div>
      <div className="mis-entries-row-fields">
        {fields.map((f) => (
          <EntryField
            key={f.key}
            sectionId={sectionId}
            idx={idx}
            field={f}
            value={data[f.key]}
            disabled={disabled}
            onLocalChange={(v) => onLocalChange(idx, f.key, v)}
            onCommit={(v) => onCommit(idx, f.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

export default function EntriesTable({
  sectionId,
  title,
  fields,
  rows,
  isFirstPeriod,
  disabled,
  onSave,
}) {
  const safeFields = fields || [];
  const [localData, setLocalData] = useState(() => toDataArray(rows));

  // The bundle is server-truth-driven — every write's response replaces the
  // whole bundle, so this component has no "unsaved local-only row" concept
  // beyond the in-flight edit buffer. Resync whenever the caller hands us a
  // new `rows` array.
  useEffect(() => {
    setLocalData(toDataArray(rows));
  }, [rows]);

  const changeLocal = (idx, key, value) => {
    setLocalData((prev) => prev.map((d, i) => (i === idx ? { ...d, [key]: value } : d)));
  };

  const commitField = (idx, key, value) => {
    setLocalData((prev) => {
      const next = prev.map((d, i) => (i === idx ? { ...d, [key]: value } : d));
      onSave(sectionId, next);
      return next;
    });
  };

  const addRow = () => {
    setLocalData((prev) => {
      const next = [...prev, blankRow(safeFields)];
      onSave(sectionId, next);
      return next;
    });
  };

  const removeRow = (idx) => {
    setLocalData((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      onSave(sectionId, next);
      return next;
    });
  };

  const bucketField = safeFields.find((f) => f.key === "bucket");

  const rowProps = (idx) => ({
    sectionId,
    idx,
    data: localData[idx],
    fields: safeFields,
    disabled,
    onLocalChange: changeLocal,
    onCommit: commitField,
    onRemove: removeRow,
  });

  let body = null;
  if (localData.length === 0) {
    body = (
      <div className="mis-entries-empty">
        {isFirstPeriod
          ? `No ${title} yet — this is your first reporting period. Add one below.`
          : "Nothing here for this period yet. Add a row if there's something new."}
      </div>
    );
  } else if (bucketField) {
    const options = bucketField.options || [];
    const byBucket = new Map(options.map((opt) => [opt, []]));
    const unassigned = [];
    localData.forEach((d, idx) => {
      const b = d[bucketField.key];
      if (b != null && byBucket.has(b)) {
        byBucket.get(b).push(idx);
      } else {
        unassigned.push(idx);
      }
    });
    body = (
      <>
        {options.map((opt) => {
          const label = optionLabel(bucketField, opt);
          const indices = byBucket.get(opt);
          return (
            <div className="mis-entries-bucket" key={opt} data-bucket={opt}>
              <div className="mis-entries-bucket-head">{label}</div>
              {indices.length === 0 ? (
                <div className="mis-entries-empty">{`No ${label} yet.`}</div>
              ) : (
                indices.map((idx) => <EntryRow key={idx} {...rowProps(idx)} />)
              )}
            </div>
          );
        })}
        {unassigned.length > 0 && (
          <div className="mis-entries-bucket mis-entries-unassigned" data-bucket="unassigned">
            <div className="mis-entries-bucket-head">Unassigned</div>
            {unassigned.map((idx) => (
              <EntryRow key={idx} {...rowProps(idx)} />
            ))}
          </div>
        )}
      </>
    );
  } else {
    body = localData.map((_, idx) => <EntryRow key={idx} {...rowProps(idx)} />);
  }

  return (
    <div className="mis-entries-table" data-section-id={sectionId}>
      {body}
      {!disabled && (
        <button type="button" className="btn btn-sm btn-ghost mis-entries-add" onClick={addRow}>
          + Add row
        </button>
      )}
    </div>
  );
}
