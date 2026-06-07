import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApiV2 } from "../../lib/reviewerApiV2.js";
import { useAsync } from "./components/useAsync.js";
import { LoadingState, ErrorState, EmptyState } from "./components/atoms.jsx";
import QueueTable from "./components/QueueTable.jsx";
import { ReviewerCohortHeader, ReviewerTabBar, exportReviewerQueueCsv } from "./ReviewerV2AppShell.jsx";

// ── Dashboard screen ──────────────────────────────────────────────────────
function ReviewerDashboard({ onPickIndustry }) {
  const { data: queue, loading, error, reload } = useAsync(() => reviewerApiV2.getQueue(), []);
  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error)   return <ErrorState error={error} onRetry={reload} />;
  if (!queue || !queue.length) return <EmptyState label="No applications assigned." />;

  const n      = queue.length;
  const withAI = queue.filter((s) => s.ai && s.ai.overall != null);
  const avgAI  = withAI.length ? withAI.reduce((a, s) => a + s.ai.overall, 0) / withAI.length : 0;
  const tirN   = queue.filter((s) => s.track === "tir").length;
  const sipN   = queue.filter((s) => s.track === "sip").length;

  const cnt = { submitted: 0, "in-progress": 0, draft: 0, "not-started": 0 };
  queue.forEach((s) => { cnt[s.reviewStatus]++; });

  const STATUS_ROWS = [
    { key: "not-started", name: "NOT STARTED", sub: "awaiting your review" },
    { key: "draft",       name: "DRAFT",       sub: "saved · not submitted" },
    { key: "in-progress", name: "IN PROGRESS", sub: "scoring underway" },
    { key: "submitted",   name: "SUBMITTED",   sub: "evaluation sent" },
  ].map((r) => ({ ...r, count: cnt[r.key] }));
  const maxStatus = Math.max(...STATUS_ROWS.map((r) => r.count), 1);

  const BINS = ["0-1","1-2","2-3","3-4","4-5","5-6","6-7","7-8","8-9","9-10"];
  const binCounts = BINS.map((_, i) =>
    withAI.filter((s) => s.ai.overall >= i && s.ai.overall < i + 1).length,
  );
  const maxBin = Math.max(...binCounts, 1);

  const COMPS = [
    { label: "Problem",    key: "problem",  weight: 22 },
    { label: "Solution",   key: "solution", weight: 30 },
    { label: "Tech",       key: "tech",     weight: 22 },
    { label: "Founders",   key: "founders", weight: 14 },
    { label: "Commitment", key: "commit",   weight: 12 },
  ];
  const compAvgs = COMPS.map((c) => ({
    ...c,
    avg: withAI.length ? withAI.reduce((a, s) => a + (s.ai[c.key] || 0), 0) / withAI.length : 0,
  }));

  const sorted   = [...withAI].map((s) => s.ai.overall).sort((a, b) => a - b);
  const medianAI = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const domainMap = {};
  queue.forEach((s) => { domainMap[s.domain] = (domainMap[s.domain] || 0) + 1; });
  const domainRows = Object.entries(domainMap).sort((a, b) => b[1] - a[1]);
  const maxDomain  = domainRows.length ? domainRows[0][1] : 1;

  return (
    <div className="dash-scroll">
      {/* Stat tiles */}
      <div className="dash-stat-grid">
        <div className="dash-stat-tile">
          <div className="dash-stat-label">APPLICATIONS ASSIGNED</div>
          <div className="dash-stat-num">{n}</div>
          <div className="dash-stat-sub">in your queue</div>
          <div className="dash-track-bars">
            {[["TIR", tirN, "#3213b7"], ["VIP", sipN, "#ff5a5f"]].map(([label, count, color]) => (
              <div key={label} className="dash-track-row">
                <span className="dash-track-label">{label}</span>
                <div className="dash-track-bar-wrap">
                  <div className="dash-track-bar-fill" style={{ width: (count / n) * 100 + "%", background: color }} />
                </div>
                <span className="dash-track-count">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {[
          { label: "SUBMITTED",   num: cnt["submitted"],   sub: "evaluation sent" },
          { label: "IN PROGRESS", num: cnt["in-progress"] + cnt["draft"], sub: "draft + scoring" },
          { label: "NOT STARTED", num: cnt["not-started"], sub: "awaiting review" },
        ].map((t) => (
          <div key={t.label} className="dash-stat-tile">
            <div className="dash-stat-label">{t.label}</div>
            <div className="dash-stat-num">{t.num}</div>
            <div className="dash-stat-sub">{t.sub}</div>
          </div>
        ))}

        <div className="dash-stat-tile dash-tile-teal">
          <div className="dash-stat-label">AVERAGE AI SCORE</div>
          <div className="dash-stat-num">{avgAI.toFixed(1)}</div>
          <div className="dash-stat-sub">across {withAI.length} apps</div>
        </div>
      </div>

      {/* Queue pipeline */}
      <div className="dash-card">
        <div className="dash-section-tag">§ Queue pipeline</div>
        <div className="dash-card-title">Your queue, by status</div>
        <div className="dash-pipe">
          {STATUS_ROWS.map((r, i) => {
            const pct = Math.round((r.count / maxStatus) * 90);
            return (
              <div key={r.key}>
                <div className="dash-pipe-row">
                  <div className="dash-pipe-track">
                    <div className="dash-pipe-fill" style={{ width: pct + "%" }} />
                    <span className="dash-pipe-count">{r.count}</span>
                  </div>
                  <div className="dash-pipe-info">
                    <span className="dash-pipe-name">{r.name}</span>
                    <span className="dash-pipe-sub">{r.sub}</span>
                  </div>
                </div>
                {i < STATUS_ROWS.length - 1 && (
                  <div className="dash-pipe-arrow">
                    <span className="a-track">↓</span>
                    <span className="a-spacer" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* AI distribution + components */}
      <div className="dash-2col">
        <div className="dash-card">
          <div className="dash-section-tag">§ AI score distribution</div>
          <div className="dash-card-title">Across {withAI.length} applications</div>
          <div className="dash-histogram">
            {binCounts.map((c, i) => (
              <div key={i} className="dash-hist-col">
                <div className="dash-hist-bar-wrap">
                  <div className="dash-hist-bar" style={{ height: (c / maxBin) * 100 + "%" }} />
                </div>
                <div className="dash-hist-count">{c}</div>
                <div className="dash-hist-label">{BINS[i]}</div>
              </div>
            ))}
          </div>
          <div className="dash-hist-stats">
            MEAN {avgAI.toFixed(1)} · MEDIAN {medianAI.toFixed(1)} · N = {withAI.length}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-section-tag">§ AI score · components</div>
          <div className="dash-card-title">What the score is made of</div>
          <div className="dash-comp-desc">Five weighted signals scored 0–10.</div>
          <div className="dash-comp-list">
            {compAvgs.map((c) => (
              <div key={c.key} className="dash-comp-row">
                <div className="dash-comp-meta">
                  <span className="dash-comp-name">{c.label}</span>
                  <span className="dash-comp-weight">weight {c.weight}%</span>
                  <span className="dash-comp-val">
                    {c.avg.toFixed(1)}<span style={{ opacity: 0.4, fontSize: 10 }}>/10</span>
                  </span>
                </div>
                <div className="dash-comp-bar-wrap">
                  <div className="dash-comp-bar-fill" style={{ width: (c.avg / 10) * 100 + "%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Industry breakdown */}
      <div className="dash-card" style={{ marginBottom: 0 }}>
        <div className="dash-section-tag">§ Queue by industry</div>
        <div className="dash-card-title">Where your queue is concentrated</div>
        <div className="dash-comp-desc">Click an industry to jump into My Queue pre-filtered.</div>
        <div className="dash-ind-list">
          {domainRows.map(([domain, count]) => (
            <div
              key={domain}
              className="dash-ind-row dash-ind-row--clickable"
              onClick={() => onPickIndustry && onPickIndustry(domain)}
              title={"Filter My Queue by " + domain}
            >
              <div className="dash-ind-name">{domain}</div>
              <div className="dash-ind-bar-wrap">
                <div className="dash-ind-bar-fill" style={{ width: (count / maxDomain) * 100 + "%" }} />
              </div>
              <div className="dash-ind-count">{count}</div>
              <div className="dash-ind-pct">· {((count / n) * 100).toFixed(1)}%</div>
            </div>
          ))}
        </div>
        <div className="dash-ind-filter">
          <span className="lp-filter-label">FILTER</span>
          <div className="lp-filter-btns">
            <button className="lp-filter-btn active" onClick={() => onPickIndustry && onPickIndustry("all")}>All</button>
            {domainRows.map(([domain]) => (
              <button key={domain} className="lp-filter-btn" onClick={() => onPickIndustry && onPickIndustry(domain)}>
                {domain}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inbox page — hosts both Dashboard and Queue tabs ──────────────────────
export default function ReviewerV2InboxPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("queue");
  const [queueDomain, setQueueDomain] = useState("all");

  const { data: queue, loading, error, reload } = useAsync(() => reviewerApiV2.getQueue(), []);

  const handleTab = (t) => {
    if (t === "queue") setQueueDomain("all");
    setTab(t);
  };

  const goQueueFiltered = (industry) => {
    setQueueDomain(industry);
    setTab("queue");
  };

  // Navigate to the evaluation page for a queue item
  const openEval = (idx) => {
    navigate(`/reviewer-v2/eval/${idx}`);
  };

  return (
    <>
      <ReviewerCohortHeader onExportCsv={exportReviewerQueueCsv} />
      <ReviewerTabBar tab={tab} setTab={handleTab} />

      {tab === "dashboard" && (
        <ReviewerDashboard onPickIndustry={goQueueFiltered} />
      )}

      {tab === "queue" && (
        <QueueTable
          allQueue={queue || []}
          loading={loading}
          error={error}
          onRetry={reload}
          onSelect={openEval}
          initialDomain={queueDomain}
        />
      )}
    </>
  );
}
