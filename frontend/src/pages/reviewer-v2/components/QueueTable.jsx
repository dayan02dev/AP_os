import { useState } from "react";
import { Chip, LoadingState, ErrorState } from "./atoms.jsx";

const STATUS_DOTS = {
  submitted:    "var(--ok)",
  "in-progress":"var(--info)",
  draft:        "var(--warn)",
  "not-started":"var(--ink-dim)",
};
const STATUS_LABELS = {
  submitted:    "Submitted",
  "in-progress":"In Progress",
  draft:        "Draft",
  "not-started":"Not Started",
};

export default function QueueTable({ allQueue, loading, error, onRetry, onSelect, initialDomain = "all" }) {
  const [search,       setSearch]       = useState("");
  const [track,        setTrack]        = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter,  setStageFilter]  = useState("all");
  const [domainFilter, setDomainFilter] = useState(initialDomain);

  const getStatus = (s) => s.reviewStatus;

  const filtered = (allQueue || []).filter((s) => {
    if (track !== "all" && s.track !== track) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !s.name.toLowerCase().includes(q) &&
        !(s.founders[0] || "").toLowerCase().includes(q) &&
        !(s.domain || "").toLowerCase().includes(q)
      )
        return false;
    }
    if (statusFilter !== "all" && getStatus(s) !== statusFilter) return false;
    if (stageFilter  !== "all" && s.stage !== stageFilter) return false;
    if (domainFilter !== "all" && s.domain !== domainFilter) return false;
    return true;
  });

  const countBy = (key) => {
    const m = {};
    (allQueue || []).forEach((s) => { m[s[key]] = (m[s[key]] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const industryRows = countBy("domain");
  const stageRows    = countBy("stage");
  const statusCounts = (allQueue || []).reduce((m, s) => {
    m[s.reviewStatus] = (m[s.reviewStatus] || 0) + 1;
    return m;
  }, {});

  const hasFilters =
    search || track !== "all" || statusFilter !== "all" || stageFilter !== "all" || domainFilter !== "all";
  const clearAll = () => {
    setSearch(""); setTrack("all"); setStatusFilter("all"); setStageFilter("all"); setDomainFilter("all");
  };

  return (
    <div>
      {/* Filter area */}
      <div className="lp-filter-area">
        {/* Search + track row */}
        <div className="lp-filter-row--search">
          <div className="os-search-wrap" style={{ flex: "0 1 360px" }}>
            <input
              className="os-input search"
              placeholder="Search by name, founder, or industry"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="lp-track-group">
            {[["all", "All tracks"], ["tir", "TIR"], ["sip", "VIP"]].map(([v, label]) => (
              <button
                key={v}
                className={`lp-track-btn${track === v ? " active" : ""}`}
                onClick={() => setTrack(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {hasFilters && (
            <button className="lp-filter-btn lp-clear-btn" onClick={clearAll}>
              Clear filters
            </button>
          )}
          <span className="lp-count">
            {filtered.length} of {(allQueue || []).length}
          </span>
        </div>

        {/* STATUS */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">STATUS</span>
          <div className="lp-filter-btns">
            <button
              className={`lp-filter-btn${statusFilter === "all" ? " active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All
            </button>
            {["submitted", "in-progress", "draft", "not-started"].map((st) => (
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
                <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 2 }}>
                  {statusCounts[st] || 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* STAGE */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">STAGE</span>
          <div className="lp-filter-btns">
            <button
              className={`lp-filter-btn${stageFilter === "all" ? " active" : ""}`}
              onClick={() => setStageFilter("all")}
            >
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

        {/* INDUSTRY */}
        <div className="lp-filter-section">
          <span className="lp-filter-label">INDUSTRY</span>
          <div className="lp-filter-btns">
            <button
              className={`lp-filter-btn${domainFilter === "all" ? " active" : ""}`}
              onClick={() => setDomainFilter("all")}
            >
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
      </div>

      {/* 8-column table */}
      <div className="lp-content" style={{ paddingBottom: 80 }}>
        <table className="os-table">
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Project</th>
              <th style={{ width: "16%" }}>Founder</th>
              <th style={{ width: "18%" }}>Industry</th>
              <th style={{ width: "10%" }}>Stage</th>
              <th style={{ width: "12%" }}>AI Score</th>
              <th style={{ width: "12%" }}>Status</th>
              <th style={{ width: "6%"  }}>Due</th>
              <th style={{ width: "9%"  }}>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect((allQueue || []).findIndex((q) => q.id === s.id))}
              >
                <td>
                  <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13, lineHeight: 1.3 }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3, fontFamily: "var(--font-code)" }}>
                    {s.applicationId} · {s.track === "tir" ? "TIR" : "VIP"}
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
                    {(s.founders || [])[0] || "—"}
                  </div>
                  {(s.founders || [])[1] && (
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>{s.founders[1]}</div>
                  )}
                </td>
                <td style={{ color: "var(--ink-soft)", fontSize: 13 }}>{s.domain}</td>
                <td style={{ color: "var(--ink-soft)", fontSize: 13 }}>{s.stage}</td>
                <td>
                  {s.ai && s.ai.overall != null ? (
                    <div className="lp-score-bar">
                      <div className="lp-score-bar-track">
                        <div
                          className="lp-score-bar-fill"
                          style={{ width: (s.ai.overall / 10) * 100 + "%" }}
                        />
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                        {s.ai.overall.toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--ink-dim)" }}>—</span>
                  )}
                </td>
                <td>
                  {s.reviewStatus === "submitted"    && <Chip tone="green">Submitted</Chip>}
                  {s.reviewStatus === "in-progress"  && <Chip tone="blue">In Progress</Chip>}
                  {s.reviewStatus === "draft"        && <Chip tone="amber">Draft</Chip>}
                  {s.reviewStatus === "not-started"  && <Chip tone="slate">Not started</Chip>}
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>
                  {s.due}
                </td>
                <td style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-dim)" }}>
                  {s.applicationId}
                </td>
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
                  <ErrorState error={error} onRetry={onRetry} />
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td
                  colSpan="8"
                  style={{ textAlign: "center", padding: "48px 0", color: "var(--ink-dim)", fontSize: 13 }}
                >
                  {(allQueue || []).length === 0
                    ? "No applications assigned."
                    : "No startups match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
