import { fmtINR } from "../ui.jsx";

export function priceLabel(product) {
  return product.pricing === "quote" ? "On request" : fmtINR(product.price);
}

// Fixed-price items go on the shortlist; quote-priced items reveal the
// vendor contact instead, because ARTPARK does not transact on the founder's
// behalf — the catalog is a curated directory.
export function primaryLabel(product) {
  return product.pricing === "quote" ? "Show contact" : "Add to shortlist";
}

export default function ProductCard({ product, onOpen, onPrimary, busy = false }) {
  const { rating = { avg: 0, count: 0 } } = product;
  return (
    <div className="pcard" onClick={() => onOpen(product)}>
      <div className="tags">
        <div className="cat">
          <span className={`ptag ${product.type === "Software" ? "sw" : "hw"}`}>{product.type}</span>
          <span className="ptag sub">{product.category?.label}</span>
        </div>
        <span className="pv">{product.vendor?.name}</span>
      </div>
      <div className="pn">{product.name}</div>
      <div className="pb">{product.blurb}</div>
      {/* No approved reviews means no rating line at all — never "★ 0.0". */}
      {rating.count > 0 && (
        <div className="rate">
          ★ {rating.avg.toFixed(1)} · {rating.count} review{rating.count === 1 ? "" : "s"}
        </div>
      )}
      <div className="foot">
        <span className="price">{priceLabel(product)}</span>
        <button
          type="button"
          className={product.pricing === "quote" ? "mini ghost" : "mini"}
          disabled={busy}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPrimary(product); }}
        >
          {primaryLabel(product)}
        </button>
      </div>
    </div>
  );
}
