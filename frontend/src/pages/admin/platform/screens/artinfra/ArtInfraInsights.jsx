import { useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraInsights({ store }) {
  const [data, setData] = useState(null);
  useEffect(() => { store.insights().then(setData); }, [store]);
  if (!data) return <div className="adm-async adm-async-empty">Loading…</div>;

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Insights"
        sub="What founders are actually shortlisting — use it to decide what to stock and what to retire." />

      <div className="ai-stats">
        <div className="ai-stat">
          <div className="ai-stat-num" data-testid="never-shortlisted-count">
            {data.neverShortlisted.length}
          </div>
          <div className="ai-stat-label">Never shortlisted</div>
        </div>
        <div className="ai-stat">
          <div className="ai-stat-num">{data.topShortlisted.length}</div>
          <div className="ai-stat-label">Shortlisted at least once</div>
        </div>
      </div>

      <div className="section-lbl">Most shortlisted</div>
      <table className="os-table" data-testid="top-shortlisted">
        <thead><tr><th>Product</th><th>Vendor</th><th>Founders</th><th>Rating</th></tr></thead>
        <tbody>
          {data.topShortlisted.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.vendor}</td><td>{p.shortlisted_by}</td>
              <td>{p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)}` : "—"}</td>
            </tr>
          ))}
          {data.topShortlisted.length === 0 && (
            <tr><td colSpan={4} className="tbl-empty">Nothing shortlisted yet.</td></tr>
          )}
        </tbody>
      </table>

      <div className="section-lbl">Never shortlisted</div>
      <table className="os-table">
        <thead><tr><th>Product</th><th>Vendor</th><th>Status</th></tr></thead>
        <tbody>
          {data.neverShortlisted.map((p) => (
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
