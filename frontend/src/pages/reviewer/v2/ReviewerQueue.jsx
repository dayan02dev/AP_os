// Reviewer queue — ported from REVIEWER-UI/os/reviewer.jsx ReviewerQueue.
// Filters/search operate on reviewerApi.getQueue() rows. Row click navigates
// to /reviewer/eval/:track/:appId via onOpen(track, appId).
//
// Server-shape adaptations vs the prototype:
//   * `industry` replaces `domain` (alias used throughout filters/search)
//   * `reviewStatus` is only not-started | draft | submitted (no in-progress)
//   * `due` is an ISO timestamp (or null) → rendered as a short date
//   * `detached` rows are submitted reviews whose assignment was removed;
//     `closed` rows are reviewed apps that were rejected. Both are "inactive"
//     and hidden by default behind one "Show inactive (N)" toggle
//   * filtering / sorting / facet counts live in lib/reviewerQueueFilters.js,
//     shared with the eval screen's Prev/Next so both walk the same list
//   * the track filter uses the EFFECTIVE track (movedToTrack || track); the
//     native `track` is kept for the eval route

import { useMemo, useRef } from "react";
import { LoadingState, ErrorState, Chip } from "./ui.jsx";
import { relabelDisplayId, trackLabel, displayIdText } from "../../../lib/trackLabel.js";
import { RecoBadge, RECO_LABEL } from "../../../components/RecoCell.jsx";
import { readStickyState, useStickyState, writeStickyState } from "../../../hooks/useStickyState.js";
import {
  QUEUE_SCOPE as SCOPE,
  applyQueueFilters,
  facetCounts,
  isInactive,
  sortQueue,
  visibleQueueRows,
} from "../../../lib/reviewerQueueFilters.js";

// The queue is fetched once at the ReviewerPortal shell level and passed down
// via `queueAsync` ({ data, loading, error, reload }) so the queue table and
// the tab badge share a single getQueue request per page view.

export default function ReviewerQueue({ onOpen, initialDomain, navKey, queueAsync }) {
  const [search, setSearch] = useStickyState(SCOPE, "search", "");
  const [track, setTrack] = useStickyState(SCOPE, "track", "all");
  const [statusFilter, setStatusFilter] = useStickyState(SCOPE, "status", "all");
  const [stageFilter, setStageFilter] = useStickyState(SCOPE, "stage", "all");
  const [domainFilter, setDomainFilter] = useStickyState(SCOPE, "domain", "all");
  const [recoFilter, setRecoFilter] = useStickyState(SCOPE, "reco", "all");
  const [showFilters, setShowFilters] = useStickyState(SCOPE, "showFilters", false);
  const [showInactive, setShowInactive] = useStickyState(SCOPE, "showInactive", false);

  const [sortCol, setSortCol] = useStickyState(SCOPE, "sortCol", null);
  const [sortAsc, setSortAsc] = useStickyState(SCOPE, "sortAsc", true);

  // Arriving from the dashboard's "pick an industry" tile carries a domain in
  // router state (including an explicit "all"). That is a deliberate act, so it
  // overrides — and replaces — whatever domain was remembered. `navKey` (the
  // router location key) makes each pick apply once; the applied key is kept
  // in sticky state (not a ref) so browser Back to the same history entry —
  // which restores the same key and state — does not re-apply an old pick.
  // Adjusting during render (rather than in an effect) keeps the remembered
  // filter from flashing first.
  const appliedPickRef = useRef(undefined);
  if (appliedPickRef.current === undefined) {
    appliedPickRef.current = readStickyState(SCOPE, "appliedPick", null);
  }
  const pickKey = navKey ?? initialDomain;
  if (initialDomain !== undefined && appliedPickRef.current !== pickKey) {
    appliedPickRef.current = pickKey;
    writeStickyState(SCOPE, "appliedPick", pickKey);
    if (domainFilter !== initialDomain) setDomainFilter(initialDomain);
    // The dashboard tile counted every live row of that industry, so the queue
    // it opens must not stay narrowed by other remembered filters.
    if (search !== "") setSearch("");
    if (track !== "all") setTrack("all");
    if (statusFilter !== "all") setStatusFilter("all");
    if (stageFilter !== "all") setStageFilter("all");
    if (recoFilter !== "all") setRecoFilter("all");
    if (showInactive) setShowInactive(false);
  }

  const { data, loading, error, reload } = queueAsync;
  const allQueue = data || [];
  // Rows the reviewer can actually see: closed/unassigned ones only when
  // "Show inactive" is on. Every count (chips, "N of total") is over this set.
  const visible = visibleQueueRows(allQueue, showInactive);
  const filters = {
    search, track, status: statusFilter, stage: stageFilter, domain: domainFilter,
    reco: recoFilter, showInactive, sortCol, sortAsc,
  };
  const filtered = applyQueueFilters(visible, filters);
  // Inactive rows the current filters would reveal (the toggle's promise).
  const inactiveCount = applyQueueFilters(allQueue.filter(isInactive), filters).length;

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const renderHeader = (label, colKey, isNum = false, style = {}) => {
    const isSorted = sortCol === colKey;
    return (
      <th
        style={{ cursor: "pointer", userSelect: "none", ...style }}
        onClick={() => handleSort(colKey)}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}
          {isSorted ? (sortAsc ? " ▲" : " ▼") : ""}
        </span>
      </th>
    );
  };

  const sortedFiltered = useMemo(
    () => sortQueue(filtered, sortCol, sortAsc),
    [filtered, sortCol, sortAsc], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const STATUS_DOTS = {
    submitted: "var(--ok)",
    draft: "var(--warn)",
    "not-started": "var(--ink-dim)",
  };
  const STATUS_LABELS = { submitted: "Submitted", draft: "Draft", "not-started": "Not Started" };

  // Facet chips: each count is over rows matching every OTHER active filter.
  // A chip is listed when it has rows, or when it is the active choice.
  const facets = facetCounts(visible, filters);
  const chipRows = (counts, active) => {
    const rows = Object.entries(counts);
    if (active !== "all" && !(active in counts)) rows.push([active, 0]);
    return rows.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  };
  const industryRows = chipRows(facets.industry, domainFilter);
  const stageRows = chipRows(facets.stage, stageFilter);
  const statusCounts = facets.status;
  const recoCounts = facets.reco;

  const hasFilters =
    search || track !== "all" || statusFilter !== "all" || stageFilter !== "all" || domainFilter !== "all" || recoFilter !== "all" ||
    showInactive;
  const activeFilterCount =
    (track !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (stageFilter !== "all" ? 1 : 0) +
    (domainFilter !== "all" ? 1 : 0) +
    (recoFilter !== "all" ? 1 : 0);
  const clearAll = () => {
    setSearch("");
    setTrack("all");
    setStatusFilter("all");
    setStageFilter("all");
    setDomainFilter("all");
    setRecoFilter("all");
    setShowInactive(false);
  };

  return (
    <div>
      <div className="lp-filter-area">
        <div className="lp-filter-row--search">
          <div className="os-search-wrap" style={{ flexShrink: 0 }}>
            <input
              className="os-input search"
              placeholder="Search by name, ID, founder, or industry"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="lp-track-group">
            {[["all", "All tracks"], ["tir", "TIR"], ["sip", "VIP"]].map(([v, label]) => (
              <button key={v} className={`lp-track-btn${track === v ? " active" : ""}`} onClick={() => setTrack(v)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            className={`lp-filter-btn${showFilters ? " active" : ""}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {hasFilters && (
            <button className="lp-filter-btn lp-clear-btn" onClick={clearAll}>Clear filters</button>
          )}
          {(inactiveCount > 0 || showInactive) && (
            <button
              className={`lp-filter-btn${showInactive ? " active" : ""}`}
              title="Reviewed applications that were rejected, or whose assignment was removed"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? "Hide" : "Show"} inactive ({inactiveCount})
            </button>
          )}
          <span className="lp-count">
            {loading && !data ? "…" : `${filtered.length} of ${visible.length}`}
          </span>
        </div>

        {showFilters && (
          <>
            <div className="lp-filter-section">
              <span className="lp-filter-label">STATUS</span>
              <div className="lp-filter-btns">
                <button className={`lp-filter-btn${statusFilter === "all" ? " active" : ""}`} onClick={() => setStatusFilter("all")}>
                  All
                </button>
                {["submitted", "draft", "not-started"].map((st) => (
                  <button
                    key={st}
                    className={`lp-filter-btn${statusFilter === st ? " active" : ""}`}
                    onClick={() => setStatusFilter(st)}
                  >
                    <span
                      className="sdot"
                      style={{ background: statusFilter === st ? "rgba(255,255,255,0.8)" : STATUS_DOTS[st] }}
                    />
                    {STATUS_LABELS[st]}
                    <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>{statusCounts[st] || 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-filter-section">
              <span className="lp-filter-label">STAGE</span>
              <div className="lp-filter-btns">
                <button className={`lp-filter-btn${stageFilter === "all" ? " active" : ""}`} onClick={() => setStageFilter("all")}>
                  All
                </button>
                {stageRows.map(([st, count]) => (
                  <button
                    key={st}
                    className={`lp-filter-btn${stageFilter === st ? " active" : ""}`}
                    onClick={() => setStageFilter(st)}
                  >
                    {st}
                    <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-filter-section">
              <span className="lp-filter-label">INDUSTRY</span>
              <div className="lp-filter-btns">
                <button className={`lp-filter-btn${domainFilter === "all" ? " active" : ""}`} onClick={() => setDomainFilter("all")}>
                  All
                </button>
                {industryRows.map(([d, count]) => (
                  <button
                    key={d}
                    className={`lp-filter-btn${domainFilter === d ? " active" : ""}`}
                    onClick={() => setDomainFilter(d)}
                  >
                    {d}
                    <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-filter-section">
              <span className="lp-filter-label">MY RECO</span>
              <div className="lp-filter-btns">
                <button className={`lp-filter-btn${recoFilter === "all" ? " active" : ""}`} onClick={() => setRecoFilter("all")}>
                  All
                </button>
                {["yes", "maybe", "no"].map((v) => (
                  <button
                    key={v}
                    className={`lp-filter-btn${recoFilter === v ? " active" : ""}`}
                    onClick={() => setRecoFilter(v)}
                  >
                    {RECO_LABEL[v].charAt(0) + RECO_LABEL[v].slice(1).toLowerCase()}
                    <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>{recoCounts[v] || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="lp-content" style={{ paddingBottom: 80 }}>
        <table className="os-table">
          <thead>
            <tr>
              {renderHeader("Project", "name", false, { width: "20%" })}
              {renderHeader("Founder", "founder", false, { width: "14%" })}
              {renderHeader("Industry", "industry", false, { width: "16%" })}
              {renderHeader("Stage", "stage", false, { width: "9%" })}
              {renderHeader("AI Score", "ai", true, { width: "11%" })}
              {renderHeader("My Score", "myScore", true, { width: "10%" })}
              {renderHeader("My Reco", "myReco", false, { width: "8%" })}
              {renderHeader("Status", "status", false, { width: "10%" })}
              {renderHeader("ID", "id", false, { width: "5%" })}
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.map((s) => (
              <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => onOpen(s.track, s.id)}>
                <td>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13, lineHeight: 1.3 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3, fontFamily: "var(--font-code)" }}>
                    {relabelDisplayId(s.applicationId)} · {s.track === "tir" ? "TIR" : "VIP"}
                    {s.movedToTrack && (
                      <span title={`Moved to ${trackLabel(s.movedToTrack)}`}
                        style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                          background: '#fff4d6', border: '1px solid #e6c34d', color: '#8a6d00',
                          borderRadius: 999, padding: '1px 6px' }}>
                        → {trackLabel(s.movedToTrack).toUpperCase()}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
                    {(s.founders && s.founders[0]) || "—"}
                  </div>
                  {s.founders && s.founders[1] && (
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{s.founders[1]}</div>
                  )}
                </td>
                <td style={{ color: "var(--ink-soft)", fontSize: 13 }}>{s.industry}</td>
                <td style={{ color: "var(--ink-soft)", fontSize: 13 }}>{s.stage}</td>
                <td>
                  {s.ai && s.ai.overall != null ? (
                    // Inline styles only — avoids the global (unscoped) .lp-score-bar
                    // rule in leadership.css that leaks app-wide and clips this cell.
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-block", width: 48, height: 4, background: "#ececf0", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                        <span style={{ display: "block", width: Math.max(0, Math.min(100, (s.ai.overall / 10) * 100)) + "%", height: "100%", background: "#2f6f62", borderRadius: 2 }} />
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--ink)", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {Number(s.ai.overall).toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--ink-dim)" }}>—</span>
                  )}
                </td>
                <td>
                  {typeof s.myScore === "number" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-block", width: 48, height: 4, background: "#ececf0", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                        <span style={{ display: "block", width: Math.max(0, Math.min(100, (s.myScore / 10) * 100)) + "%", height: "100%", background: "#3213b7", borderRadius: 2 }} />
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--ink)", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {Number(s.myScore).toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--ink-dim)" }}>—</span>
                  )}
                </td>
                <td><RecoBadge value={s.myReco} /></td>
                <td>
                  {s.reviewStatus === "submitted" && <Chip tone="green">Submitted</Chip>}
                  {s.reviewStatus === "draft" && <Chip tone="amber">Draft</Chip>}
                  {s.reviewStatus === "not-started" && <Chip tone="slate">Not started</Chip>}
                  {s.closed && <Chip tone="red">Closed</Chip>}
                  {s.detached && !s.closed && (
                    <span title="An admin removed this assignment; your submitted review is kept">
                      <Chip tone="slate">Unassigned</Chip>
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-dim)" }}>{displayIdText(s.applicationId, s.movedToTrack)}</td>
              </tr>
            ))}
            {loading && !data && (
              <tr>
                <td colSpan="9" style={{ padding: "40px 0" }}>
                  <LoadingState label="Loading your queue…" />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan="9" style={{ padding: "40px 0" }}>
                  <ErrorState error={error} onRetry={reload} />
                </td>
              </tr>
            )}
            {!(loading && !data) && !error && filtered.length === 0 && (
              <tr>
                <td colSpan="9" style={{ textAlign: "center", padding: "48px 0", color: "var(--ink-dim)", fontSize: 13 }}>
                  {allQueue.length === 0 ? "No applications assigned." : "No startups match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
