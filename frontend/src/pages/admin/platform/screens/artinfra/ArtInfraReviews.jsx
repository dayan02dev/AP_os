import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS = [["pending", "Pending"], ["approved", "Approved"], ["hidden", "Hidden"], ["", "All"]];

export default function ArtInfraReviews({ store, onChange }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listReviews({ status })
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load reviews."))
    .finally(() => setLoading(false)), [store, status]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, next) => {
    if (next === "deleted") await store.deleteReview(id);
    else await store.moderateReview(id, next);
    await load();
    onChange?.();
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q
    || r.product_name.toLowerCase().includes(q)
    || r.author_name.toLowerCase().includes(q)
    || r.author_venture.toLowerCase().includes(q));

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Review moderation"
        sub="Founder reviews stay invisible to other founders until approved." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search reviews"
        searchPlaceholder="Product, founder or venture…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS }]}
        count={visible.length} total={rows.length}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading reviews…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Product</th><th>Founder</th><th>Rating</th><th>Review</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name}</td>
                <td>{r.author_name}<div className="os-sub">{r.author_venture}</div></td>
                <td>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</td>
                <td className="ai-review-body">{r.body}</td>
                <td><span className={`ai-status ai-status-${r.status}`}>{r.status}</span></td>
                <td className="ai-row-actions">
                  {r.status !== "approved" && (
                    <button type="button" className="os-btn ghost"
                      onClick={() => act(r.id, "approved")}>Approve</button>
                  )}
                  {r.status !== "hidden" && (
                    <button type="button" className="os-btn ghost"
                      onClick={() => act(r.id, "hidden")}>Hide</button>
                  )}
                  <button type="button" className="os-btn ghost"
                    onClick={() => act(r.id, "deleted")}>Delete</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && !error && (
              <tr><td colSpan={6} className="tbl-empty">Nothing in this queue.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
