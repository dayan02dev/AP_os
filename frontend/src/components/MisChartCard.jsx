import { useState } from "react";
import MisLineChart from "./MisLineChart.jsx";
import "../styles/mis-charts.css";

// The four chart contracts, hand-synced with
// backend/app/services/admin_vip_query.py's own MIS_GRAPH tuple (core
// domain invariant: change one, change the other).
export const GRAPH = [
  { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
  { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
  { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
  { key: "paying", title: "Paying customers", metricKey: "active_customers" },
];

// Presentational only — no founderApi/adminVipApi import, no fetching.
// `series` is one metric's already-filtered-to-submitted, oldest-first
// array; the caller (FounderMis.jsx / AdminVipMisCharts.jsx) owns G1/G2/G5/
// G6 (whether this card renders at all). This component only ever decides
// between G3 (single point — not empty, just render it) and G4 (every
// point present but every value null — this metric was never reported).
export default function MisChartCard({ chartKey, title, series }) {
  const [expanded, setExpanded] = useState(false);
  const points = series || [];
  const hasAnyValue = points.some((p) => p.value != null);

  return (
    <div className="mis-chart-card" data-chart-key={chartKey}>
      <h4 className="mis-chart-title">{title}</h4>
      {points.length === 0 || !hasAnyValue ? (
        // G4 (points exist, none have a value) and the defensive
        // points.length === 0 case (the caller should have gated this via
        // G2 before reaching here) share one message — a metric this page
        // has no real data for reads identically either way.
        <p className="mis-chart-empty">{title} has not been reported in any submitted period yet.</p>
      ) : (
        <button
          type="button"
          className="mis-chart-canvas-btn"
          aria-label={`Expand ${title}`}
          onClick={() => setExpanded(true)}
        >
          <MisLineChart series={points} chartKey={chartKey} />
        </button>
      )}

      {expanded && (
        <div className="mis-chart-modal-backdrop" onClick={() => setExpanded(false)}>
          <div
            className="mis-chart-modal" role="dialog" aria-modal="true"
            aria-label={`${title}, enlarged`} onClick={(e) => e.stopPropagation()}
          >
            <div className="mis-chart-modal-head">
              <h2>{title}</h2>
              <button type="button" className="mis-chart-modal-close" aria-label="Close" onClick={() => setExpanded(false)}>×</button>
            </div>
            <div className="mis-chart-modal-body">
              <MisLineChart series={points} chartKey={chartKey} enlarged />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
