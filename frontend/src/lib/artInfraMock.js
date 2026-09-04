// Phase-2 API stand-in for three portals. Every method name here is the name
// the real client will expose, so swapping this module for a network client is
// a one-line import change per screen.
//
// Deliberately hostile, unlike Phase 1's mock:
//   * every call goes through settle() -- genuinely async, jittered, failable
//   * write methods REJECT unknown fields, so a read-model-as-write-payload
//     bug fails here instead of 422-ing in staging
//   * NO METHOD USES `this` -- every call site may destructure freely

import seed from "./__fixtures__/artInfraSeed.json";
import { settle, reject } from "./artInfraLatency.js";

// The single founder the preview simulates.
const ME = "app-me";

// MOCK ONLY -- never seed any of this into the Phase-2 migration.
const SAMPLE_REVIEWS = [
  { id: "r1", vendor_id: "knowles", application_id: "app-1", author_name: "Rhea Nair",
    author_venture: "AuralDx", rating: 5, status: "approved",
    body: "Channel matching saved us weeks of calibration.",
    created_at: "2026-08-02T10:00:00Z" },
  { id: "r2", vendor_id: "knowles", application_id: "app-2", author_name: "Ishan Gupta",
    author_venture: "BreatheAI", rating: 4, status: "pending",
    body: "Great SNR. Docs assume some DSP background.",
    created_at: "2026-08-11T10:00:00Z" },
];

const WRITABLE = {
  vendor: ["legal_name", "display_name", "website", "contact_name", "contact_email",
    "contact_phone", "city", "state", "country", "capabilities", "categories_served",
    "gstin", "udyam_number", "cin", "certifications"],
  product: ["name", "slug", "blurb", "description", "category_id", "type", "pricing",
    "price", "lead_time_weeks_min", "lead_time_weeks_max", "specs", "sort",
    "visible_tracks"],
  request: ["product_id", "note", "qty"],
  invite: ["display_name", "contact_email"],
  review: ["rating", "body"],
  category: ["id", "label", "sort"],
  specField: ["id", "category_id", "key", "label", "data_type", "unit", "enum_options",
    "required", "filterable", "help_text", "sort"],
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Throws if `patch` carries any key outside the entity's writable set. */
function assertWritable(patch, allowed) {
  const bad = Object.keys(patch || {}).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Error(`unwritable_fields: ${bad.join(", ")}`);
}

export function createArtInfraStore(initial = seed, { seedSamples = true } = {}) {
  const db = {
    vendors: clone(initial.vendors).map((v) => ({
      ...v, legal_name: v.name, display_name: v.name,
      website: "", capabilities: "", categories_served: [],
      city: "", state: "", country: "India",
      gstin: "", udyam_number: "", cin: "", certifications: [],
      status: "approved",        // seeded vendors are live and unclaimed
      user_ids: [],              // one-to-many; empty = unclaimed
      // MOCK ONLY -- the generator deliberately invents no contact data, but an
      // empty contact block makes the approved state look broken in review.
      // These live here, beside SAMPLE_REVIEWS, so they cannot reach a real seed.
      contact_name: v.contact_name || "Sales desk",
      contact_email: v.contact_email || `sales@${v.id}.example`,
      contact_phone: v.contact_phone || "+91 80 4000 0000",
    })),
    categories: clone(initial.categories),
    spec_fields: clone(initial.spec_fields),
    products: clone(initial.products).map((p) => ({ ...p, review_note: "" })),
    datasheets: [],
    reviews: seedSamples ? clone(SAMPLE_REVIEWS) : [],
    requests: [],
    shortlist: [],
    procurement: [],
  };

  // ---- derivations -------------------------------------------------------
  const vendorOf = (p) => db.vendors.find((v) => v.id === p.vendor_id) || null;
  const categoryOf = (p) => db.categories.find((c) => c.id === p.category_id) || null;

  const ratingOfVendor = (vendorId) => {
    const ok = db.reviews.filter((r) => r.vendor_id === vendorId && r.status === "approved");
    if (!ok.length) return { avg: 0, count: 0 };
    return { avg: ok.reduce((a, r) => a + r.rating, 0) / ok.length, count: ok.length };
  };

  // Prefer approved, then pending, else the most recent — a stale declined or
  // withdrawn row must not pin the product's state once a new one exists.
  const requestFor = (productId) => {
    const mine = db.requests.filter(
      (r) => r.product_id === productId && r.application_id === ME);
    if (!mine.length) return null;
    const rank = { approved: 0, pending: 1, declined: 2, withdrawn: 3 };
    return [...mine].sort((a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      || b.created_at.localeCompare(a.created_at))[0];
  };

  const vendorApprovedFor = (vendorId) =>
    db.requests.some((r) => r.vendor_id === vendorId
      && r.application_id === ME && r.status === "approved");

  /** THE DISCLOSURE RULE. Contact fields are added only when approved --
   *  they are absent from the object, not blanked, so they never travel. */
  const vendorForFounder = (v) => {
    const base = { id: v.id, name: v.display_name || v.name, website: v.website };
    if (!vendorApprovedFor(v.id)) return base;
    return {
      ...base,
      contact_name: v.contact_name, contact_email: v.contact_email,
      contact_phone: v.contact_phone, artpark_ref: v.artpark_ref,
      city: v.city, state: v.state, country: v.country,
    };
  };

  const founderView = (p) => {
    const v = vendorOf(p);
    const line = db.shortlist.find((s) => s.product_id === p.id);
    const req = requestFor(p.id);
    const mine = db.reviews.find(
      (r) => r.vendor_id === p.vendor_id && r.application_id === ME);
    return {
      ...p,
      vendor: v ? vendorForFounder(v) : null,
      category: categoryOf(p),
      spec_fields: db.spec_fields.filter(
        (f) => f.category_id === p.category_id && !f.archived_at),
      datasheets: db.datasheets.filter((d) => d.product_id === p.id),
      rating: v ? ratingOfVendor(v.id) : { avg: 0, count: 0 },
      in_shortlist_qty: line ? line.qty : 0,
      // Disclosure is per-VENDOR: approving any one request unlocks every
      // product that vendor lists. vendorApprovedFor wins over this product's
      // own request row, so an older decline on one product cannot mask a
      // vendor unlocked through another. A lone withdrawn row (no approved
      // or pending sibling) is not a real outstanding state, so it reports
      // as "none" rather than the out-of-enum "withdrawn".
      contact_state: vendorApprovedFor(p.vendor_id)
        ? "approved"
        : (req && req.status !== "withdrawn" ? req.status : "none"),
      request_id: req ? req.id : null,
      request_note: req ? req.decision_note || "" : "",
      can_review: v ? vendorApprovedFor(v.id) : false,
      my_review: mine || null,
    };
  };

  const adminView = (p) => ({
    ...p,
    vendor: vendorOf(p),
    category: categoryOf(p),
    pending_reviews: db.reviews.filter(
      (r) => r.vendor_id === p.vendor_id && r.status === "pending").length,
    rating: ratingOfVendor(p.vendor_id),
  });

  const ownedProduct = (vendorId, productId) =>
    db.products.find((p) => p.id === productId && p.vendor_id === vendorId) || null;

  // ---- shared reads ------------------------------------------------------
  const listCategories = () =>
    settle([...db.categories].sort((a, b) => a.sort - b.sort));

  const listSpecFields = (categoryId) =>
    settle(db.spec_fields
      .filter((f) => (!categoryId || f.category_id === categoryId))
      .sort((a, b) => a.sort - b.sort));

  // ---- vendor-scoped -----------------------------------------------------
  const getVendorMe = (vendorId) => {
    const v = db.vendors.find((x) => x.id === vendorId);
    return v ? settle(v) : reject("not_found");
  };

  const saveVendorProfile = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.vendor); } catch (e) { return Promise.reject(e); }
    const v = db.vendors.find((x) => x.id === vendorId);
    if (!v) return reject("not_found");
    Object.assign(v, patch);
    return settle(v);
  };

  const submitVendorProfile = (vendorId) => {
    const v = db.vendors.find((x) => x.id === vendorId);
    if (!v) return reject("not_found");
    if (!v.legal_name || !v.contact_email) return reject("profile_incomplete");
    if (v.status === "invited") v.status = "registered";
    return settle(v);
  };

  const listVendorProducts = (vendorId, { status = "", search = "" } = {}) => {
    const q = search.trim().toLowerCase();
    const items = db.products
      .filter((p) => p.vendor_id === vendorId)
      .filter((p) => (!status || p.status === status))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.sort - b.sort);
    return settle({ items, total: db.products.filter((p) => p.vendor_id === vendorId).length });
  };

  const getVendorProduct = (vendorId, productId) =>
    settle(ownedProduct(vendorId, productId));

  const createVendorProduct = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.product); } catch (e) { return Promise.reject(e); }
    if (!patch.name) return reject("name_required");
    const created = {
      id: uid("p"), vendor_id: vendorId, slug: patch.slug || slugify(patch.name),
      blurb: "", description: "", category_id: "", type: "Hardware", pricing: "fixed",
      price: null, lead_time_weeks_min: null, lead_time_weeks_max: null,
      specs: {}, extra_specs: [], status: "draft", review_note: "",
      sort: db.products.length, visible_tracks: ["tir"],
      ...patch,
    };
    db.products.push(created);
    return settle(created);
  };

  const updateVendorProduct = (vendorId, productId, patch) => {
    try { assertWritable(patch, WRITABLE.product); } catch (e) { return Promise.reject(e); }
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    Object.assign(p, patch);
    return settle(p);
  };

  const submitProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    if (p.status !== "draft") return reject("not_draft");
    p.status = "pending_review";
    p.review_note = "";
    return settle(p);
  };

  const retireProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    p.status = "retired";
    return settle(p);
  };

  const deleteVendorProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    if (p.status !== "draft") return reject("only_drafts_deletable");
    db.products = db.products.filter((x) => x.id !== productId);
    return settle(undefined);
  };

  // ---- admin -------------------------------------------------------------
  const adminListVendors = ({ status = "", search = "" } = {}) => {
    const q = search.trim().toLowerCase();
    return settle(db.vendors
      .filter((v) => (!status || v.status === status))
      .filter((v) => !q || (v.display_name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")));
  };

  const inviteVendor = (patch) => {
    try { assertWritable(patch, WRITABLE.invite); } catch (e) { return Promise.reject(e); }
    if (!patch?.contact_email) return reject("email_required");
    const base = slugify(patch.display_name || patch.contact_email);
    if (db.vendors.some((v) => v.id === base)) return reject("vendor_exists");
    const created = {
      id: base, name: patch.display_name || "",
      legal_name: "", display_name: patch.display_name || "", website: "",
      contact_name: "", contact_email: patch.contact_email, contact_phone: "",
      artpark_ref: "", capabilities: "", categories_served: [],
      city: "", state: "", country: "India",
      gstin: "", udyam_number: "", cin: "", certifications: [],
      status: "invited", user_ids: [],
    };
    db.vendors.push(created);
    return settle(created);
  };

  const setVendorStatus = (id, status) => {
    const v = db.vendors.find((x) => x.id === id);
    if (!v) return reject("not_found");
    v.status = status;
    return settle(v);
  };
  const approveVendor = (id) => setVendorStatus(id, "approved");
  const suspendVendor = (id) => setVendorStatus(id, "suspended");

  const adminListProducts = ({ search = "", status = "", category = "", type = "",
    vendor = "" } = {}) => {
    const q = search.trim().toLowerCase();
    const items = db.products
      .filter((p) => (!status || p.status === status))
      .filter((p) => (!category || p.category_id === category))
      .filter((p) => (!type || p.type === type))
      .filter((p) => (!vendor || p.vendor_id === vendor))
      .filter((p) => !q || p.name.toLowerCase().includes(q)
        || (vendorOf(p)?.display_name || "").toLowerCase().includes(q))
      .sort((a, b) => a.sort - b.sort)
      .map(adminView);
    return settle({ items, total: db.products.length });
  };

  const publishProduct = (id) => {
    const p = db.products.find((x) => x.id === id);
    if (!p) return reject("not_found");
    if (p.status !== "pending_review") return reject("not_in_review");
    const v = vendorOf(p);
    if (!v || v.status !== "approved") return reject("vendor_not_approved");
    p.status = "published";
    p.review_note = "";
    return settle(p);
  };

  const sendBackProduct = (id, note) => {
    const p = db.products.find((x) => x.id === id);
    if (!p) return reject("not_found");
    if (!note?.trim()) return reject("note_required");
    p.status = "draft";
    p.review_note = note;
    return settle(p);
  };

  const saveCategory = (patch) => {
    try { assertWritable(patch, WRITABLE.category); } catch (e) { return Promise.reject(e); }
    if (!patch.label) return reject("label_required");
    const existing = patch.id && db.categories.find((c) => c.id === patch.id);
    if (existing) { Object.assign(existing, patch); return settle(existing); }
    const created = { id: slugify(patch.label), sort: db.categories.length, ...patch };
    db.categories.push(created);
    return settle(created);
  };

  const deleteCategory = (id) => {
    if (db.products.some((p) => p.category_id === id)) return reject("category_in_use");
    db.categories = db.categories.filter((c) => c.id !== id);
    db.spec_fields = db.spec_fields.filter((f) => f.category_id !== id);
    return settle(undefined);
  };

  const saveSpecField = (patch) => {
    try { assertWritable(patch, WRITABLE.specField); } catch (e) { return Promise.reject(e); }
    if (!patch.label || !patch.key) return reject("key_and_label_required");
    const existing = patch.id && db.spec_fields.find((f) => f.id === patch.id);
    // A live field's key must stay unique within its category; an ARCHIVED one
    // must not block re-adding that key.
    const clash = db.spec_fields.find((f) => f.category_id === patch.category_id
      && f.key === patch.key && !f.archived_at && f.id !== patch.id);
    if (clash) return reject("duplicate_key");
    if (existing) { Object.assign(existing, patch); return settle(existing); }
    const created = {
      id: uid("sf"), unit: null, enum_options: null, required: false,
      filterable: false, help_text: "", archived_at: null,
      sort: db.spec_fields.filter((f) => f.category_id === patch.category_id).length,
      ...patch,
    };
    db.spec_fields.push(created);
    return settle(created);
  };

  /** Soft delete. Values survive in specs but stop rendering. */
  const archiveSpecField = (id) => {
    const f = db.spec_fields.find((x) => x.id === id);
    if (!f) return reject("not_found");
    f.archived_at = new Date().toISOString();
    return settle(f);
  };

  const listRequests = ({ status = "" } = {}) =>
    settle(db.requests
      .filter((r) => (!status || r.status === status))
      .map((r) => ({
        ...r,
        product_name: db.products.find((p) => p.id === r.product_id)?.name || "(deleted)",
        vendor_name: db.vendors.find((v) => v.id === r.vendor_id)?.display_name || "",
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));

  const decideRequest = (id, status, note) => {
    const r = db.requests.find((x) => x.id === id);
    if (!r) return reject("not_found");
    if (status === "declined" && !note?.trim()) return reject("note_required");
    r.status = status;
    r.decision_note = note || "";
    r.decided_at = new Date().toISOString();
    return settle(r);
  };
  const approveRequest = (id) => decideRequest(id, "approved", "");
  const declineRequest = (id, note) => decideRequest(id, "declined", note);

  const listVendorReviews = ({ status = "" } = {}) =>
    settle(db.reviews
      .filter((r) => (!status || r.status === status))
      .map((r) => ({
        ...r,
        vendor_name: db.vendors.find((v) => v.id === r.vendor_id)?.display_name || "",
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));

  const moderateVendorReview = (id, status) => {
    const r = db.reviews.find((x) => x.id === id);
    if (!r) return reject("not_found");
    if (!["pending", "approved", "hidden"].includes(status)) return reject("bad_status");
    r.status = status;
    r.moderated_at = new Date().toISOString();
    return settle(r);
  };

  const deleteVendorReview = (id) => {
    db.reviews = db.reviews.filter((r) => r.id !== id);
    return settle(undefined);
  };

  const insights = () => {
    const perProduct = db.products.map((p) => ({
      id: p.id, name: p.name, status: p.status,
      vendor: vendorOf(p)?.display_name || "",
      requested_by: db.requests.filter((r) => r.product_id === p.id).length,
      rating: ratingOfVendor(p.vendor_id),
    }));
    const approved = db.reviews.filter((r) => r.status === "approved");
    return settle({
      perProduct,
      topRequested: [...perProduct].filter((p) => p.requested_by > 0)
        .sort((a, b) => b.requested_by - a.requested_by),
      neverRequested: perProduct.filter((p) => p.requested_by === 0),
      meanApprovedRating: {
        avg: approved.length
          ? approved.reduce((a, r) => a + r.rating, 0) / approved.length : 0,
        count: approved.length,
      },
    });
  };

  // ---- founder -----------------------------------------------------------
  const founderStore = () => {
    const catalog = db.products
      .filter((p) => p.status === "published")
      .sort((a, b) => a.sort - b.sort)
      .map(founderView);
    const shortlist = db.shortlist.map((line) => ({
      product_id: line.product_id, qty: line.qty,
      product: founderView(db.products.find((p) => p.id === line.product_id)),
    }));
    return settle({
      catalog,
      shortlist,
      shortlist_subtotal: shortlist.reduce(
        (a, l) => a + (l.product.price || 0) * l.qty, 0),
      requests: db.requests.filter((r) => r.application_id === ME),
    });
  };

  const addToShortlist = (productId, qty = 1) => {
    if (!db.products.some((p) => p.id === productId)) return reject("unknown_product");
    const line = db.shortlist.find((s) => s.product_id === productId);
    if (line) line.qty += qty;
    else db.shortlist.push({ product_id: productId, qty });
    return settle(undefined);
  };

  const removeFromShortlist = (productId) => {
    db.shortlist = db.shortlist.filter((s) => s.product_id !== productId);
    return settle(undefined);
  };

  // Plain call, NOT this.removeFromShortlist -- survives destructuring.
  const setShortlistQty = (productId, qty) => {
    if (qty <= 0) return removeFromShortlist(productId);
    const line = db.shortlist.find((s) => s.product_id === productId);
    if (line) line.qty = qty;
    else db.shortlist.push({ product_id: productId, qty });
    return settle(undefined);
  };

  const pushToProcurement = () => {
    const pushed = db.shortlist.length;
    db.shortlist.forEach((line) => {
      const p = db.products.find((x) => x.id === line.product_id);
      db.procurement.push({
        item: p.name, qty: line.qty, estimate: p.price || 0,
        vendor: vendorOf(p)?.display_name || "", status: "estimate",
      });
    });
    db.shortlist = [];
    return settle({ pushed });
  };

  const createRequest = (patch) => {
    try { assertWritable(patch, WRITABLE.request); } catch (e) { return Promise.reject(e); }
    const p = db.products.find((x) => x.id === patch.product_id);
    if (!p) return reject("unknown_product");
    const open = db.requests.find((r) => r.product_id === p.id
      && r.application_id === ME && ["pending", "approved"].includes(r.status));
    if (open) return reject("already_requested");
    const created = {
      id: uid("req"), application_id: ME, product_id: p.id, vendor_id: p.vendor_id,
      note: patch.note || "", qty: patch.qty ?? null, status: "pending",
      decision_note: "", decided_at: null, created_at: new Date().toISOString(),
    };
    db.requests.push(created);
    return settle(created);
  };

  const withdrawRequest = (id) => {
    const r = db.requests.find((x) => x.id === id && x.application_id === ME);
    if (!r) return reject("not_found");
    r.status = "withdrawn";
    return settle(r);
  };

  const submitVendorReview = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.review); } catch (e) { return Promise.reject(e); }
    if (!vendorApprovedFor(vendorId)) return reject("not_eligible");
    const existing = db.reviews.find(
      (r) => r.vendor_id === vendorId && r.application_id === ME);
    if (existing) {
      Object.assign(existing, { ...patch, status: "pending" });
      return settle(existing);
    }
    const created = {
      id: uid("r"), vendor_id: vendorId, application_id: ME,
      author_name: "You", author_venture: "Your venture",
      rating: patch.rating, body: patch.body, status: "pending",
      created_at: new Date().toISOString(),
    };
    db.reviews.push(created);
    return settle(created);
  };

  return {
    listCategories, listSpecFields,
    getVendorMe, saveVendorProfile, submitVendorProfile,
    listVendorProducts, getVendorProduct, createVendorProduct, updateVendorProduct,
    submitProduct, retireProduct, deleteVendorProduct,
    adminListVendors, inviteVendor, approveVendor, suspendVendor,
    adminListProducts, publishProduct, sendBackProduct,
    saveCategory, deleteCategory, saveSpecField, archiveSpecField,
    listRequests, approveRequest, declineRequest,
    listVendorReviews, moderateVendorReview, deleteVendorReview,
    insights,
    founderStore, addToShortlist, setShortlistQty, removeFromShortlist,
    pushToProcurement, createRequest, withdrawRequest, submitVendorReview,
  };
}

// Shared singleton so every screen in the preview sees the same edits.
export const artInfraMock = createArtInfraStore();
