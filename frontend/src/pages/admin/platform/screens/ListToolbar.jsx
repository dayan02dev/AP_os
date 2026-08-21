// One filter toolbar for every admin list screen.
//
// Before this existed there were three implementations of the same control:
// AdminPipeline's inline <style> block, admin-portal.css, and a hand-rolled
// copy in AdminSelectedApplications whose inline style objects overrode the
// shared class — which is why the identical track switcher rendered as a blue
// pill on one page and a grey square on the next.
//
// Segment groups are a list so a screen can carry more than one (track AND
// decision, say) and the second inherits the first's styling by construction
// rather than by someone remembering to copy it.

export default function ListToolbar({
  search, onSearch, searchPlaceholder = "Search…", searchLabel = "Search",
  segments = [], trailing = null, count = null, total = null, panel = null,
}) {
  // With no panel open the search card's bottom margin and the area's bottom
  // padding leave ~60px of empty band. Collapsing removes it.
  const collapsed = !panel;

  return (
    <div className={`lp-filter-area${collapsed ? " is-collapsed" : ""}`}>
      <div className="lp-filter-row--search">
        <div className="os-search-wrap" style={{ flexShrink: 0 }}>
          <input
            className="os-input search"
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        {segments.map((g, i) => (
          <div key={i} className="lp-track-group" role="group" aria-label={g.ariaLabel}>
            {g.options.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`lp-track-btn${g.value === v ? " active" : ""}`}
                aria-pressed={g.value === v}
                onClick={() => g.onChange(v)}
              >
                {label}
              </button>
            ))}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {trailing}

        {count != null && (
          <span className="lp-count">
            {count}{total != null ? ` of ${total}` : ""}
          </span>
        )}
      </div>

      {panel && <div className="lp-filter-panel">{panel}</div>}
    </div>
  );
}
