// The preview pane mounts the REAL founder components against the in-progress
// draft, so an admin sees exactly what a founder will see. That is the whole
// point: nobody edits a catalog blind.

import { useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ProductCard from "../../../../founder/components/ProductCard.jsx";
import ProductModal from "../../../../founder/components/ProductModal.jsx";

const EMPTY = {
  id: null, name: "", blurb: "", description: "",
  vendor_id: "", category_id: "", type: "Hardware", pricing: "fixed",
  price: null, lead_time_weeks_min: null, lead_time_weeks_max: null,
  specs: [], status: "draft", visible_tracks: ["tir"],
};

export default function ArtInfraProductEditor({ store, productId, onDone }) {
  const [form, setForm] = useState(productId ? null : { ...EMPTY });
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    store.listVendors().then(setVendors);
    store.listCategories().then(setCategories);
  }, [store]);

  useEffect(() => {
    if (!productId) { setForm({ ...EMPTY }); return; }
    store.getProduct(productId).then((p) => setForm(p ? { ...p } : { ...EMPTY }));
  }, [store, productId]);

  if (!form) return <div className="adm-async adm-async-empty">Loading…</div>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setSpec = (i, k, v) => setForm((f) => {
    const specs = f.specs.map((s, idx) => (idx === i ? { ...s, [k]: v } : s));
    return { ...f, specs };
  });

  // What the founder components will receive. Vendor and category are resolved
  // here because the form holds ids, but the founder view holds objects.
  const preview = {
    ...form,
    vendor: vendors.find((v) => v.id === form.vendor_id) || { name: "(no vendor)" },
    category: categories.find((c) => c.id === form.category_id) || { label: "(no category)" },
    datasheets: [], reviews: [],
    rating: form.rating || { avg: 0, count: 0 },
    can_review: false, my_review: null, in_shortlist_qty: 0,
  };

  const save = async () => {
    setSaving(true);
    try { await store.saveProduct(form); onDone(); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageHead
        eyebrow="Art Infra"
        title={productId ? "Edit product" : "New product"}
        breadcrumb={[{ label: "Catalog", onClick: onDone }, { label: form.name || "New product" }]}
        actions={
          <>
            <button type="button" className="os-btn ghost" onClick={onDone}>Cancel</button>
            <button type="button" className="os-btn" disabled={!form.name.trim() || saving}
              onClick={save}>Save</button>
          </>
        }
      />

      <div className="ai-editor">
        <div className="ai-editor-form">
          <label>Name
            <input className="os-input" value={form.name}
              onChange={(e) => set("name", e.target.value)} />
          </label>

          <label>Vendor
            <select className="os-input" value={form.vendor_id}
              onChange={(e) => set("vendor_id", e.target.value)}>
              <option value="">Select a vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>

          <label>Category
            <select className="os-input" value={form.category_id}
              onChange={(e) => set("category_id", e.target.value)}>
              <option value="">Select a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>

          <label>Type
            <select className="os-input" value={form.type}
              onChange={(e) => set("type", e.target.value)}>
              <option>Hardware</option><option>Software</option>
            </select>
          </label>

          <label>Pricing
            <select className="os-input" value={form.pricing}
              onChange={(e) => setForm((f) => ({
                ...f,
                pricing: e.target.value,
                // A quote-priced product has no price. Clearing it here is what
                // keeps the form honest with the schema's "null when
                // pricing='quote'" rule — hiding the field alone would leave a
                // stale number in the payload.
                price: e.target.value === "quote" ? null : f.price,
              }))}>
              <option value="fixed">Fixed price</option>
              <option value="quote">On request</option>
            </select>
          </label>

          {/* A quote-priced product has no price, so the field is not merely
              disabled — it is absent, and the value is cleared. */}
          {form.pricing === "fixed" && (
            <label>Price (₹)
              <input className="os-input" type="number" value={form.price ?? ""}
                onChange={(e) => set("price", e.target.value === "" ? null : Number(e.target.value))} />
            </label>
          )}

          <label>Blurb (card line)
            <input className="os-input" value={form.blurb}
              onChange={(e) => set("blurb", e.target.value)} />
          </label>

          <label>Description (modal)
            <textarea className="os-input" rows={5} value={form.description}
              onChange={(e) => set("description", e.target.value)} />
          </label>

          <div className="ai-leadtime">
            <label>Lead time min (weeks)
              <input className="os-input" type="number" value={form.lead_time_weeks_min ?? ""}
                onChange={(e) => set("lead_time_weeks_min",
                  e.target.value === "" ? null : Number(e.target.value))} />
            </label>
            <label>Lead time max (weeks)
              <input className="os-input" type="number" value={form.lead_time_weeks_max ?? ""}
                onChange={(e) => set("lead_time_weeks_max",
                  e.target.value === "" ? null : Number(e.target.value))} />
            </label>
          </div>

          <div className="section-lbl">Specifications</div>
          {form.specs.map((s, i) => (
            <div className="ai-spec-row" key={i}>
              <input className="os-input" aria-label={`Spec key ${i + 1}`} value={s.k}
                onChange={(e) => setSpec(i, "k", e.target.value)} />
              <input className="os-input" aria-label={`Spec value ${i + 1}`} value={s.v}
                onChange={(e) => setSpec(i, "v", e.target.value)} />
              <button type="button" className="os-btn ghost"
                onClick={() => set("specs", form.specs.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="os-btn ghost"
            onClick={() => set("specs", [...form.specs, { k: "", v: "" }])}>
            + Add spec
          </button>
        </div>

        <aside className="ai-editor-preview" data-testid="founder-preview">
          <div className="section-lbl">Preview as founder</div>
          <div className="founder-portal">
            <div className="pgrid">
              <ProductCard product={preview} onOpen={() => setShowModal(true)}
                onPrimary={() => setShowModal(true)} />
            </div>
          </div>
          <button type="button" className="os-btn ghost" onClick={() => setShowModal(true)}>
            Open the detail view
          </button>
        </aside>
      </div>

      {showModal && (
        <div className="founder-portal">
          <ProductModal product={preview} onClose={() => setShowModal(false)}
            onPrimary={() => {}} onSubmitReview={async () => {}} />
        </div>
      )}
    </div>
  );
}
