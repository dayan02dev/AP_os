import { useCallback, useEffect, useState } from "react";
import { artInfraMock } from "../../lib/artInfraMock.js";
import { fmtINR, Loading, ErrorState } from "./ui.jsx";
import ProductCard from "./components/ProductCard.jsx";
import ProductModal from "./components/ProductModal.jsx";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "hardware", label: "Hardware" },
  { key: "software", label: "Software" },
  { key: "quote", label: "Quote-based" },
];

function matchesFilter(product, filter) {
  if (filter === "all") return true;
  if (filter === "hardware") return product.type === "Hardware";
  if (filter === "software") return product.type === "Software";
  if (filter === "quote") return product.pricing === "quote";
  return true;
}

// `store` is injected so the admin product editor can mount this exact page
// against a draft-only store for preview-as-founder.
export default function FounderStore({ store = artInfraMock }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [listOpen, setListOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => store.founderStore().then(setData).catch(setError), [store]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading Art Infra…" />;

  const catalog = data.catalog.filter((c) => matchesFilter(c, filter));
  const count = data.shortlist.reduce((a, l) => a + l.qty, 0);
  const openProduct = openId ? data.catalog.find((c) => c.id === openId) : null;

  const addToShortlist = async (product) => {
    if (busy) return;
    setBusy(true);
    try { await store.addToShortlist(product.id, 1); await load(); }
    finally { setBusy(false); }
  };
  const setQty = async (productId, qty) => {
    await store.setShortlistQty(productId, qty); await load();
  };
  const push = async () => {
    if (busy || data.shortlist.length === 0) return;
    setBusy(true);
    try { await store.pushToProcurement(); setListOpen(false); await load(); }
    finally { setBusy(false); }
  };
  const submitReview = async (productId, payload) => {
    await store.submitReview(productId, payload); await load();
  };

  return (
    <div>
      <div className="head-row">
        <div>
          <span className="eyebrow eyebrow-rule">Founders resources</span>
          <h1 className="big">ARTPARK <span className="hl">Art Infra</span>.</h1>
          <p className="lead">
            Pre-negotiated hardware and software from vetted vendors. Buy directly from the
            vendor at ARTPARK pricing — open any item for its specs, datasheets and reviews
            from other founders.
          </p>
        </div>
        <div className="cart-wrap">
          <button type="button" className="cart-btn" onClick={() => setListOpen((v) => !v)}>
            <span className="cart-icon" aria-hidden="true" />
            <span>Shortlist</span>
            {count > 0 && <span className="cart-count" data-testid="shortlist-count">{count}</span>}
          </button>
          {listOpen && (
            <>
              <div className="cart-backdrop" onClick={() => setListOpen(false)} />
              <div className="cart-pop card">
                <div className="cart-pop-head">Shortlist · {count} items</div>
                <div className="cart-pop-body">
                  {data.shortlist.length === 0 ? (
                    <div className="cart-pop-empty">
                      Your shortlist is empty. Add parts and services from the catalog.
                    </div>
                  ) : data.shortlist.map((l) => (
                    /* Markup preserved verbatim from the shipped page — only the
                       word Cart changes. This is a UI-approval build, so the
                       popover must not regress visually. */
                    <div className="cart-pop-item" key={l.product_id}>
                      <div className="ci-info">
                        <div className="ci-name">{l.product?.name}</div>
                        <div className="ci-price">{fmtINR(l.product?.price)} each</div>
                      </div>
                      <div className="qty-step">
                        <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)}
                          aria-label={`Decrease ${l.product?.name} quantity`}>−</button>
                        <span>{l.qty}</span>
                        <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)}
                          aria-label={`Increase ${l.product?.name} quantity`}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cart-pop-foot">
                  <div className="cart-pop-sub">
                    <span>Subtotal</span><span className="v">{fmtINR(data.shortlist_subtotal)}</span>
                  </div>
                  <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }}
                    disabled={data.shortlist.length === 0 || busy} onClick={push}>
                    Push to procurement <span className="arrow">→</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="filters mt20">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={filter === f.key ? "on" : ""}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div className="pgrid mt16">
        {catalog.map((c) => (
          <ProductCard key={c.id} product={c} busy={busy}
            onOpen={(p) => setOpenId(p.id)} onPrimary={addToShortlist} />
        ))}
      </div>

      {openProduct && (
        <ProductModal product={openProduct} busy={busy}
          onClose={() => setOpenId(null)}
          onPrimary={addToShortlist}
          onSubmitReview={submitReview} />
      )}
    </div>
  );
}
