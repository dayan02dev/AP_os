import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS_SEGMENTS = [
  ["", "All"], ["draft", "Draft"], ["pending_review", "In review"],
  ["published", "Published"], ["retired", "Retired"],
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
  const [type, setType] = useState("");
  const [vendor, setVendor] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingBack, setSendingBack] = useState(null);
  const [sendBackNote, setSendBackNote] = useState("");
  const [sendBackError, setSendBackError] = useState("");

  // Monotonic request id: only the newest response may commit state. Without
  // this a slow early keystroke (or filter change) can land after and
  // overwrite a fast later one.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myId = ++reqIdRef.current;
    try {
      const [{ items }, all] = await Promise.all([
        store.adminListProducts({ search, status, category, type, vendor }),
        store.adminListProducts({}),
      ]);
      if (myId !== reqIdRef.current) return; // stale — a newer request won
      setRows(items);
      setTotal(all.total);
      setError("");
    } catch (e) {
      if (myId !== reqIdRef.current) return;
      setError("Could not load the catalog.");
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }, [store, search, status, category, type, vendor]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try { setVendors(await store.adminListVendors()); }
      catch { setVendors([]); }
    })();
    (async () => {
      try { setCategories(await store.listCategories()); }
      catch { setCategories([]); }
    })();
  }, [store]);

  const publish = async (id) => {
    setError("");
    try { await store.publishProduct(id); load(); }
    catch (e) {
      setError(e.message === "not_in_review"
        ? "That product is not awaiting review."
        : e.message === "vendor_not_approved"
          ? "That product's vendor is not approved yet."
          : e.message);
    }
  };

  const retire = async (id) => {
    setError("");
    try { await store.sendBackProduct(id, "Retired by admin"); load(); }
    catch (e) { setError(e.message); }
  };

  const openSendBack = (p) => { setSendingBack(p); setSendBackNote(""); setSendBackError(""); };
  const closeSendBack = () => { setSendingBack(null); setSendBackNote(""); setSendBackError(""); };

  const confirmSendBack = async () => {
    setSendBackError("");
    try {
      await store.sendBackProduct(sendingBack.id, sendBackNote);
      closeSendBack();
      load();
    } catch (e) {
      setSendBackError(e.message === "note_required"
        ? "A note is required."
        : e.message);
    }
  };

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
          <>
            <select className="os-input" aria-label="Category"
              value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <select className="os-input" aria-label="Type"
              value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="Hardware">Hardware</option>
              <option value="Software">Software</option>
            </select>
            <select className="os-input" aria-label="Vendor"
              value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.display_name || v.name}</option>)}
            </select>
          </>
        }
        count={rows.length}
        total={total}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading catalog…</div>
      ) : (
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
                <td>{p.vendor?.display_name || p.vendor?.name}</td>
                <td>{p.category?.label}</td>
                <td>{p.type}</td>
                <td>{fmtPrice(p)}</td>
                <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
                <td>
                  {p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)} (${p.rating.count})` : "—"}
                  {p.pending_reviews > 0 && <span className="ai-badge">{p.pending_reviews}</span>}
                </td>
                <td className="ai-row-actions">
                  {p.status === "pending_review" && (
                    <>
                      <button type="button" className="os-btn ghost"
                        onClick={() => publish(p.id)}>Publish</button>
                      <button type="button" className="os-btn ghost"
                        onClick={() => openSendBack(p)}>Send back</button>
                    </>
                  )}
                  {p.status === "published" && (
                    <button type="button" className="os-btn ghost"
                      onClick={() => retire(p.id)}>Retire</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={8} className="tbl-empty">No products match these filters.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {sendingBack && (
        <div className="modal-bg" onClick={closeSendBack}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Send back: {sendingBack.name}</h2></div>
            <div className="ai-form">
              <label>What needs fixing?
                <textarea className="os-input" value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)} />
              </label>
            </div>
            {sendBackError && <div className="inline-error">{sendBackError}</div>}
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={closeSendBack}>Cancel</button>
              <button type="button" className="os-btn" disabled={!sendBackNote.trim()}
                onClick={confirmSendBack}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
