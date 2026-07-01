// Reviewer queue — ported from REVIEWER-UI/os/reviewer.jsx ReviewerQueue.
// Filters/search operate on reviewerApi.getQueue() rows. Row click navigates
// to /reviewer/eval/:track/:appId via onOpen(track, appId).
//
// Server-shape adaptations vs the prototype:
//   * `industry` replaces `domain` (alias used throughout filters/search)
//   * `reviewStatus` is only not-started | draft | submitted (no in-progress)
//   * `due` is an ISO timestamp (or null) → rendered as a short date

import { useMemo, useState } from "react";
import { LoadingState, ErrorState, Chip } from "./ui.jsx";
import { relabelDisplayId } from "../../../lib/trackLabel.js";

// The queue is fetched once at the ReviewerPortal shell level and passed down
// via `queueAsync` ({ data, loading, error, reload }) so the queue table and
// the tab badge share a single getQueue request per page view.
export default function ReviewerQueue({ onOpen, initialDomain = "all", queueAsync }) {
  const [search, setSearch] = useState("");
  const [track, setTrack] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState(initialDomain);
  const [showFilters, setShowFilters] = useState(false);

  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  const { data, loading, error, reload } = queueAsync;
  const allQueue = data || [];

  const filtered = allQueue.filter((s) => {
    if (track !== "all" && s.track !== track) return false;
    if (search) {
      const q = search.toLowerCase();
      const foundersMatch = (s.founders || []).some((f) => (f || "").toLowerCase().includes(q));
      if (
        !(s.name || "").toLowerCase().includes(q) &&
        !foundersMatch &&
        !(s.industry || "").toLowerCase().includes(q)
      )
        return false;
    }
    if (statusFilter !== "all" && s.reviewStatus !== statusFilter) return false;
    if (stageFilter !== "all" && s.stage !== stageFilter) return false;
    if (domainFilter !== "all" && s.industry !== domainFilter) return false;
    return true;
  });

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

  const sortedFiltered = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let valA, valB;
      if (sortCol === "name") {
        valA = a.name || "";
        valB = b.name || "";
      } else if (sortCol === "founder") {
        valA = (a.founders && a.founders[0]) || "";
        valB = (b.founders && b.founders[0]) || "";
      } else if (sortCol === "industry") {
        valA = a.industry || "";
        valB = b.industry || "";
      } else if (sortCol === "stage") {
        valA = a.stage || "";
        valB = b.stage || "";
      } else if (sortCol === "ai") {
        valA = (a.ai && a.ai.overall != null) ? a.ai.overall : -1;
        valB = (b.ai && b.ai.overall != null) ? b.ai.overall : -1;
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      } else if (sortCol === "myScore") {
        valA = typeof a.myScore === "number" ? a.myScore : -1;
        valB = typeof b.myScore === "number" ? b.myScore : -1;
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      } else if (sortCol === "status") {
        valA = a.reviewStatus || "";
        valB = b.reviewStatus || "";
      } else if (sortCol === "id") {
        valA = a.applicationId || "";
        valB = b.applicationId || "";
      } else {
        return 0;
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortAsc]); // eslint-disable-line react-hooks/exhaustive-deps

  const STATUS_DOTS = {
    submitted: "var(--ok)",
    draft: "var(--warn)",
    "not-started": "var(--ink-dim)",
  };
  const STATUS_LABELS = { submitted: "Submitted", draft: "Draft", "not-started": "Not Started" };

  const countBy = (key) => {
    const m = {};
    allQueue.forEach((s) => {
      const v = s[key] || "—";
      m[v] = (m[v] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const industryRows = countBy("industry");
  const stageRows = countBy("stage");
  const statusCounts = allQueue.reduce((m, s) => {
    m[s.reviewStatus] = (m[s.reviewStatus] || 0) + 1;
    return m;
  }, {});

  const hasFilters =
    search || track !== "all" || statusFilter !== "all" || stageFilter !== "all" || domainFilter !== "all";
  const activeFilterCount =
    (track !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (stageFilter !== "all" ? 1 : 0) +
    (domainFilter !== "all" ? 1 : 0);
  const clearAll = () => {
    setSearch("");
    setTrack("all");
    setStatusFilter("all");
    setStageFilter("all");
    setDomainFilter("all");
  };

  return (
    <div>
      <div className="lp-filter-area">
        <div className="lp-filter-row--search">
          <div className="os-search-wrap" style={{ flexShrink: 0 }}>
            <input
              className="os-input search"
              placeholder="Search by name, founder, or industry"
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
          <span className="lp-count">
            {filtered.length} of {allQueue.length}
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
              {renderHeader("My Score", "myScore", true, { width: "11%" })}
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
                <td>
                  {s.reviewStatus === "submitted" && <Chip tone="green">Submitted</Chip>}
                  {s.reviewStatus === "draft" && <Chip tone="amber">Draft</Chip>}
                  {s.reviewStatus === "not-started" && <Chip tone="slate">Not started</Chip>}
                </td>
                <td style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-dim)" }}>{relabelDisplayId(s.applicationId)}</td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan="8" style={{ padding: "40px 0" }}>
                  <LoadingState label="Loading your queue…" />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan="8" style={{ padding: "40px 0" }}>
                  <ErrorState error={error} onRetry={reload} />
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan="8" style={{ textAlign: "center", padding: "48px 0", color: "var(--ink-dim)", fontSize: 13 }}>
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
