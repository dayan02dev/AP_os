// Quarterly §8 People: four headcount-category rows plus a server-computed
// Total row.
//
// Presentational only, matching LeverPanel.jsx / EvidenceRow.jsx: no
// founderApi import, everything reported upward through `onChange`.
// `putMisHeadcount` is a targeted upsert — each field commits independently
// as a single-row array, same shape as FinancialsGrid.
//
// `net_change` is a per-category delta against the previous quarter,
// computed server-side (this quarter's `current_count` minus the previous
// quarter's, a stock-over-time delta — never re-derived here, and never
// `current_count - exited`, a different quantity the phase-4/5 retrospective
// flags as the exact sign-error shape that shipped once already). It is
// `null` for TWO different reasons that need different copy (E16 vs E17):
// no previous quarter exists at all, or one exists but its own
// `current_count` for that category was itself left blank. `isFirstPeriod`
// is what tells those apart; the catalog gives no other signal.
//
// The Total row is structurally different from a category row, not just a
// styled variant of one: `derived.headcount.total` carries no `net_change`
// key at all (the source template leaves that cell blank by definition), so
// that cell renders NOTHING — no text, no dash — never E16/E17's copy and
// never a fabricated "0". `current_count`/`exited` on the Total row are
// rendered exactly as `derived.headcount.total` gives them, including a
// partial sum when some categories are still blank; this component never
// re-sums the four category rows itself.
import { useEffect, useState } from "react";

const E16_COPY = "No prior quarter to compare.";
const E17_COPY = "Last quarter's headcount wasn't recorded.";

function toRowMap(headcount) {
  const map = {};
  (headcount || []).forEach((r) => {
    map[r.category] = {
      current_count: r.current_count,
      exited: r.exited,
      remarks: r.remarks,
    };
  });
  return map;
}

// E18: signed verbatim — "+2", "-3", "0". Zero carries no sign; a negative
// value already carries its own "-" from JS number formatting.
function formatSigned(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

function CategoryRow({ category, label, row, netChange, isFirstPeriod, disabled, onLocalChange, onCommit }) {
  const hasNetChange = netChange != null;
  return (
    <div className="mis-headcount-row" data-category={category}>
      <div className="mis-headcount-label">{label}</div>
      <div className="mis-headcount-cell">
        <input
          type="number"
          aria-label={`${label} — Current count`}
          disabled={disabled}
          value={row.current_count == null ? "" : row.current_count}
          onChange={(e) => onLocalChange(category, "current_count", e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value;
            onCommit(category, "current_count", raw.trim() === "" ? null : Number(raw));
          }}
        />
      </div>
      <div className="mis-headcount-cell">
        <input
          type="number"
          aria-label={`${label} — Exited this quarter`}
          disabled={disabled}
          value={row.exited == null ? "" : row.exited}
          onChange={(e) => onLocalChange(category, "exited", e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value;
            onCommit(category, "exited", raw.trim() === "" ? null : Number(raw));
          }}
        />
      </div>
      <div className={`mis-net-change${hasNetChange ? "" : " mis-net-change-empty"}`}>
        {hasNetChange ? formatSigned(netChange) : isFirstPeriod ? E16_COPY : E17_COPY}
      </div>
      <div className="mis-headcount-cell">
        <input
          type="text"
          aria-label={`${label} — Remarks`}
          disabled={disabled}
          value={row.remarks == null ? "" : row.remarks}
          onChange={(e) => onLocalChange(category, "remarks", e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value;
            onCommit(category, "remarks", raw.trim() === "" ? null : raw);
          }}
        />
      </div>
    </div>
  );
}

function TotalRow({ total }) {
  const cc = total?.current_count;
  const ex = total?.exited;
  return (
    <div className="mis-headcount-row mis-headcount-total" data-category="__total__">
      <div className="mis-headcount-label">Total</div>
      <div className="mis-headcount-cell">{cc == null ? "—" : String(cc)}</div>
      <div className="mis-headcount-cell">{ex == null ? "—" : String(ex)}</div>
      {/* E19: the source template's Total row leaves Net Change blank by
          definition — `derived.headcount.total` carries no `net_change` key
          at all. Rendering "—" here would wrongly claim the concept applies
          but has no value; this cell renders no text node whatsoever. */}
      <div className="mis-net-change mis-net-change-empty" />
      <div className="mis-headcount-cell" />
    </div>
  );
}

export default function HeadcountGrid({
  headcount,
  headcountCategories,
  derived,
  isFirstPeriod,
  disabled,
  onChange,
}) {
  const [localRows, setLocalRows] = useState(() => toRowMap(headcount));

  // The bundle is server-truth-driven — every write's response replaces the
  // whole bundle. Resync whenever the caller hands us a new `headcount`
  // array.
  useEffect(() => {
    setLocalRows(toRowMap(headcount));
  }, [headcount]);

  const changeLocal = (category, field, value) => {
    setLocalRows((prev) => ({
      ...prev,
      [category]: { ...(prev[category] || {}), [field]: value },
    }));
  };

  const commit = (category, field, value) => {
    setLocalRows((prev) => ({
      ...prev,
      [category]: { ...(prev[category] || {}), [field]: value },
    }));
    onChange(category, field, value);
  };

  const categories = headcountCategories || [];
  const netChangeMap = derived?.net_change || {};
  const total = derived?.total || {};

  return (
    <div className="mis-headcount-grid">
      <div className="mis-headcount-head">
        <div>Category</div>
        <div>Current count</div>
        <div>Exited this quarter</div>
        <div>Net change</div>
        <div>Remarks</div>
      </div>
      {categories.map((cat) => (
        <CategoryRow
          key={cat.key}
          category={cat.key}
          label={cat.label}
          row={localRows[cat.key] || {}}
          netChange={netChangeMap[cat.key] ?? null}
          isFirstPeriod={isFirstPeriod}
          disabled={disabled}
          onLocalChange={changeLocal}
          onCommit={commit}
        />
      ))}
      <TotalRow total={total} />
    </div>
  );
}
