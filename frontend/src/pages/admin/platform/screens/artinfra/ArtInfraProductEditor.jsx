// The preview pane mounts the REAL founder components against the in-progress
// draft, so an admin sees exactly what a founder will see. That is the whole
// point: nobody edits a catalog blind.
//
// This screen exists for the 11 seeded vendors, whose user_ids is [] --
// unclaimed, with nobody able to log in and author their products through the
// vendor portal. The admin acts here on the vendor's behalf: writes go
// through the same updateVendorProduct/createVendorProduct calls the vendor
// portal uses, addressed by the product's OWN vendor_id, never the logged-in
// admin's identity.

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ProductCard from "../../../../founder/components/ProductCard.jsx";
import ProductModal from "../../../../founder/components/ProductModal.jsx";
import SpecFieldInput from "../../../../vendor/components/SpecFieldInput.jsx";
import {
  describeFields, emptyValues, coerceValue, validateSpecs,
} from "../../../../../lib/specFieldForm.js";

const EMPTY = {
  id: null, name: "", blurb: "", description: "",
  vendor_id: "", category_id: "", type: "Hardware", pricing: "fixed",
  price: null, lead_time_weeks_min: null, lead_time_weeks_max: null,
  specs: {}, visible_tracks: ["tir"],
};

// The seed carries legacy free-text spec values from before the registry
// existed -- e.g. a "number" field's value stored as "8, matched ±1 dB".
// Loading those as-is would trip validateSpecs on every existing product
// with no edit ever made. A value that no longer fits its field's declared
// type is treated as unset rather than as an error the admin never caused;
// text fields (which never had a stricter shape to violate) pass through.
function sanitizeLegacySpecs(fields, specs) {
  const out = emptyValues(fields);
  for (const f of fields) {
    if (!specs || !(f.key in specs)) continue;
    const v = coerceValue(f, specs[f.key]);
    if (f.data_type === "number") { out[f.key] = Number.isFinite(v) ? v : out[f.key]; continue; }
    if (f.data_type === "enum") {
      if ((f.enum_options || []).includes(v)) out[f.key] = v;
      continue;
    }
    if (f.data_type === "multi_enum") {
      out[f.key] = Array.isArray(v) ? v.filter((x) => (f.enum_options || []).includes(x)) : [];
      continue;
    }
    out[f.key] = v; // text / boolean -- coerceValue already normalizes these safely
  }
  return out;
}

// Exactly the writable set the store accepts. Building the PATCH from this
// list -- rather than spreading the loaded product -- is what stops
// read-model-only fields (vendor_id, status, review_note, extra_specs,
// vendor, category, rating, pending_reviews) from ever reaching the write
// call and getting rejected as unwritable_fields.
const WRITABLE = ["name", "slug", "blurb", "description", "category_id", "type", "pricing",
  "price", "lead_time_weeks_min", "lead_time_weeks_max", "specs", "sort", "visible_tracks"];

export default function ArtInfraProductEditor({ store, productId, onDone }) {
  const [form, setForm] = useState(productId ? null : { ...EMPTY });
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [allFields, setAllFields] = useState([]);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);

  // Registry (vendors/categories/spec fields) and the product row load
  // together so the loaded specs can be sanitized against the field set for
  // their category before the form ever renders them -- doing this in two
  // independent effects would race allFields against the product fetch.
  //
  // Admin is not vendor-scoped, so there is no getVendorProduct(vendorId, id)
  // call to make here -- the row is found by id out of the full admin list.
  const load = useCallback(async () => {
    const myId = ++reqIdRef.current;
    try {
      const [v, c, f, row] = await Promise.all([
        store.adminListVendors(),
        store.listCategories(),
        store.listSpecFields(),
        productId
          ? store.adminListProducts({}).then(({ items }) => items.find((x) => x.id === productId))
          : Promise.resolve(null),
      ]);
      if (myId !== reqIdRef.current) return;
      setVendors(v);
      setCategories(c);
      setAllFields(f);
      if (!productId) { setForm({ ...EMPTY }); return; }
      if (!row) { setBanner("Could not load this product."); setForm({ ...EMPTY }); return; }
      const fields = describeFields(f, row.category_id);
      setForm({ ...row, specs: sanitizeLegacySpecs(fields, row.specs) });
    } catch {
      if (myId === reqIdRef.current) setBanner("Could not load this screen.");
    }
  }, [store, productId]);
  useEffect(() => { load(); }, [load]);

  if (!form) return <div className="adm-async adm-async-empty">Loading…</div>;

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

  // What the founder components will receive. Vendor and category are
  // resolved here because the form holds ids, but the founder view holds
  // objects. Reviews/contact/shortlist are always forced to their "nothing
  // has happened yet" state in a draft preview -- there is nothing to
  // review, request or shortlist yet -- so rating must be forced to match,
  // otherwise a product that already has approved reviews elsewhere would
  // preview "★ 4.5 (2)" directly above "No reviews yet.", a contradiction.
  const preview = {
    ...form,
    id: form.id || "preview",
    vendor: vendors.find((v) => v.id === form.vendor_id) || { name: "(no vendor)" },
    category: categories.find((c) => c.id === form.category_id) || { label: "(no category)" },
    spec_fields: fields,
    datasheets: [],
    rating: { avg: 0, count: 0 },
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
      if (productId) await store.updateVendorProduct(form.vendor_id, productId, patch);
      else await store.createVendorProduct(form.vendor_id, patch);
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
        eyebrow="Art Infra"
        title={productId ? "Edit product" : "New product"}
        breadcrumb={[{ label: "Catalog", onClick: onDone }, { label: form.name || "New product" }]}
        actions={
          <>
            <button type="button" className="os-btn ghost" onClick={onDone}>Cancel</button>
            <button type="button" className="os-btn" disabled={!form.name.trim() || busy}
              onClick={save}>Save</button>
          </>
        }
      />

      {banner && <div className="vp-field-err">{banner}</div>}

      <div className="ai-editor">
        <div className="ai-editor-form">
          <label>Name
            <input className="os-input" aria-label="Name" value={form.name}
              onChange={(e) => set("name", e.target.value)} />
          </label>

          <label>Vendor
            <select className="os-input" aria-label="Vendor" value={form.vendor_id}
              onChange={(e) => set("vendor_id", e.target.value)}>
              <option value="">Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.display_name || v.name}</option>
              ))}
            </select>
          </label>

          <label>Category
            <select className="os-input" aria-label="Category" value={form.category_id}
              onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>

          <label>Type
            <select className="os-input" aria-label="Type" value={form.type}
              onChange={(e) => set("type", e.target.value)}>
              <option>Hardware</option><option>Software</option>
            </select>
          </label>

          <label>Pricing
            <select className="os-input" aria-label="Pricing" value={form.pricing}
              onChange={(e) => setForm((f) => ({
                ...f,
                pricing: e.target.value,
                // A quote-priced product has no price. Clearing it here is what
                // keeps the form honest with the schema's "null when
                // pricing='quote'" rule -- hiding the field alone would leave a
                // stale number in the payload.
                price: e.target.value === "quote" ? null : f.price,
              }))}>
              <option value="fixed">Fixed price</option>
              <option value="quote">On request</option>
            </select>
          </label>

          {/* A quote-priced product has no price, so the field is not merely
              disabled -- it is absent, and the value is cleared. */}
          {form.pricing === "fixed" && (
            <label>Price (₹)
              <input className="os-input" aria-label="Price (₹)" type="number"
                value={form.price ?? ""}
                onChange={(e) => set("price", e.target.value === "" ? null : Number(e.target.value))} />
            </label>
          )}

          <div className="ai-leadtime">
            <label>Lead time min (weeks)
              <input className="os-input" aria-label="Lead time min (weeks)" type="number"
                value={form.lead_time_weeks_min ?? ""}
                onChange={(e) => set("lead_time_weeks_min",
                  e.target.value === "" ? null : Number(e.target.value))} />
            </label>
            <label>Lead time max (weeks)
              <input className="os-input" aria-label="Lead time max (weeks)" type="number"
                value={form.lead_time_weeks_max ?? ""}
                onChange={(e) => set("lead_time_weeks_max",
                  e.target.value === "" ? null : Number(e.target.value))} />
            </label>
          </div>

          <label>Blurb (card line)
            <input className="os-input" aria-label="Blurb (card line)" value={form.blurb}
              onChange={(e) => set("blurb", e.target.value)} />
          </label>

          <label>Description (modal)
            <textarea className="os-input" aria-label="Description (modal)" rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)} />
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

        <aside className="ai-editor-preview" data-testid="founder-preview">
          <div className="section-lbl">Preview as founder</div>
          <div className="founder-portal">
            <div className="pgrid">
              <ProductCard product={preview} onOpen={() => setShowModal(true)}
                onPrimary={() => setShowModal(true)} busy={busy} />
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
