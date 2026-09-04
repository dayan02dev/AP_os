import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";
import ListToolbar from "../admin/platform/screens/ListToolbar";

const STATUS_SEGMENTS = [
  ["", "All"], ["draft", "Draft"], ["pending_review", "In review"],
  ["published", "Published"], ["retired", "Retired"],
];

const fmtPrice = (p) =>
  p.pricing === "quote" ? "On request"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR",
        maximumFractionDigits: 0 }).format(p.price || 0);

export default function VendorCatalog({ store, vendorId, goEditor }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Monotonic request id: only the newest response may commit state. Without
  // this a slow early keystroke overwrites a fast later one.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myId = ++reqIdRef.current;
    try {
      const { items, total: t } = await store.listVendorProducts(vendorId, { search, status });
      if (myId !== reqIdRef.current) return;   // stale — a newer request won
      setRows(items);
      setTotal(t);
      setError("");
    } catch {
      if (myId !== reqIdRef.current) return;
      setError("Could not load your catalog.");
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }, [store, vendorId, search, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, ...args) => {
    try { await fn(...args); setError(""); await load(); }
    catch { setError("That didn't go through. Please try again."); }
  };

  return (
    <div>
      <PageHead eyebrow="Vendor" title="My catalog"
        sub="Drafts are private. Submitted products go to ARTPARK for review before founders see them." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search products" searchPlaceholder="Search your products…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus,
          options: STATUS_SEGMENTS }]}
        count={rows.length} total={total}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading catalog…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Product</th><th>Category</th><th>Price</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <button type="button" className="ai-linkbtn" onClick={() => goEditor(p.id)}>
                    {p.name}
                  </button>
                  {p.review_note && <div className="os-sub">{p.review_note}</div>}
                </td>
                <td>{p.category_id}</td>
                <td>{fmtPrice(p)}</td>
                <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
                <td className="vp-row-actions">
                  {p.status === "draft" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Submit ${p.name} for review`}
                      onClick={() => act(store.submitProduct, vendorId, p.id)}>
                      Submit for review
                    </button>
                  )}
                  {p.status === "published" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Retire ${p.name}`}
                      onClick={() => act(store.retireProduct, vendorId, p.id)}>
                      Retire
                    </button>
                  )}
                  {p.status === "draft" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => act(store.deleteVendorProduct, vendorId, p.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="tbl-empty">No products match these filters.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
