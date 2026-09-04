import { fmtINR } from "../ui.jsx";

function priceLabel(product) {
  return product.pricing === "quote" ? "On request" : fmtINR(product.price);
}

// Fixed-price items go on the shortlist. Quote-priced items need an ARTPARK-
// approved request before their vendor's contact is disclosed -- the payload
// does not even carry it until then.
export function primaryLabel(product) {
  if (product.pricing !== "quote") return "Add to shortlist";
  switch (product.contact_state) {
    case "pending": return "Requested — awaiting approval";
    case "approved": return "Contact available";
    case "declined": return "Request declined";
    default: return "Request contact";
  }
}

export function primaryDisabled(product) {
  return product.pricing === "quote" && product.contact_state === "pending";
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
          disabled={busy || primaryDisabled(product)}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPrimary(product); }}
        >
          {primaryLabel(product)}
        </button>
      </div>
    </div>
  );
}
