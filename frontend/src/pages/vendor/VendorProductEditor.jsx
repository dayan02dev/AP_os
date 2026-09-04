// Category first -- it decides the whole spec form. The preview pane mounts
// the REAL founder components so a vendor sees exactly what a founder will
// see, rather than a hand-rolled approximation that could drift from it.

import "../../styles/founder-portal.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";
import ProductCard from "../founder/components/ProductCard.jsx";
import ProductModal from "../founder/components/ProductModal.jsx";
import SpecFieldInput from "./components/SpecFieldInput.jsx";
import {
  describeFields, emptyValues, coerceValue, validateSpecs,
} from "../../lib/specFieldForm.js";

const BLANK = {
  name: "", blurb: "", description: "", category_id: "", type: "Hardware",
  pricing: "fixed", price: null,
  lead_time_weeks_min: null, lead_time_weeks_max: null, specs: {},
};

// Exactly the writable set the store accepts. Building the PATCH from this
// list -- rather than spreading the loaded product -- is what stops
// read-model-only fields (vendor_id, status, review_note, extra_specs) from
// ever reaching the write call and getting rejected as unwritable_fields.
const WRITABLE = ["name", "blurb", "description", "category_id", "type", "pricing",
  "price", "lead_time_weeks_min", "lead_time_weeks_max", "specs"];

export default function VendorProductEditor({ store, vendorId, productId, onDone }) {
  const [form, setForm] = useState(productId ? null : { ...BLANK });
  const [categories, setCategories] = useState([]);
  const [allFields, setAllFields] = useState([]);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let live = true;
    Promise.all([store.listCategories(), store.listSpecFields()])
      .then(([c, f]) => { if (live) { setCategories(c); setAllFields(f); } })
      .catch(() => { if (live) setBanner("Could not load categories."); });
    return () => { live = false; };
  }, [store]);

  const load = useCallback(async () => {
    if (!productId) { setForm({ ...BLANK }); return; }
    const myId = ++reqIdRef.current;
    try {
      const p = await store.getVendorProduct(vendorId, productId);
      if (myId !== reqIdRef.current) return;
      setForm(p ? { ...p, specs: p.specs || {} } : { ...BLANK });
    } catch {
      if (myId === reqIdRef.current) setBanner("Could not load this product.");
    }
  }, [store, vendorId, productId]);
  useEffect(() => { load(); }, [load]);

  if (!form) return <div className="vp-loading">{banner || "Loading…"}</div>;

  const fields = describeFields(allFields, form.category_id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setCategory = (categoryId) => {
    // Values from the previous category are not valid keys for the new one --
    // the API would reject them as unknown fields -- so the spec bag resets
    // rather than carrying orphans forward.
    const next = describeFields(allFields, categoryId);
    setErrors({});
    setForm((f) => ({ ...f, category_id: categoryId, specs: emptyValues(next) }));
  };

  const setSpec = (field, raw) =>
    setForm((f) => ({ ...f, specs: { ...f.specs, [field.key]: coerceValue(field, raw) } }));

  const preview = {
    ...form,
    id: form.id || "preview",
    vendor: { id: vendorId, name: "Your company" },
    category: categories.find((c) => c.id === form.category_id) || { label: "(no category)" },
    spec_fields: fields,
    datasheets: [], rating: { avg: 0, count: 0 },
    contact_state: "none", can_review: false, my_review: null, in_shortlist_qty: 0,
  };

  const save = async () => {
    if (!form.name.trim()) { setBanner("A product needs a name."); return; }
    const result = validateSpecs(fields, form.specs || {});
    setErrors(result.errors);
    if (!result.ok) {
      setBanner("Please fix the highlighted fields before saving.");
      return;
    }
    setBanner("");
    setBusy(true);
    try {
      const patch = {};
      for (const k of WRITABLE) if (form[k] !== undefined) patch[k] = form[k];
      if (productId) await store.updateVendorProduct(vendorId, productId, patch);
      else await store.createVendorProduct(vendorId, patch);
      onDone();
    } catch (e) {
      setBanner(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead
        eyebrow="Vendor"
        title={productId ? "Edit product" : "New product"}
        breadcrumb={[
          { label: "My catalog", onClick: onDone },
          { label: form.name || "New product" },
        ]}
        actions={
          <>
            <button type="button" className="os-btn ghost" onClick={onDone}>Cancel</button>
            <button type="button" className="os-btn" disabled={busy} onClick={save}>Save</button>
          </>
        }
      />

      {banner && <div className="vp-field-err">{banner}</div>}

      <div className="vp-editor">
        <div className="vp-editor-form vp-form">
          <label>
            Name
            <input
              className="os-input"
              aria-label="Name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>

          <label>
            Category
            <select
              className="os-input"
              aria-label="Category"
              value={form.category_id}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="vp-help">The category decides which details you fill in below.</span>
          </label>

          <div className="vp-form-row">
            <label>
              Type
              <select
                className="os-input"
                aria-label="Type"
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
              >
                <option>Hardware</option>
                <option>Software</option>
              </select>
            </label>

            <label>
              Pricing
              <select
                className="os-input"
                aria-label="Pricing"
                value={form.pricing}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  pricing: e.target.value,
                  price: e.target.value === "quote" ? null : f.price,
                }))}
              >
                <option value="fixed">Fixed price</option>
                <option value="quote">On request</option>
              </select>
            </label>
          </div>

          {form.pricing === "fixed" && (
            <label>
              Price (₹)
              <input
                className="os-input"
                type="number"
                aria-label="Price (₹)"
                value={form.price ?? ""}
                onChange={(e) => set("price", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          )}

          <div className="vp-form-row">
            <label>
              Lead time min (weeks)
              <input
                className="os-input"
                type="number"
                aria-label="Lead time min (weeks)"
                value={form.lead_time_weeks_min ?? ""}
                onChange={(e) => set("lead_time_weeks_min",
                  e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label>
              Lead time max (weeks)
              <input
                className="os-input"
                type="number"
                aria-label="Lead time max (weeks)"
                value={form.lead_time_weeks_max ?? ""}
                onChange={(e) => set("lead_time_weeks_max",
                  e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>

          <label>
            Blurb (card line)
            <input
              className="os-input"
              aria-label="Blurb (card line)"
              value={form.blurb}
              onChange={(e) => set("blurb", e.target.value)}
            />
          </label>

          <label>
            Description
            <textarea
              className="os-input"
              aria-label="Description"
              rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>

          <div className="section-lbl">Details</div>
          {!form.category_id && (
            <p className="vp-help">Choose a category to see the details for this kind of product.</p>
          )}
          {fields.map((f) => (
            <SpecFieldInput
              key={f.key}
              field={f}
              value={form.specs?.[f.key]}
              error={errors[f.key]}
              onChange={(raw) => setSpec(f, raw)}
            />
          ))}
        </div>

        <aside className="vp-editor-preview" data-testid="founder-preview">
          <div className="section-lbl">Preview as founder</div>
          <div className="founder-portal">
            <div className="pgrid">
              <ProductCard
                product={preview}
                onOpen={() => setShowModal(true)}
                onPrimary={() => setShowModal(true)}
                busy={busy}
              />
            </div>
          </div>
          <button type="button" className="os-btn ghost" onClick={() => setShowModal(true)}>
            Open the detail view
          </button>
        </aside>
      </div>

      {showModal && (
        <div className="founder-portal">
          <ProductModal
            product={preview}
            onClose={() => setShowModal(false)}
            onPrimary={() => {}}
            onRequestContact={async () => {}}
            onSubmitReview={async () => {}}
            busy={busy}
            autoOpenRequest={false}
          />
        </div>
      )}
    </div>
  );
}
