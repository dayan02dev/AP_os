import { useState } from "react";
import { fmtINR } from "../ui.jsx";
import { primaryLabel } from "./ProductCard.jsx";

function Stars({ n }) {
  return <span className="stars">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

function ReviewForm({ product, onSubmitReview }) {
  const [rating, setRating] = useState(product.my_review?.rating || 5);
  const [body, setBody] = useState(product.my_review?.body || "");
  const [saving, setSaving] = useState(false);

  if (!product.can_review) {
    return (
      <p className="muted">
        Add this to your shortlist to leave a review.
      </p>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSubmitReview(product.id, { rating: Number(rating), body }); }
    finally { setSaving(false); }
  };
  return (
    <form className="rev-form" onSubmit={submit}>
      {product.my_review?.status === "pending" && (
        <div className="muted">Your review is awaiting moderation.</div>
      )}
      <label>
        Rating
        <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Rating">
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <textarea
        aria-label="Your review"
        placeholder="What worked, what didn't?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button type="submit" className="mini" disabled={saving || !body.trim()}>
        {product.my_review ? "Update review" : "Submit review"}
      </button>
    </form>
  );
}

export default function ProductModal({ product, onClose, onPrimary, onSubmitReview,
  busy = false, contactOpen = false }) {
  const [showContact, setShowContact] = useState(contactOpen);
  const { rating = { avg: 0, count: 0 }, datasheets = [], reviews = [] } = product;
  const leadTime = product.lead_time_weeks_min
    ? `${product.lead_time_weeks_min}–${product.lead_time_weeks_max} weeks`
    : null;

  const primary = () => {
    if (product.pricing === "quote") setShowContact(true);
    else onPrimary(product);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <div className="cat">
              <span className={`ptag ${product.type === "Software" ? "sw" : "hw"}`}>{product.type}</span>
              <span className="ptag sub">{product.category?.label}</span>
            </div>
            <h2>{product.name}</h2>
            <div className="muted">
              by {product.vendor?.name}
              {rating.count > 0 && <> · ★ {rating.avg.toFixed(1)} ({rating.count})</>}
            </div>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbody">
          <div className="mcol-l">
            <div>
              <div className="section-lbl">Overview</div>
              <p>{product.description}</p>
            </div>
            <div>
              <div className="section-lbl">Specifications</div>
              {(product.specs || []).map((s) => (
                <div className="spec-row" key={s.k}>
                  <span className="k">{s.k}</span><span className="v">{s.v}</span>
                </div>
              ))}
              {leadTime && (
                <div className="spec-row">
                  <span className="k">Lead time</span><span className="v">{leadTime}</span>
                </div>
              )}
            </div>
            <div>
              <div className="section-lbl">Founder reviews</div>
              {reviews.length === 0 && <p className="muted">No reviews yet.</p>}
              {reviews.map((r) => (
                <div className="rev" key={r.id}>
                  <div className="rh">
                    <span>{r.author_name} <span className="muted">· {r.author_venture}</span></span>
                    <Stars n={r.rating} />
                  </div>
                  <p>{r.body}</p>
                </div>
              ))}
              <ReviewForm product={product} onSubmitReview={onSubmitReview} />
            </div>
          </div>

          <div className="mcol-r">
            <div>
              <div className="section-lbl" style={{ marginBottom: 0 }}>
                {product.pricing === "quote" ? "Pricing" : "Fixed price"}
              </div>
              <div className="modal-price">
                {product.pricing === "quote" ? "Price on request" : fmtINR(product.price)}
              </div>
            </div>
            <button type="button" className={`${product.pricing === "quote" ? "mini ghost" : "mini"} block`}
              disabled={busy} onClick={primary}>
              {primaryLabel(product)}
            </button>

            {/* The directory model's payoff: the founder deals with the vendor
                directly, so the contact IS the deliverable. */}
            {showContact && (
              <div className="vendor-contact">
                <div className="section-lbl">Vendor contact</div>
                <div className="vc-row"><span className="k">Vendor</span><span className="v">{product.vendor?.name}</span></div>
                {product.vendor?.contact_name && <div className="vc-row"><span className="k">Contact</span><span className="v">{product.vendor.contact_name}</span></div>}
                {product.vendor?.contact_email && <div className="vc-row"><span className="k">Email</span><span className="v">{product.vendor.contact_email}</span></div>}
                {product.vendor?.contact_phone && <div className="vc-row"><span className="k">Phone</span><span className="v">{product.vendor.contact_phone}</span></div>}
                {product.vendor?.artpark_ref && <div className="vc-row"><span className="k">ARTPARK ref</span><span className="v">{product.vendor.artpark_ref}</span></div>}
                {!product.vendor?.contact_email && !product.vendor?.contact_phone && (
                  <p className="muted">No contact on file yet — ask the ARTPARK team.</p>
                )}
              </div>
            )}

            {/* Hidden entirely when empty, rather than listing names nothing
                can open — the pre-existing dead end this replaces. */}
            {datasheets.length > 0 && (
              <div>
                <div className="section-lbl">Datasheets &amp; docs</div>
                <div className="ds-list">
                  {datasheets.map((d) => (
                    <a href={d.external_url || "#"} className="ds-row" key={d.id}
                      target="_blank" rel="noopener noreferrer">
                      <span className="kind">{d.kind}</span>
                      <span className="ds-name">{d.name}</span>
                      <span>↓</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
