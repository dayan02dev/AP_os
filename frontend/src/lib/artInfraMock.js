// Phase-1 stand-in for the Art Infra API. Every method name here is the name
// the real client will expose in Phase 2, so swapping this module for a
// network client is a one-line import change per screen.
//
// State is in-memory and per-instance: a reload resets it. That is deliberate
// for a UI sample — nothing here writes to any database.

import seed from "./__fixtures__/artInfraSeed.json";

// Sample reviews and datasheets exist so the moderation queue and the
// datasheet section are not empty in the preview. They are MOCK ONLY and must
// never be carried into the Phase-2 migration seed, which deliberately ships
// neither.
const SAMPLE_REVIEWS = [
  { id: "r1", product_id: "c1", application_id: "app-1", author_name: "Rhea Nair",
    author_venture: "AuralDx", rating: 5, status: "approved",
    body: "Channel matching saved us weeks of calibration.",
    created_at: "2026-08-02T10:00:00Z" },
  { id: "r2", product_id: "c1", application_id: "app-2", author_name: "Ishan Gupta",
    author_venture: "BreatheAI", rating: 4, status: "approved",
    body: "Great SNR. Docs assume some DSP background.",
    created_at: "2026-08-11T10:00:00Z" },
  { id: "r3", product_id: "c3", application_id: "app-3", author_name: "Meera Rao",
    author_venture: "GridSense", rating: 2, status: "pending",
    body: "Ran hot under sustained load; needed extra cooling.",
    created_at: "2026-08-28T10:00:00Z" },
  { id: "r4", product_id: "c2", application_id: "app-4", author_name: "Arjun Shetty",
    author_venture: "CardiaLoop", rating: 5, status: "pending",
    body: "Isolation spec held up in our IEC pre-scan.",
    created_at: "2026-08-30T10:00:00Z" },
];

const SAMPLE_DATASHEETS = [
  { id: "d1", product_id: "c1", kind: "PDF", name: "Array datasheet (rev C)",
    storage_path: null, external_url: "https://example.org/array-rev-c.pdf", sort: 0 },
  { id: "d2", product_id: "c1", kind: "PDF", name: "Beamforming app note",
    storage_path: null, external_url: "https://example.org/beamforming.pdf", sort: 1 },
  { id: "d3", product_id: "c2", kind: "Link", name: "Vendor product page",
    storage_path: null, external_url: "https://example.org/ecg-afe", sort: 0 },
];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const nextId = (rows, prefix) => `${prefix}${rows.length + 1}-${Date.now().toString(36)}`;
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The single founder the preview simulates.
const ME = "app-me";

// Sample shortlist so the Insights screen has something to show the moment an
// admin opens it, without depending on a founder having shortlisted anything
// first in the same session. MOCK ONLY — see SAMPLE_REVIEWS above; the
// Phase-2 migration seed ships an empty shortlist, same as every other
// `createArtInfraStore()` call in this module (tests rely on that).
const SAMPLE_SHORTLIST = [
  { product_id: "c1", qty: 1 },
  { product_id: "c3", qty: 2 },
  { product_id: "c9", qty: 1 },
];

export function createArtInfraStore(initial = seed, { seedShortlist = false } = {}) {
  const db = {
    vendors: clone(initial.vendors),
    categories: clone(initial.categories),
    products: clone(initial.products),
    datasheets: clone(SAMPLE_DATASHEETS),
    reviews: clone(SAMPLE_REVIEWS),
    shortlist: seedShortlist ? clone(SAMPLE_SHORTLIST) : [],      // {product_id, qty}
    procurement: [],    // rows pushed out of the shortlist
  };

  const ok = (v) => Promise.resolve(clone(v));
  const fail = (code) => Promise.reject(new Error(code));

  const vendorOf = (p) => db.vendors.find((v) => v.id === p.vendor_id) || null;
  const categoryOf = (p) => db.categories.find((c) => c.id === p.category_id) || null;
  const sheetsOf = (p) => db.datasheets.filter((d) => d.product_id === p.id)
    .sort((a, b) => a.sort - b.sort);

  const ratingOf = (p) => {
    const approved = db.reviews.filter((r) => r.product_id === p.id && r.status === "approved");
    if (!approved.length) return { avg: 0, count: 0 };
    return {
      avg: approved.reduce((a, r) => a + r.rating, 0) / approved.length,
      count: approved.length,
    };
  };

  // Admin view: flat row plus resolved vendor/category and a pending count.
  const adminView = (p) => ({
    ...p,
    vendor: vendorOf(p),
    category: categoryOf(p),
    datasheet_count: sheetsOf(p).length,
    pending_reviews: db.reviews.filter(
      (r) => r.product_id === p.id && r.status === "pending").length,
    rating: ratingOf(p),
  });

  // Founder view: everything the card and modal render.
  const founderView = (p) => {
    const line = db.shortlist.find((s) => s.product_id === p.id);
    const mine = db.reviews.find((r) => r.product_id === p.id && r.application_id === ME);
    return {
      ...p,
      vendor: vendorOf(p),
      category: categoryOf(p),
      datasheets: sheetsOf(p),
      reviews: db.reviews.filter((r) => r.product_id === p.id && r.status === "approved"),
      rating: ratingOf(p),
      in_shortlist_qty: line ? line.qty : 0,
      can_review: Boolean(line),
      my_review: mine || null,
    };
  };

  return {
    // ── admin: products ──────────────────────────────────────────────
    listProducts({ search = "", status = "", category = "", type = "", vendor = "" } = {}) {
      const q = search.trim().toLowerCase();
      const items = db.products
        .filter((p) => (!status || p.status === status))
        .filter((p) => (!category || p.category_id === category))
        .filter((p) => (!type || p.type === type))
        .filter((p) => (!vendor || p.vendor_id === vendor))
        .filter((p) => !q
          || p.name.toLowerCase().includes(q)
          || (vendorOf(p)?.name || "").toLowerCase().includes(q))
        .sort((a, b) => a.sort - b.sort)
        .map(adminView);
      return ok({ items, total: items.length });
    },

    getProduct(id) {
      const p = db.products.find((x) => x.id === id);
      return ok(p ? adminView(p) : null);
    },

    saveProduct(patch) {
      if (!patch.name) return fail("name_required");
      const existing = patch.id && db.products.find((p) => p.id === patch.id);
      if (existing) {
        Object.assign(existing, patch);
        return ok(adminView(existing));
      }
      const created = {
        id: nextId(db.products, "p"),
        slug: patch.slug || slugify(patch.name),
        specs: [], status: "draft", sort: db.products.length,
        visible_tracks: ["tir"], price: null,
        lead_time_weeks_min: null, lead_time_weeks_max: null,
        blurb: "", description: "",
        ...patch,
      };
      db.products.push(created);
      return ok(adminView(created));
    },

    setProductStatus(id, status) {
      const p = db.products.find((x) => x.id === id);
      if (!p) return fail("not_found");
      p.status = status;
      return ok(adminView(p));
    },

    // ── admin: vendors + categories ──────────────────────────────────
    listVendors() { return ok([...db.vendors].sort((a, b) => a.name.localeCompare(b.name))); },

    saveVendor(patch) {
      if (!patch.name) return fail("name_required");
      const existing = patch.id && db.vendors.find((v) => v.id === patch.id);
      if (existing) { Object.assign(existing, patch); return ok(existing); }
      const created = { id: slugify(patch.name), contact_name: "", contact_email: "",
        contact_phone: "", artpark_ref: "", notes: "", ...patch };
      db.vendors.push(created);
      return ok(created);
    },

    deleteVendor(id) {
      if (db.products.some((p) => p.vendor_id === id)) return fail("vendor_in_use");
      db.vendors = db.vendors.filter((v) => v.id !== id);
      return ok(undefined);
    },

    listCategories() { return ok([...db.categories].sort((a, b) => a.sort - b.sort)); },

    saveCategory(patch) {
      if (!patch.label) return fail("label_required");
      const existing = patch.id && db.categories.find((c) => c.id === patch.id);
      if (existing) { Object.assign(existing, patch); return ok(existing); }
      const created = { id: slugify(patch.label), sort: db.categories.length, ...patch };
      db.categories.push(created);
      return ok(created);
    },

    deleteCategory(id) {
      if (db.products.some((p) => p.category_id === id)) return fail("category_in_use");
      db.categories = db.categories.filter((c) => c.id !== id);
      return ok(undefined);
    },

    // ── admin: review moderation ─────────────────────────────────────
    listReviews({ status = "" } = {}) {
      const rows = db.reviews
        .filter((r) => (!status || r.status === status))
        .map((r) => ({
          ...r,
          product_name: db.products.find((p) => p.id === r.product_id)?.name || "(deleted)",
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok(rows);
    },

    moderateReview(id, status) {
      const r = db.reviews.find((x) => x.id === id);
      if (!r) return fail("not_found");
      r.status = status;
      r.moderated_at = new Date().toISOString();
      return ok(r);
    },

    deleteReview(id) {
      db.reviews = db.reviews.filter((r) => r.id !== id);
      return ok(undefined);
    },

    // ── admin: insights ──────────────────────────────────────────────
    insights() {
      const perProduct = db.products.map((p) => {
        const line = db.shortlist.find((s) => s.product_id === p.id);
        return {
          id: p.id, name: p.name, status: p.status,
          vendor: vendorOf(p)?.name || "",
          shortlisted_by: line ? 1 : 0,
          rating: ratingOf(p),
        };
      });
      const approvedReviews = db.reviews.filter((r) => r.status === "approved");
      const meanApprovedRating = {
        avg: approvedReviews.length
          ? approvedReviews.reduce((a, r) => a + r.rating, 0) / approvedReviews.length
          : 0,
        count: approvedReviews.length,
      };
      return ok({
        perProduct,
        topShortlisted: [...perProduct]
          .filter((p) => p.shortlisted_by > 0)
          .sort((a, b) => b.shortlisted_by - a.shortlisted_by),
        neverShortlisted: perProduct.filter((p) => p.shortlisted_by === 0),
        meanApprovedRating,
      });
    },

    // ── founder ──────────────────────────────────────────────────────
    founderStore() {
      const catalog = db.products
        .filter((p) => p.status === "published")
        .sort((a, b) => a.sort - b.sort)
        .map(founderView);
      const shortlist = db.shortlist.map((line) => ({
        product_id: line.product_id,
        qty: line.qty,
        product: founderView(db.products.find((p) => p.id === line.product_id)),
      }));
      const shortlist_subtotal = shortlist.reduce(
        (a, l) => a + (l.product.price || 0) * l.qty, 0);
      return ok({ catalog, shortlist, shortlist_subtotal });
    },

    addToShortlist(productId, qty = 1) {
      if (!db.products.some((p) => p.id === productId)) return fail("unknown_product");
      const line = db.shortlist.find((s) => s.product_id === productId);
      if (line) line.qty += qty;
      else db.shortlist.push({ product_id: productId, qty });
      return ok(undefined);
    },

    setShortlistQty(productId, qty) {
      if (qty <= 0) return this.removeFromShortlist(productId);
      const line = db.shortlist.find((s) => s.product_id === productId);
      if (line) line.qty = qty;
      else db.shortlist.push({ product_id: productId, qty });
      return ok(undefined);
    },

    removeFromShortlist(productId) {
      db.shortlist = db.shortlist.filter((s) => s.product_id !== productId);
      return ok(undefined);
    },

    pushToProcurement() {
      const pushed = db.shortlist.length;
      db.shortlist.forEach((line) => {
        const p = db.products.find((x) => x.id === line.product_id);
        db.procurement.push({
          item: p.name, qty: line.qty, estimate: p.price || 0,
          vendor: vendorOf(p)?.name || "", status: "estimate",
        });
      });
      db.shortlist = [];
      return ok({ pushed });
    },

    submitReview(productId, { rating, body }) {
      if (!db.shortlist.some((s) => s.product_id === productId)) return fail("not_shortlisted");
      const existing = db.reviews.find(
        (r) => r.product_id === productId && r.application_id === ME);
      if (existing) {
        Object.assign(existing, { rating, body, status: "pending" });
        return ok(existing);
      }
      const created = {
        id: nextId(db.reviews, "r"), product_id: productId, application_id: ME,
        author_name: "You", author_venture: "Your venture",
        rating, body, status: "pending", created_at: new Date().toISOString(),
      };
      db.reviews.push(created);
      return ok(created);
    },
  };
}

// Shared singleton so every screen in the preview sees the same edits.
// Seeded with a small shortlist so Insights and the founder popover are never
// empty on first open — see F2 in the fix-wave report.
export const artInfraMock = createArtInfraStore(seed, { seedShortlist: true });
