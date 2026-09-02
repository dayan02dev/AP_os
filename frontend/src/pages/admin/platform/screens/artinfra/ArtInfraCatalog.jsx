import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS_SEGMENTS = [
  ["", "All"], ["published", "Published"], ["draft", "Draft"], ["retired", "Retired"],
];

const fmtPrice = (p) =>
  p.pricing === "quote" ? "On request"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR",
        maximumFractionDigits: 0 }).format(p.price || 0);

export default function ArtInfraCatalog({ store, goEditor }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    const [{ items }, all] = await Promise.all([
      store.listProducts({ search, status, category }),
      store.listProducts({}),
    ]);
    setRows(items);
    setTotal(all.total);
  }, [store, search, status, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    store.listVendors().then(setVendors);
    store.listCategories().then(setCategories);
  }, [store]);

  const vendorName = useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);

  const setStatusFor = async (id, next) => { await store.setProductStatus(id, next); load(); };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Catalog"
        sub="Products founders see in the Art Infra tab. Draft items are invisible to them." />

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchLabel="Search products"
        searchPlaceholder="Search by product or vendor…"
        segments={[{
          ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS_SEGMENTS,
        }]}
        trailing={
          <select className="os-input" aria-label="Category"
            value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        }
        count={rows.length}
        total={total}
      />

      <table className="os-table">
        <thead>
          <tr>
            <th>Product</th><th>Vendor</th><th>Category</th><th>Type</th>
            <th>Price</th><th>Status</th><th>Reviews</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <button type="button" className="ai-linkbtn" onClick={() => goEditor(p.id)}>
                  {p.name}
                </button>
              </td>
              <td>{vendorName[p.vendor_id] || p.vendor?.name}</td>
              <td>{p.category?.label}</td>
              <td>{p.type}</td>
              <td>{fmtPrice(p)}</td>
              <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
              <td>
                {p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)} (${p.rating.count})` : "—"}
                {p.pending_reviews > 0 && <span className="ai-badge">{p.pending_reviews}</span>}
              </td>
              <td className="ai-row-actions">
                {p.status !== "published" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => setStatusFor(p.id, "published")}>Publish</button>
                )}
                {p.status === "published" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => setStatusFor(p.id, "retired")}>Retire</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="tbl-empty">No products match these filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
