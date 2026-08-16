// The VIP process dashboard's "This period" feed, replacing TIR's static
// "This week" card (Task 7 places it right of AirScorecardPanel in the
// dashboard's two-column row). Deliberately unlike TIR's `FEED`, whose
// entries are hardcoded demo copy — every row here comes from
// `vipDashboardRollup.activityFeed()`'s real AIR/MIS timestamps. Reuses
// `.fj-dash-feed-list`/`.fj-dash-feed-row`/`.fj-dash-feed-dot`/
// `.fj-dash-feed-text`/`.fj-dash-feed-meta` from founder-portal.css
// unchanged — no new CSS in this task. Presentational only: no
// founderApi import, no fetching.

// Copied, not imported — the same 4-line token map FounderDashboard.jsx
// already carries verbatim (`FEED_COLOR`), matching this codebase's small-
// guard-duplication precedent rather than reaching across module
// boundaries for four lines.
const FEED_COLOR = {
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  blue: "var(--artblue)",
  dim: "var(--ink-dim)",
};

export default function ActivityFeedPanel({ events }) {
  const rows = (events || []).slice(0, 8); // defence in depth — activityFeed already caps at 8

  return (
    <div className="card fj-dash-card">
      <div className="fj-dash-card-title">This period</div>
      {rows.length === 0 ? (
        // One cause, not two (unlike states 6/7): no submissions, no
        // reopens, no verifications yet is a single genuinely-empty state,
        // not two distinct causes needing distinct copy.
        <p className="vipd-air-status">Nothing to show yet — your first submission will appear here.</p>
      ) : (
        <div className="fj-dash-feed-list">
          {rows.map((f, i) => (
            <div className="fj-dash-feed-row" key={i}>
              <span className="fj-dash-feed-dot" style={{ background: FEED_COLOR[f.color] || FEED_COLOR.dim }} />
              <div>
                <div className="fj-dash-feed-text">{f.text}</div>
                <div className="fj-dash-feed-meta">{f.meta}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
