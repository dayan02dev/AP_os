import { useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraInsights({ store }) {
  const [data, setData] = useState(null);
  useEffect(() => { store.insights().then(setData); }, [store]);
  if (!data) return <div className="adm-async adm-async-empty">Loading…</div>;

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Insights"
        sub="What founders are actually requesting — use it to decide what to stock and what to retire." />

      <div className="ai-stats">
        <div className="ai-stat">
          <div className="ai-stat-num" data-testid="never-requested-count">
            {data.neverRequested.length}
          </div>
          <div className="ai-stat-label">Never requested</div>
        </div>
        <div className="ai-stat">
          <div className="ai-stat-num">{data.topRequested.length}</div>
          <div className="ai-stat-label">Requested at least once</div>
        </div>
        <div className="ai-stat">
          <div className="ai-stat-num" data-testid="mean-approved-rating">
            {data.meanApprovedRating.count > 0
              ? `★ ${data.meanApprovedRating.avg.toFixed(1)}`
              : "—"}
          </div>
          <div className="ai-stat-label">Mean approved rating</div>
        </div>
      </div>

      <div className="section-lbl">Most requested</div>
      <table className="os-table" data-testid="top-requested">
        <thead><tr><th>Product</th><th>Vendor</th><th>Requests</th><th>Rating</th></tr></thead>
        <tbody>
          {data.topRequested.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.vendor}</td><td>{p.requested_by}</td>
              <td>{p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)}` : "—"}</td>
            </tr>
          ))}
          {data.topRequested.length === 0 && (
            <tr><td colSpan={4} className="tbl-empty">Nothing requested yet.</td></tr>
          )}
        </tbody>
      </table>

      <div className="section-lbl">Never requested</div>
      <table className="os-table">
        <thead><tr><th>Product</th><th>Vendor</th><th>Status</th></tr></thead>
        <tbody>
          {data.neverRequested.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.vendor}</td>
              <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
