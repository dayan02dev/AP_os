// Jury queue — "My Applications". Ported from the reviewer queue MINUS the
// Status and Due columns, PLUS a "Pick" column: a ☆ Pick / ★ Picked toggle
// wired to the shell's selection state. Row click opens the read-only detail
// via onOpen(track, appId). There is NO scoring here.

import { useState } from "react";
import { LoadingState, ErrorState } from "./ui.jsx";

const keyOf = (id, track) => id + ":" + track;

export default function JuryQueue({ onOpen, initialDomain = "all", queueAsync, picks, togglePick }) {
  const [search, setSearch] = useState("");
  const [track, setTrack] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState(initialDomain);

  const { data, loading, error, reload } = queueAsync;
  const allQueue = data || [];

  const pickedKeys = new Set((picks || []).map((p) => keyOf(p.application_id, p.application_track)));
  const isPicked = (s) => pickedKeys.has(keyOf(s.id, s.track));
  const atCap = pickedKeys.size >= 3;

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
    if (stageFilter !== "all" && s.stage !== stageFilter) return false;
    if (domainFilter !== "all" && s.industry !== domainFilter) return false;
    return true;
  });

  const countBy = (k) => {
    const m = {};
    allQueue.forEach((s) => {
      const v = s[k] || "—";
      m[v] = (m[v] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const industryRows = countBy("industry");
  const stageRows = countBy("stage");

  const hasFilters = search || track !== "all" || stageFilter !== "all" || domainFilter !== "all";
  const clearAll = () => {
    setSearch("");
    setTrack("all");
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
          {hasFilters && (
            <button className="lp-filter-btn lp-clear-btn" onClick={clearAll}>Clear filters</button>
          )}
          <span className="lp-count">
            {filtered.length} of {allQueue.length}
          </span>
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
      </div>

      <div className="lp-content" style={{ paddingBottom: 40 }}>
        <table className="os-table">
          <thead>
            <tr>
              <th style={{ width: "24%" }}>Project</th>
              <th style={{ width: "16%" }}>Founder</th>
              <th style={{ width: "18%" }}>Industry</th>
              <th style={{ width: "12%" }}>Stage</th>
              <th style={{ width: "12%" }}>AI Score</th>
              <th style={{ width: "18%" }}>Pick</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const picked = isPicked(s);
              const disabled = atCap && !picked;
              return (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => onOpen(s.track, s.id)}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13, lineHeight: 1.3 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3, fontFamily: "var(--font-code)" }}>
                      {s.applicationId} · {s.track === "tir" ? "TIR" : "VIP"}
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
                    <button
                      type="button"
                      className={"jry-pick-btn" + (picked ? " is-picked" : "")}
                      disabled={disabled}
                      title={disabled ? "You already have 3 picks" : picked ? "Remove pick" : "Pick to mentor"}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePick(s);
                      }}
                    >
                      {picked ? "★ Picked" : "☆ Pick"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr>
                <td colSpan="6" style={{ padding: "40px 0" }}>
                  <LoadingState label="Loading your applications…" />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan="6" style={{ padding: "40px 0" }}>
                  <ErrorState error={error} onRetry={reload} />
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: "center", padding: "48px 0", color: "var(--ink-dim)", fontSize: 13 }}>
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
