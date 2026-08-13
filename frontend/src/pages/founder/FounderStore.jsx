import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtINR, Loading, ErrorState } from "./ui.jsx";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "hardware", label: "Hardware" },
  { key: "software", label: "Software" },
  { key: "quote", label: "Quote-based" },
];

function avgRating(reviews) {
  if (!reviews || !reviews.length) return 0;
  return reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
}

function reviewCountLabel(reviews) {
  const n = (reviews || []).length;
  return `${n} review${n === 1 ? "" : "s"}`;
}

function priceLabel(product) {
  return product.pricing === "quote" ? "On request" : fmtINR(product.price);
}

// Add-to-cart (fixed price) vs request-quote (quote pricing), with the
// "requested" state flipping the quote CTA to a done/checked look.
function ctaFor(product) {
  if (product.pricing === "quote") {
    return product.quote_requested
      ? { label: "Quote requested ✓", cls: "mini done" }
      : { label: "Request quote", cls: "mini ghost" };
  }
  return { label: "Add to cart", cls: "mini" };
}

function matchesFilter(product, filter) {
  if (filter === "all") return true;
  if (filter === "hardware") return product.type === "Hardware";
  if (filter === "software") return product.type === "Software";
  if (filter === "quote") return product.pricing === "quote";
  return true;
}

export default function FounderStore() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [cartOpen, setCartOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => founderApi.getStore().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading the store…" />;

  const catalog = data.catalog.filter((c) => matchesFilter(c, filter));
  const cartCount = data.cart.reduce((a, ci) => a + ci.qty, 0);
  const openProduct = openId ? data.catalog.find((c) => c.id === openId) : null;

  const runCta = async (product, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (product.pricing === "quote") await founderApi.requestQuote(product.id);
      else await founderApi.addToCart(product.id, 1);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setQty = async (productId, qty) => {
    await founderApi.setCartQty(productId, qty);
    await load();
  };

  const pushCart = async () => {
    if (busy || data.cart.length === 0) return;
    setBusy(true);
    try {
      await founderApi.pushCartToProcurement();
      setCartOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="head-row">
        <div>
          <span className="eyebrow eyebrow-rule">Founders resources</span>
          <h1 className="big">The ARTPARK <span className="hl">procurement store</span>.</h1>
          <p className="lead">
            Pre-negotiated hardware and software from vetted vendors — buy at a fixed price or
            request a quote. Open any item for its datasheets, specs, and reviews from other founders.
          </p>
        </div>
        <div className="cart-wrap">
          <button type="button" className="cart-btn" onClick={() => setCartOpen((v) => !v)}>
            <span className="cart-icon" aria-hidden="true" />
            <span>Cart</span>
            {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
          </button>
          {cartOpen && (
            <>
              <div className="cart-backdrop" onClick={() => setCartOpen(false)} />
              <div className="cart-pop card">
                <div className="cart-pop-head">Cart · {cartCount} items</div>
                <div className="cart-pop-body">
                  {data.cart.length === 0 ? (
                    <div className="cart-pop-empty">Your cart is empty. Add parts and services from the catalog.</div>
                  ) : (
                    data.cart.map((ci) => (
                      <div className="cart-pop-item" key={ci.product_id}>
                        <div className="ci-info">
                          <div className="ci-name">{ci.product?.name}</div>
                          <div className="ci-price">{fmtINR(ci.product?.price)} each</div>
                        </div>
                        <div className="qty-step">
                          <button type="button" onClick={() => setQty(ci.product_id, ci.qty - 1)} aria-label={`Decrease ${ci.product?.name} quantity`}>−</button>
                          <span>{ci.qty}</span>
                          <button type="button" onClick={() => setQty(ci.product_id, ci.qty + 1)} aria-label={`Increase ${ci.product?.name} quantity`}>+</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="cart-pop-foot">
                  <div className="cart-pop-sub"><span>Subtotal</span><span className="v">{fmtINR(data.cart_subtotal)}</span></div>
                  <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} disabled={data.cart.length === 0 || busy} onClick={pushCart}>
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
          <button key={f.key} type="button" className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="pgrid mt16">
        {catalog.map((c) => {
          const cta = ctaFor(c);
          return (
            <div className="pcard" key={c.id} onClick={() => setOpenId(c.id)}>
              <div className="tags">
                <div className="cat">
                  <span className={`ptag ${c.type === "Software" ? "sw" : "hw"}`}>{c.type}</span>
                  <span className="ptag sub">{c.cat}</span>
                </div>
                <span className="pv">{c.vendor}</span>
              </div>
              <div className="pn">{c.name}</div>
              <div className="pb">{c.blurb}</div>
              <div className="rate">★ {avgRating(c.reviews).toFixed(1)} · {reviewCountLabel(c.reviews)}</div>
              <div className="foot">
                <span className="price">{priceLabel(c)}</span>
                <button type="button" className={cta.cls} disabled={busy} onClick={(e) => runCta(c, e)}>{cta.label}</button>
              </div>
            </div>
          );
        })}
      </div>

      {openProduct && (
        <div className="modal-bg" onClick={() => setOpenId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead">
              <div>
                <div className="cat">
                  <span className={`ptag ${openProduct.type === "Software" ? "sw" : "hw"}`}>{openProduct.type}</span>
                  <span className="ptag sub">{openProduct.cat}</span>
                </div>
                <h2>{openProduct.name}</h2>
                <div className="muted">
                  by {openProduct.vendor} · ★ {avgRating(openProduct.reviews).toFixed(1)} ({reviewCountLabel(openProduct.reviews)})
                </div>
              </div>
              <button type="button" className="x" onClick={() => setOpenId(null)} aria-label="Close">×</button>
            </div>

            <div className="mbody">
              <div className="mcol-l">
                <div>
                  <div className="section-lbl">Overview</div>
                  <p>{openProduct.desc}</p>
                </div>
                <div>
                  <div className="section-lbl">Specifications</div>
                  {(openProduct.specs || []).map((s) => (
                    <div className="spec-row" key={s.k}>
                      <span className="k">{s.k}</span>
                      <span className="v">{s.v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="section-lbl">Founder reviews</div>
                  {(openProduct.reviews || []).map((r, i) => (
                    <div className="rev" key={`${r.name}-${i}`}>
                      <div className="rh">
                        <span>{r.name} <span className="muted">· {r.company}</span></span>
                        <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                      </div>
                      <p>{r.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mcol-r">
                <div>
                  <div className="section-lbl" style={{ marginBottom: 0 }}>{openProduct.pricing === "quote" ? "Pricing" : "Fixed price"}</div>
                  <div className="modal-price">{openProduct.pricing === "quote" ? "Price on request" : fmtINR(openProduct.price)}</div>
                </div>
                <button
                  type="button"
                  className={`${ctaFor(openProduct).cls} block`}
                  disabled={busy}
                  onClick={(e) => runCta(openProduct, e)}
                >
                  {ctaFor(openProduct).label}
                </button>
                <div>
                  <div className="section-lbl">Datasheets &amp; docs</div>
                  <div className="ds-list">
                    {(openProduct.datasheets || []).map((d) => (
                      <a href="#" className="ds-row" key={d.name} onClick={(e) => e.preventDefault()}>
                        <span className="kind">{d.kind}</span>
                        <span className="ds-name">{d.name}</span>
                        <span>↓</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
