// 24-week experiment timeline. Faithful port of TIR Onboarding.dc.html's
// showTimeline block + renderVals() `experimentsView`/`milestones` math:
//   left  = (startWeek - 1) / 24 * 100%
//   width = min(weeks, 24 - startWeek + 1) / 24 * 100%
//   bar color by risk: high=coral, medium=amber, low=green
//   milestones at wk8/16/24 (Gate 1·M2 / Gate 2·M4 / Gate 3·M6)
//
// `compact` (used by the residency dashboard's "Cycle timeline" card) drops
// the start/weeks number inputs and milestone labels, shrinks row heights,
// and draws a coral "today" line at week 3 (CURWEEK) instead.
const WEEKS = 24;
const CURWEEK = 3;
const RISK_COLOR = {
  high: "var(--accent-coral)",
  medium: "var(--accent-amber)",
  low: "var(--accent-green)",
};
const MILESTONES = [
  { week: 8, label: "Gate 1 · M2" },
  { week: 16, label: "Gate 2 · M4" },
  { week: 24, label: "Gate 3 · M6" },
];
const MONTHS = ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"];

function shortLabel(text) {
  const a = (text || "").trim() || "Untitled assumption";
  return a.length > 58 ? a.slice(0, 58) + "…" : a;
}

// Fallback for callers that only have a "Wk X–Y" range label (e.g. the
// residency dashboard's experiments_view) rather than raw start_week/weeks.
function parseRange(label) {
  const m = /Wk\s*(\d+)\s*[–-]\s*(\d+)/.exec(label || "");
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return { startWeek: start, weeks: Math.max(1, end - start + 1) };
}

function normalize(e) {
  const hasExplicitStart = e.start_week != null || e.startWeek != null;
  const parsed = hasExplicitStart ? null : parseRange(e.range_label || e.rangeLabel);
  const startWeek = e.startWeek ?? e.start_week ?? parsed?.startWeek ?? 1;
  const weeks = e.weeks ?? parsed?.weeks ?? 1;
  const short = e.short || shortLabel(e.assumption);
  const risk = e.risk || "medium";
  return { ...e, startWeek, weeks, short, risk };
}

export default function Gantt({ experiments = [], onUpdate, compact = false }) {
  const rows = experiments.map(normalize);

  const update = (id, field, value) => {
    if (!onUpdate) return;
    const n = Math.max(1, Math.min(24, parseInt(value, 10) || 1));
    onUpdate(id, field, n);
  };

  return (
    <div className={`fj-gantt${compact ? " compact" : ""}`}>
      <div className="fj-gantt-rail">
        <div className="fj-gantt-rail-head" />
        {rows.map((e) => (
          <div className="fj-gantt-rail-row" key={e.id}>
            <span className="fj-gantt-short">{e.short}</span>
            {!compact && (
              <div className="fj-gantt-inputs">
                <span>Wk</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={e.startWeek}
                  onChange={(ev) => update(e.id, "start_week", ev.target.value)}
                />
                <span>for</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={e.weeks}
                  onChange={(ev) => update(e.id, "weeks", ev.target.value)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="fj-gantt-plot">
        <div className="fj-gantt-months">
          {MONTHS.map((m) => (
            <div key={m} className="fj-gantt-month">{m}</div>
          ))}
        </div>
        {!compact &&
          MILESTONES.map((m) => (
            <div key={m.label}>
              <div className="fj-gantt-mline" style={{ left: `${(m.week / WEEKS) * 100}%` }} />
              <div className="fj-gantt-mlabel" style={{ left: `${(m.week / WEEKS) * 100}%` }}>
                {m.label}
              </div>
            </div>
          ))}
        {compact && (
          <div className="fj-gantt-today" style={{ left: `${(CURWEEK / WEEKS) * 100}%` }} />
        )}
        <div className="fj-gantt-rows">
          {rows.map((e) => {
            const left = ((e.startWeek - 1) / WEEKS) * 100;
            const width = (Math.min(e.weeks, WEEKS - e.startWeek + 1) / WEEKS) * 100;
            const rangeLabel =
              e.range_label || e.rangeLabel || `Wk ${e.startWeek}–${e.startWeek + e.weeks - 1}`;
            return (
              <div className="fj-gantt-row" key={e.id}>
                <div
                  className={`fj-gantt-bar${compact ? " sm" : ""}`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: RISK_COLOR[e.risk] || RISK_COLOR.medium,
                  }}
                >
                  {!compact && <span className="fj-gantt-bar-label">{rangeLabel}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
