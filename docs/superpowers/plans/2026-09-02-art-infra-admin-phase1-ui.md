# Art Infra Admin Portal — Phase 1 (UI sample) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a clickable Vercel preview containing six admin Art Infra screens plus the reworked founder Art Infra page, rendering entirely from a mock fixture seeded with the real catalog, so the user can approve UI and features before any schema or endpoint work begins.

**Architecture:** A single in-memory mock store (`artInfraMock.js`) exposes exactly the method names the real API client will expose in Phase 2, so swapping mock for network is a one-line import change per screen rather than a rewrite. The founder product card and modal are extracted into standalone components so the admin "preview as founder" pane mounts the genuine founder UI against draft data instead of a lookalike. All screens reuse the existing `.eir-*` / `.lp-*` chrome and the shared `ListToolbar`.

**Tech Stack:** React 18, react-router-dom, Vite, Vitest + @testing-library/react (jsdom), existing `admin-portal.css` / `founder-portal.css` design tokens.

**Spec:** `docs/superpowers/specs/2026-09-02-art-infra-admin-portal-design.md`

## Global Constraints

- **NO DATABASE WORK.** No migration is written, run, or pasted into Supabase Studio. No SQL executes anywhere. No row is written to any environment.
- **NO BACKEND WORK.** No FastAPI router, no endpoint, no `backend/app/**` change except one read-only generator script under `backend/scripts/`.
- **NO DEPLOY.** No `sam deploy`, no staging deploy, no Vercel promote. Pushing the branch is permitted solely so Vercel builds a *preview*.
- **Branch:** `feat/art-infra-admin`, worktree `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/art-infra-admin`, off `release/sip-launch-v1` @ `a8c00f2`. Never commit from the primary checkout.
- **Copy rules, verbatim:** "Cart" becomes **"Shortlist"** everywhere in the founder Art Infra page. The `push-to-procurement` button keeps its existing text **"Push to procurement →"**. The quote CTA becomes **"Show contact"** (never "Request quote", never "Quote requested ✓").
- **Method-name parity:** every mock method name in `artInfraMock.js` is the name Phase 2's real client will use. Renaming one later is a breaking change across every screen — pick correctly now.
- **Field naming:** snake_case, matching every existing API payload in this codebase (`in_cart_qty`, `visible_tracks`). Do not camelCase.
- **Mock ≠ seed.** The mock fixture deliberately contains sample reviews and two sample datasheets so the moderation queue and the datasheet section are not empty in the preview. The Phase 2 *migration* seeds neither. Do not carry mock reviews or datasheets into a migration.
- Run frontend tests with `npm test` from `frontend/`. Single file: `npx vitest run <path>`.

---

### Task 1: Generate the catalog fixture from the real Python constants

Hand-transcribing 12 products is how typos enter. A generator imports the live module and emits JSON, so the fixture is provably the real catalog.

**Files:**
- Create: `backend/scripts/gen_art_infra_fixture.py`
- Create: `frontend/src/lib/__fixtures__/artInfraSeed.json` (generated)

**Interfaces:**
- Consumes: `backend/app/services/founder_catalog.py` (`CATALOG`, 12 dicts)
- Produces: `artInfraSeed.json` with top-level keys `vendors`, `categories`, `products` — the shape every later task reads.

- [ ] **Step 1: Write the generator**

```python
# backend/scripts/gen_art_infra_fixture.py
"""Emit the Art Infra UI fixture from the real founder_catalog constants.

Read-only: imports the module, writes one JSON file into the frontend. Touches
no database and no environment. Run from backend/:

    python3 scripts/gen_art_infra_fixture.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from app.services import founder_catalog as fc  # noqa: E402

OUT = (_ROOT.parent / "frontend/src/lib/__fixtures__/artInfraSeed.json")

# "3–4 weeks" (en-dash), "3-4 weeks" (hyphen), or "6 weeks".
_LEAD = re.compile(r"(\d+)\s*[–-]\s*(\d+)\s*weeks?|(\d+)\s*weeks?", re.I)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def split_lead_time(specs: list[dict]) -> tuple[list[dict], int | None, int | None]:
    """Lift the 'Lead time' spec row out into min/max week columns.

    Returns (specs_without_lead_time, min_weeks, max_weeks). A product with no
    lead-time row keeps its specs untouched and yields (None, None).
    """
    kept, lo, hi = [], None, None
    for row in specs:
        if row["k"].strip().lower() != "lead time":
            kept.append(row)
            continue
        m = _LEAD.search(row["v"])
        if m:
            if m.group(1):
                lo, hi = int(m.group(1)), int(m.group(2))
            else:
                lo = hi = int(m.group(3))
    return kept, lo, hi


def main() -> int:
    vendors, categories, products = {}, {}, []

    for product in fc.CATALOG:
        vid = slugify(product["vendor"])
        vendors.setdefault(vid, {
            "id": vid, "name": product["vendor"],
            # Admins fill these in through the UI; we invent no contact details.
            "contact_name": "", "contact_email": "", "contact_phone": "",
            "artpark_ref": "", "notes": "",
        })
        cid = slugify(product["cat"])
        categories.setdefault(cid, {"id": cid, "label": product["cat"],
                                    "sort": len(categories)})

        specs, lo, hi = split_lead_time(product.get("specs") or [])
        products.append({
            "id": product["id"],
            "slug": slugify(product["name"]),
            "name": product["name"],
            "blurb": product["blurb"],
            "description": product["desc"],
            "vendor_id": vid,
            "category_id": cid,
            "type": product["type"],
            "pricing": product["pricing"],
            "price": product.get("price") if product["pricing"] == "fixed" else None,
            "lead_time_weeks_min": lo,
            "lead_time_weeks_max": hi,
            "specs": specs,
            "status": "published",
            "sort": len(products),
            "visible_tracks": ["tir"],
        })

    payload = {
        "vendors": sorted(vendors.values(), key=lambda v: v["name"]),
        "categories": sorted(categories.values(), key=lambda c: c["sort"]),
        "products": products,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}")
    print(f"  vendors    {len(payload['vendors'])}")
    print(f"  categories {len(payload['categories'])}")
    print(f"  products   {len(payload['products'])}")
    missing = [p["name"] for p in products if p["lead_time_weeks_min"] is None]
    print(f"  lead time parsed for {len(products) - len(missing)}/{len(products)}")
    for name in missing:
        print(f"    NO LEAD TIME: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run it and read the output**

Run: `cd backend && python3 scripts/gen_art_infra_fixture.py`

Expected: `vendors 11`, `categories 8`, `products 12`. Read the lead-time lines — every product printed under `NO LEAD TIME` genuinely has no "Lead time" spec row in `founder_catalog.py`. Open the file and confirm before continuing; a regex that silently matched nothing would print all 12 as missing.

- [ ] **Step 3: Sanity-check the emitted JSON**

Run: `python3 -c "import json;d=json.load(open('frontend/src/lib/__fixtures__/artInfraSeed.json'));print(len(d['products']),len(d['vendors']),len(d['categories']));print(d['products'][0]['slug'],d['products'][0]['vendor_id'])"` from the repo root.

Expected: `12 11 8` then `mems-microphone-array-8-ch knowles`.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/gen_art_infra_fixture.py frontend/src/lib/__fixtures__/artInfraSeed.json
git commit -m "feat(art-infra): generate the UI fixture from the real catalog constants"
```

---

### Task 2: Mock store with the Phase-2 API surface

**Files:**
- Create: `frontend/src/lib/artInfraMock.js`
- Test: `frontend/src/lib/__tests__/artInfraMock.test.js`

**Interfaces:**
- Consumes: `artInfraSeed.json` from Task 1.
- Produces: `createArtInfraStore(seed?)` returning an object with these exact async methods, used by every later task:
  `listProducts({search,status,category,type,vendor})` → `{items,total}` ·
  `getProduct(id)` → product|null · `saveProduct(patch)` → product ·
  `setProductStatus(id,status)` → product · `deleteProduct(id)` → void ·
  `listVendors()` → vendor[] · `saveVendor(patch)` → vendor · `deleteVendor(id)` → void ·
  `listCategories()` → category[] · `saveCategory(patch)` → category · `deleteCategory(id)` → void ·
  `listReviews({status})` → review[] · `moderateReview(id,status)` → review · `deleteReview(id)` → void ·
  `insights()` → `{perProduct,topShortlisted,neverShortlisted}` ·
  `founderStore()` → `{catalog,shortlist,shortlist_subtotal}` ·
  `addToShortlist(productId,qty)` · `setShortlistQty(productId,qty)` ·
  `removeFromShortlist(productId)` · `pushToProcurement()` → `{pushed}` ·
  `submitReview(productId,{rating,body})` → review.
  A founder-facing product carries `vendor`, `category`, `datasheets`, `rating:{avg,count}`, `in_shortlist_qty`, `can_review`, `my_review`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/__tests__/artInfraMock.test.js
import { describe, it, expect } from "vitest";
import { createArtInfraStore } from "../artInfraMock";

describe("artInfraMock", () => {
  it("loads the real 12-product catalog by default", async () => {
    const s = createArtInfraStore();
    const { items, total } = await s.listProducts({});
    expect(total).toBe(12);
    expect(items[0].vendor.name).toBeTruthy();
    expect(items[0].category.label).toBeTruthy();
  });

  it("filters products by status, type and search", async () => {
    const s = createArtInfraStore();
    expect((await s.listProducts({ type: "Software" })).total).toBe(4);
    expect((await s.listProducts({ search: "MEMS" })).total).toBe(1);
    await s.setProductStatus("c1", "draft");
    expect((await s.listProducts({ status: "draft" })).total).toBe(1);
  });

  it("hides non-published products from the founder catalog", async () => {
    const s = createArtInfraStore();
    const before = (await s.founderStore()).catalog.length;
    await s.setProductStatus("c1", "draft");
    expect((await s.founderStore()).catalog.length).toBe(before - 1);
  });

  it("computes the average rating from APPROVED reviews only", async () => {
    const s = createArtInfraStore();
    // c1 ships two APPROVED sample reviews, rated 5 and 4 → avg 4.5, count 2.
    const before = (await s.founderStore()).catalog.find((x) => x.id === "c1");
    expect(before.rating).toEqual({ avg: 4.5, count: 2 });

    await s.addToShortlist("c1", 1);
    await s.submitReview("c1", { rating: 1, body: "pending, must not count" });

    const after = (await s.founderStore()).catalog.find((x) => x.id === "c1");
    // The new 1-star review is pending, so it moves neither the average nor
    // the count — that is the whole point of moderation.
    expect(after.rating).toEqual({ avg: 4.5, count: 2 });
    expect(after.my_review.status).toBe("pending");
    // ...but the author still sees their own pending review.
    expect(after.my_review.body).toBe("pending, must not count");
  });

  it("only allows a review once the product is shortlisted", async () => {
    const s = createArtInfraStore();
    const before = (await s.founderStore()).catalog.find((x) => x.id === "c2");
    expect(before.can_review).toBe(false);
    await expect(s.submitReview("c2", { rating: 5, body: "x" })).rejects.toThrow(
      "not_shortlisted",
    );
    await s.addToShortlist("c2", 1);
    const after = (await s.founderStore()).catalog.find((x) => x.id === "c2");
    expect(after.can_review).toBe(true);
  });

  it("accumulates shortlist qty and clears on push to procurement", async () => {
    const s = createArtInfraStore();
    await s.addToShortlist("c1", 2);
    await s.addToShortlist("c1", 3);
    let store = await s.founderStore();
    expect(store.shortlist[0].qty).toBe(5);
    expect(store.shortlist_subtotal).toBe(5 * store.shortlist[0].product.price);
    expect((await s.pushToProcurement()).pushed).toBe(1);
    expect((await s.founderStore()).shortlist).toHaveLength(0);
  });

  it("removes a shortlist line when qty drops to zero", async () => {
    const s = createArtInfraStore();
    await s.addToShortlist("c1", 2);
    await s.setShortlistQty("c1", 0);
    expect((await s.founderStore()).shortlist).toHaveLength(0);
  });

  it("moderates reviews and reports pending counts", async () => {
    const s = createArtInfraStore();
    const pending = await s.listReviews({ status: "pending" });
    expect(pending.length).toBeGreaterThan(0);
    const r = await s.moderateReview(pending[0].id, "approved");
    expect(r.status).toBe("approved");
    expect((await s.listReviews({ status: "pending" })).length).toBe(pending.length - 1);
  });

  it("reports never-shortlisted products in insights", async () => {
    const s = createArtInfraStore();
    await s.addToShortlist("c1", 1);
    const i = await s.insights();
    expect(i.neverShortlisted.some((p) => p.id === "c1")).toBe(false);
    expect(i.neverShortlisted.length).toBe(11);
  });

  it("creates a product when saveProduct has no id", async () => {
    const s = createArtInfraStore();
    const created = await s.saveProduct({
      name: "New rig", vendor_id: "knowles", category_id: "sensors",
      type: "Hardware", pricing: "fixed", price: 100,
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("draft");
    expect((await s.listProducts({})).total).toBe(13);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/artInfraMock.test.js`
Expected: FAIL — `Failed to resolve import "../artInfraMock"`.

- [ ] **Step 3: Implement the mock store**

```js
// frontend/src/lib/artInfraMock.js
//
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

const clone = (v) => JSON.parse(JSON.stringify(v));
const nextId = (rows, prefix) => `${prefix}${rows.length + 1}-${Date.now().toString(36)}`;
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The single founder the preview simulates.
const ME = "app-me";

export function createArtInfraStore(initial = seed) {
  const db = {
    vendors: clone(initial.vendors),
    categories: clone(initial.categories),
    products: clone(initial.products),
    datasheets: clone(SAMPLE_DATASHEETS),
    reviews: clone(SAMPLE_REVIEWS),
    shortlist: [],      // {product_id, qty}
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

    deleteProduct(id) {
      db.products = db.products.filter((p) => p.id !== id);
      db.datasheets = db.datasheets.filter((d) => d.product_id !== id);
      db.reviews = db.reviews.filter((r) => r.product_id !== id);
      return ok(undefined);
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
      return ok({
        perProduct,
        topShortlisted: [...perProduct]
          .filter((p) => p.shortlisted_by > 0)
          .sort((a, b) => b.shortlisted_by - a.shortlisted_by),
        neverShortlisted: perProduct.filter((p) => p.shortlisted_by === 0),
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
export const artInfraMock = createArtInfraStore();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/artInfraMock.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/artInfraMock.js frontend/src/lib/__tests__/artInfraMock.test.js
git commit -m "feat(art-infra): mock store exposing the Phase-2 API surface"
```

---

### Task 3: Extract the founder product card and modal

Preview-as-founder must mount the *real* founder UI, not a lookalike. That requires the card and modal to be standalone components. This task is a pure refactor: `FounderStore` renders identically afterwards.

**Files:**
- Create: `frontend/src/pages/founder/components/ProductCard.jsx`
- Create: `frontend/src/pages/founder/components/ProductModal.jsx`
- Test: `frontend/src/pages/founder/__tests__/ProductCard.test.jsx`
- Test: `frontend/src/pages/founder/__tests__/ProductModal.test.jsx`

`FounderStore.jsx` is NOT modified in this task — Task 4 rewrites it. This task
only adds the two components and their tests.

**Interfaces:**
- Consumes: founder product shape from Task 2's `founderView`.
- Produces: `<ProductCard product onOpen onPrimary busy />` and
  `<ProductModal product onClose onPrimary busy onSubmitReview />`.
  `onPrimary(product)` fires the shortlist action; `onSubmitReview(productId,{rating,body})`
  returns a Promise. Both are used by Task 4 and Task 7.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/founder/__tests__/ProductCard.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProductCard from "../components/ProductCard.jsx";

const base = {
  id: "c1", name: "MEMS array", blurb: "Acoustic sensing.",
  type: "Hardware", pricing: "fixed", price: 8200,
  vendor: { name: "Knowles" }, category: { label: "Sensors" },
  rating: { avg: 0, count: 0 }, in_shortlist_qty: 0,
};

describe("ProductCard", () => {
  it("shows Add to shortlist for fixed-price products", () => {
    render(<ProductCard product={base} onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add to shortlist" })).toBeInTheDocument();
  });

  it("shows Show contact for quote-priced products", () => {
    render(<ProductCard product={{ ...base, pricing: "quote", price: null }}
      onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show contact" })).toBeInTheDocument();
    expect(screen.getByText("On request")).toBeInTheDocument();
  });

  it("hides the rating line entirely when there are no approved reviews", () => {
    render(<ProductCard product={base} onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("shows the rating line when approved reviews exist", () => {
    render(<ProductCard product={{ ...base, rating: { avg: 4.5, count: 2 } }}
      onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByText("★ 4.5 · 2 reviews")).toBeInTheDocument();
  });

  it("fires onPrimary without opening the modal", () => {
    const onOpen = vi.fn(); const onPrimary = vi.fn();
    render(<ProductCard product={base} onOpen={onOpen} onPrimary={onPrimary} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to shortlist" }));
    expect(onPrimary).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/founder/__tests__/ProductCard.test.jsx`
Expected: FAIL — cannot resolve `../components/ProductCard.jsx`.

- [ ] **Step 3: Write ProductCard**

```jsx
// frontend/src/pages/founder/components/ProductCard.jsx
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
```

- [ ] **Step 4: Write ProductModal**

```jsx
// frontend/src/pages/founder/components/ProductModal.jsx
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
```

- [ ] **Step 5: Write the ProductModal test**

This test carries coverage forward from `FounderStore.test.jsx`, which Task 4 deletes. Without it, nothing tests the modal's contents.

```jsx
// frontend/src/pages/founder/__tests__/ProductModal.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProductModal from "../components/ProductModal.jsx";

const base = {
  id: "c1", name: "MEMS array", description: "A pre-calibrated array.",
  type: "Hardware", pricing: "fixed", price: 8200,
  vendor: { name: "Knowles", contact_name: "Asha Rao",
    contact_email: "asha@knowles.example", contact_phone: "+91 80 1234 5678",
    artpark_ref: "AP-KN-01" },
  category: { label: "Sensors" },
  specs: [{ k: "Channels", v: "8, matched ±1 dB" }],
  lead_time_weeks_min: 3, lead_time_weeks_max: 4,
  datasheets: [{ id: "d1", kind: "PDF", name: "Array datasheet (rev C)",
    external_url: "https://example.org/a.pdf" }],
  reviews: [{ id: "r1", author_name: "Rhea Nair", author_venture: "AuralDx",
    rating: 5, body: "Great array." }],
  rating: { avg: 5, count: 1 }, can_review: false, my_review: null,
};

const noop = () => {};

describe("ProductModal", () => {
  it("renders specs, the derived lead time, reviews and datasheets", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Lead time")).toBeInTheDocument();
    expect(screen.getByText("3–4 weeks")).toBeInTheDocument();
    expect(screen.getByText("Great array.")).toBeInTheDocument();
    expect(screen.getByText("Array datasheet (rev C)")).toBeInTheDocument();
  });

  it("hides the datasheets section entirely when there are none", () => {
    render(<ProductModal product={{ ...base, datasheets: [] }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.queryByText("Datasheets & docs")).not.toBeInTheDocument();
  });

  it("says there are no reviews yet rather than rendering an empty list", () => {
    render(<ProductModal product={{ ...base, reviews: [], rating: { avg: 0, count: 0 } }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument();
  });

  it("reveals the vendor contact for a quote-priced product", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.queryByText("asha@knowles.example")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show contact" }));
    expect(screen.getByText("asha@knowles.example")).toBeInTheDocument();
    expect(screen.getByText("AP-KN-01")).toBeInTheDocument();
  });

  it("tells a founder to shortlist before reviewing", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("Add this to your shortlist to leave a review.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your review")).not.toBeInTheDocument();
  });

  it("submits a review once the product is shortlisted", async () => {
    const onSubmitReview = vi.fn().mockResolvedValue({});
    render(<ProductModal product={{ ...base, can_review: true }}
      onClose={noop} onPrimary={noop} onSubmitReview={onSubmitReview} />);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "Solid." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(onSubmitReview).toHaveBeenCalledWith("c1", { rating: 5, body: "Solid." });
  });
});
```

- [ ] **Step 6: Run both component test files to verify they pass**

Run: `cd frontend && npx vitest run src/pages/founder/__tests__/ProductCard.test.jsx src/pages/founder/__tests__/ProductModal.test.jsx`
Expected: PASS, 5 + 6 = 11 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/founder/components/ProductCard.jsx \
        frontend/src/pages/founder/components/ProductModal.jsx \
        frontend/src/pages/founder/__tests__/ProductCard.test.jsx \
        frontend/src/pages/founder/__tests__/ProductModal.test.jsx
git commit -m "feat(art-infra): extract founder ProductCard and ProductModal"
```

---

### Task 4: Rework the founder Art Infra page onto the mock

**Files:**
- Modify: `frontend/src/pages/founder/FounderStore.jsx` (full rewrite of the component body)
- Modify: `frontend/src/lib/founderApi.js` (remove `requestQuote`, line 66)
- Delete: `frontend/src/pages/founder/__tests__/FounderStore.test.jsx` (superseded — see Step 6)
- Test: `frontend/src/pages/founder/__tests__/FounderStore.artinfra.test.jsx`

**Interfaces:**
- Consumes: `artInfraMock` (Task 2), `ProductCard` / `ProductModal` (Task 3).
- Produces: `<FounderStore store />` — `store` defaults to `artInfraMock`, and Task 7 passes a different store instance to render the preview pane.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/founder/__tests__/FounderStore.artinfra.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import FounderStore from "../FounderStore.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("FounderStore (Art Infra)", () => {
  it("renders the catalog and says Shortlist, never Cart", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Shortlist/ })).toBeInTheDocument());
    expect(screen.queryByText(/\bCart\b/)).not.toBeInTheDocument();
  });

  it("adds to the shortlist and shows the count and subtotal", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    await waitFor(() => expect(screen.getByTestId("shortlist-count")).toHaveTextContent("1"));
  });

  it("keeps the push-to-procurement wording", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Shortlist/ }));
    expect(await screen.findByRole("button", { name: /Push to procurement/ })).toBeInTheDocument();
  });

  it("never renders the old quote-request wording", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    expect(screen.queryByText("Request quote")).not.toBeInTheDocument();
    expect(screen.queryByText("Quote requested ✓")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Show contact" }).length).toBe(4);
  });

  it("filters to software only", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getByRole("button", { name: "Software" }));
    await waitFor(() => expect(screen.getAllByText("Software").length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/founder/__tests__/FounderStore.artinfra.test.jsx`
Expected: FAIL — the component still calls `founderApi.getStore()` and renders "Cart".

- [ ] **Step 3: Rewrite FounderStore**

```jsx
// frontend/src/pages/founder/FounderStore.jsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/founder/__tests__/FounderStore.artinfra.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Delete the now-dead quote-request API method**

Remove the `requestQuote` line (line 66) from `frontend/src/lib/founderApi.js`. Leave every other method untouched — `getStore`, `addToCart`, `setCartQty`, `pushCartToProcurement` stay for now, because Phase 2 rewires them.

- [ ] **Step 6: Delete the superseded test file**

```bash
git rm frontend/src/pages/founder/__tests__/FounderStore.test.jsx
```

This is a deliberate deletion, not a casualty. All four of its tests assert behaviour this task removes on purpose: it mocks `founderApi.getStore`, clicks `"Add to cart"`, and asserts `"Cart · 1 items"`, `"Request quote"` and `"Quote requested ✓"`. It also builds products in the old shape (`vendor` as a string, `cat`, reviews keyed `name`/`company`/`text`), which no longer exists. Amending it would mean rewriting every line.

Its modal coverage — specs, reviews, datasheets — is replaced by `ProductModal.test.jsx` from Task 3, and its filter and shortlist coverage by `FounderStore.artinfra.test.jsx` in this task. Do not delete it without confirming both of those exist and pass.

- [ ] **Step 7: Run the whole frontend suite**

Run: `cd frontend && npm test`
Expected: PASS. The pre-existing baseline is 2 known failures unrelated to this work — verify any failure against untouched `release/sip-launch-v1` before treating it as yours.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/founder/FounderStore.jsx \
        frontend/src/pages/founder/__tests__/FounderStore.artinfra.test.jsx \
        frontend/src/lib/founderApi.js
git rm --cached --ignore-unmatch frontend/src/pages/founder/__tests__/FounderStore.test.jsx
git commit -m "feat(art-infra): founder page on the mock — shortlist, show contact, real reviews"
```

---

### Task 5: Admin shell, sub-navigation and tab registration

**Files:**
- Create: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraShell.jsx`
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx` (tab list ~line 253; page switch ~line 411)
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except `artInfraMock`.
- Produces: `<ArtInfraShell store />` rendering a sub-nav over six views keyed
  `catalog | editor | vendors | categories | reviews | insights`, and passing
  `store` plus `goEditor(productId)` down to each. Tasks 6–11 fill the views in.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ArtInfraShell from "../artinfra/ArtInfraShell.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

describe("ArtInfraShell", () => {
  it("renders the six sub-nav entries", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    ["Catalog", "Vendors", "Categories", "Reviews", "Insights"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
  });

  it("starts on Catalog and switches view on click", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    expect(screen.getByRole("button", { name: "Catalog" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Vendors" }));
    expect(screen.getByRole("button", { name: "Vendors" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a pending-review badge from the store", async () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    expect(await screen.findByTestId("artinfra-pending-badge")).toHaveTextContent("2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx`
Expected: FAIL — cannot resolve `../artinfra/ArtInfraShell.jsx`.

- [ ] **Step 3: Write the shell**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraShell.jsx
//
// Sub-navigation for the six Art Infra admin views. The editor is not in the
// sub-nav: it is reached by opening a row from the catalog, the same way
// AdminDetail is reached from AdminPipeline.

import { useEffect, useState } from "react";
import { artInfraMock } from "../../../../../lib/artInfraMock.js";
import ArtInfraCatalog from "./ArtInfraCatalog.jsx";
import ArtInfraProductEditor from "./ArtInfraProductEditor.jsx";
import ArtInfraVendors from "./ArtInfraVendors.jsx";
import ArtInfraCategories from "./ArtInfraCategories.jsx";
import ArtInfraReviews from "./ArtInfraReviews.jsx";
import ArtInfraInsights from "./ArtInfraInsights.jsx";

const VIEWS = [
  { id: "catalog", label: "Catalog" },
  { id: "vendors", label: "Vendors" },
  { id: "categories", label: "Categories" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
];

export default function ArtInfraShell({ store = artInfraMock }) {
  const [view, setView] = useState("catalog");
  const [editingId, setEditingId] = useState(null);
  const [pending, setPending] = useState(0);

  const refreshPending = () =>
    store.listReviews({ status: "pending" }).then((r) => setPending(r.length));
  useEffect(() => { refreshPending(); }, [store, view]);

  const goEditor = (productId) => { setEditingId(productId); setView("editor"); };
  const backToCatalog = () => { setEditingId(null); setView("catalog"); };

  return (
    <div className="ai-admin">
      <nav className="ai-subnav" aria-label="Art Infra sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`ai-subnav-btn${view === v.id ? " is-on" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => { setEditingId(null); setView(v.id); }}
          >
            {v.label}
            {v.id === "reviews" && pending > 0 && (
              <span className="ai-badge" data-testid="artinfra-pending-badge">{pending}</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" className="os-btn" onClick={() => goEditor(null)}>
          + New product
        </button>
      </nav>

      {view === "catalog" && <ArtInfraCatalog store={store} goEditor={goEditor} />}
      {view === "editor" && (
        <ArtInfraProductEditor store={store} productId={editingId} onDone={backToCatalog} />
      )}
      {view === "vendors" && <ArtInfraVendors store={store} />}
      {view === "categories" && <ArtInfraCategories store={store} />}
      {view === "reviews" && <ArtInfraReviews store={store} onChange={refreshPending} />}
      {view === "insights" && <ArtInfraInsights store={store} />}
    </div>
  );
}
```

- [ ] **Step 4: Create the five view stubs so the shell imports resolve**

Create each of these five files with exactly this body, substituting the name. Tasks 6–11 replace them.

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCatalog.jsx
export default function ArtInfraCatalog() { return <div>Catalog</div>; }
```

Repeat for `ArtInfraProductEditor.jsx` (`ProductEditor`), `ArtInfraVendors.jsx` (`Vendors`), `ArtInfraCategories.jsx` (`Categories`), `ArtInfraReviews.jsx` (`Reviews`), `ArtInfraInsights.jsx` (`Insights`) — six stub files in total, each a default-exported component returning a single `<div>` with its name.

- [ ] **Step 5: Run the shell test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Register the tab in AdminPortal**

In `frontend/src/pages/admin/platform/AdminPortal.jsx`:

Add the import beside the other screen imports:

```jsx
import ArtInfraShell from "./screens/artinfra/ArtInfraShell.jsx";
```

In `AdminTabBar`'s `tabs` array, append after the `gate2` entry:

```jsx
    { id:'artinfra',      label:'Art Infra',    sub:'CATALOG · VENDORS',        badge:null },
```

In `AdminTopbar`'s `crumbMap`, add:

```jsx
    artinfra:'ART INFRA',
```

In `AdminApp`'s page switch, after the `aistatus` line:

```jsx
            {page === 'artinfra'   && <ArtInfraShell />}
```

- [ ] **Step 7: Verify the tab renders**

Run: `cd frontend && npm test`
Expected: PASS — no existing admin test asserts an exact tab count, but if one does, update it to include Art Infra rather than deleting the assertion.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx \
        frontend/src/pages/admin/platform/AdminPortal.jsx
git commit -m "feat(art-infra): admin shell, sub-nav and portal tab registration"
```

---

### Task 6: Catalog list screen

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCatalog.jsx` (replaces the Task 5 stub)
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCatalog.test.jsx`

**Interfaces:**
- Consumes: `store.listProducts`, `store.listVendors`, `store.listCategories`, `store.setProductStatus` (Task 2); `ListToolbar` from `../ListToolbar`.
- Produces: `<ArtInfraCatalog store goEditor />` where `goEditor(productId)` opens Task 7's editor.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCatalog.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraCatalog from "../artinfra/ArtInfraCatalog.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraCatalog", () => {
  it("lists all 12 products with the shared toolbar count", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    expect(await screen.findByText("12 of 12")).toBeInTheDocument();
  });

  it("filters by search", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "MEMS" } });
    await waitFor(() => expect(screen.getByText("1 of 12")).toBeInTheDocument());
  });

  it("filters by status segment", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    await waitFor(() => expect(screen.getByText("0 of 12")).toBeInTheDocument());
  });

  it("opens the editor for a row", async () => {
    const goEditor = vi.fn();
    render(<ArtInfraCatalog store={store} goEditor={goEditor} />);
    fireEvent.click(await screen.findByRole("button", { name: "MEMS microphone array (8-ch)" }));
    expect(goEditor).toHaveBeenCalledWith("c1");
  });

  it("retires a product from its row action", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    fireEvent.click(screen.getAllByRole("button", { name: "Retire" })[0]);
    await waitFor(() => expect(screen.getAllByText("retired").length).toBe(1));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraCatalog.test.jsx`
Expected: FAIL — the stub renders only the word "Catalog".

- [ ] **Step 3: Implement the catalog screen**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCatalog.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS_SEGMENTS = [
  ["", "All"], ["published", "Published"], ["draft", "Draft"], ["retired", "Retired"],
];

const fmtPrice = (p) =>
  p.pricing === "quote" ? "On request"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR",
        maximumFractionDigits: 0 }).format(p.price || 0);

export default function ArtInfraCatalog({ store, goEditor }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    const [{ items }, all] = await Promise.all([
      store.listProducts({ search, status, category }),
      store.listProducts({}),
    ]);
    setRows(items);
    setTotal(all.total);
  }, [store, search, status, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    store.listVendors().then(setVendors);
    store.listCategories().then(setCategories);
  }, [store]);

  const vendorName = useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);

  const setStatusFor = async (id, next) => { await store.setProductStatus(id, next); load(); };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Catalog"
        sub="Products founders see in the Art Infra tab. Draft items are invisible to them." />

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchLabel="Search products"
        searchPlaceholder="Search by product or vendor…"
        segments={[{
          ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS_SEGMENTS,
        }]}
        trailing={
          <select className="os-input" aria-label="Category"
            value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        }
        count={rows.length}
        total={total}
      />

      <table className="os-table">
        <thead>
          <tr>
            <th>Product</th><th>Vendor</th><th>Category</th><th>Type</th>
            <th>Price</th><th>Status</th><th>Reviews</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <button type="button" className="ai-linkbtn" onClick={() => goEditor(p.id)}>
                  {p.name}
                </button>
              </td>
              <td>{vendorName[p.vendor_id] || p.vendor?.name}</td>
              <td>{p.category?.label}</td>
              <td>{p.type}</td>
              <td>{fmtPrice(p)}</td>
              <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
              <td>
                {p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)} (${p.rating.count})` : "—"}
                {p.pending_reviews > 0 && <span className="ai-badge">{p.pending_reviews}</span>}
              </td>
              <td className="ai-row-actions">
                {p.status !== "published" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => setStatusFor(p.id, "published")}>Publish</button>
                )}
                {p.status === "published" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => setStatusFor(p.id, "retired")}>Retire</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="tbl-empty">No products match these filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraCatalog.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCatalog.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCatalog.test.jsx
git commit -m "feat(art-infra): admin catalog list on the shared ListToolbar"
```

---

### Task 7: Product editor with preview-as-founder

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraProductEditor.jsx` (replaces the Task 5 stub)
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraProductEditor.test.jsx`

**Interfaces:**
- Consumes: `store.getProduct`, `store.saveProduct`, `store.listVendors`, `store.listCategories` (Task 2); `ProductCard` and `ProductModal` (Task 3).
- Produces: `<ArtInfraProductEditor store productId onDone />`. `productId === null` means create.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraProductEditor.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraProductEditor from "../artinfra/ArtInfraProductEditor.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraProductEditor", () => {
  it("loads an existing product into the form", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("MEMS microphone array (8-ch)"));
  });

  it("renders a live preview card that reflects edits", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed rig" } });
    expect(within(screen.getByTestId("founder-preview")).getByText("Renamed rig")).toBeInTheDocument();
  });

  it("hides the price field for quote-priced products", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (₹)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    expect(screen.queryByLabelText("Price (₹)")).not.toBeInTheDocument();
  });

  it("clears the price when pricing switches to quote", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (\u20b9)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await store.getProduct("c1")).price).toBeNull());
  });

  it("adds and removes spec rows", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    const before = screen.getAllByLabelText(/Spec key/).length;
    fireEvent.click(screen.getByRole("button", { name: "+ Add spec" }));
    expect(screen.getAllByLabelText(/Spec key/).length).toBe(before + 1);
  });

  it("saves and calls onDone", async () => {
    const onDone = vi.fn();
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={onDone} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await store.getProduct("c1")).name).toBe("Saved name");
  });

  it("blocks saving without a name", async () => {
    render(<ArtInfraProductEditor store={store} productId={null} onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
```

Add `within` to the import from `@testing-library/react` at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraProductEditor.test.jsx`
Expected: FAIL — the stub renders only "ProductEditor".

- [ ] **Step 3: Implement the editor**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraProductEditor.jsx
//
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraProductEditor.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraProductEditor.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraProductEditor.test.jsx
git commit -m "feat(art-infra): product editor with live preview-as-founder"
```

---

### Task 8: Vendors screen

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraVendors.jsx`
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraVendors.test.jsx`

**Interfaces:**
- Consumes: `store.listVendors`, `store.saveVendor`, `store.deleteVendor` (Task 2).
- Produces: `<ArtInfraVendors store />`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraVendors.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraVendors from "../artinfra/ArtInfraVendors.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraVendors", () => {
  it("lists the 11 seeded vendors", async () => {
    render(<ArtInfraVendors store={store} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(12)); // 11 + header
  });

  it("edits a vendor contact and persists it", async () => {
    render(<ArtInfraVendors store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Knowles" }));
    fireEvent.change(screen.getByLabelText("Contact email"),
      { target: { value: "sales@knowles.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vendor" }));
    await waitFor(async () => {
      const v = (await store.listVendors()).find((x) => x.id === "knowles");
      expect(v.contact_email).toBe("sales@knowles.example");
    });
  });

  it("refuses to delete a vendor that products still reference", async () => {
    render(<ArtInfraVendors store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Knowles" }));
    expect(await screen.findByText(/still used by a product/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraVendors.test.jsx`
Expected: FAIL — the stub renders only "Vendors".

- [ ] **Step 3: Implement the vendors screen**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraVendors.jsx
import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

const BLANK = { id: null, name: "", contact_name: "", contact_email: "",
  contact_phone: "", artpark_ref: "", notes: "" };

export default function ArtInfraVendors({ store }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => store.listVendors().then(setRows), [store]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    await store.saveVendor(editing);
    setEditing(null);
    load();
  };

  const remove = async (vendor) => {
    setError("");
    try { await store.deleteVendor(vendor.id); load(); }
    catch (e) {
      setError(e.message === "vendor_in_use"
        ? `${vendor.name} is still used by a product — reassign those products first.`
        : e.message);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Vendors"
        sub="Contact details here are what a founder sees behind Show contact."
        actions={<button type="button" className="os-btn"
          onClick={() => setEditing({ ...BLANK })}>+ New vendor</button>} />

      {error && <div className="inline-error">{error}</div>}

      <table className="os-table">
        <thead>
          <tr><th>Vendor</th><th>Contact</th><th>Email</th><th>Phone</th><th>ARTPARK ref</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <td>{v.name}</td>
              <td>{v.contact_name || "—"}</td>
              <td>{v.contact_email || "—"}</td>
              <td>{v.contact_phone || "—"}</td>
              <td>{v.artpark_ref || "—"}</td>
              <td className="ai-row-actions">
                <button type="button" className="os-btn ghost" aria-label={`Edit ${v.name}`}
                  onClick={() => setEditing({ ...v })}>Edit</button>
                <button type="button" className="os-btn ghost" aria-label={`Delete ${v.name}`}
                  onClick={() => remove(v)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>{editing.id ? "Edit vendor" : "New vendor"}</h2></div>
            <div className="ai-form">
              {[
                ["name", "Name"], ["contact_name", "Contact name"],
                ["contact_email", "Contact email"], ["contact_phone", "Contact phone"],
                ["artpark_ref", "ARTPARK ref"], ["notes", "Notes"],
              ].map(([key, label]) => (
                <label key={key}>{label}
                  <input className="os-input" value={editing[key] || ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="os-btn" disabled={!editing.name.trim()}
                onClick={save}>Save vendor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraVendors.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraVendors.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraVendors.test.jsx
git commit -m "feat(art-infra): vendors screen with the contact block"
```

---

### Task 9: Categories screen

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCategories.jsx`
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCategories.test.jsx`

**Interfaces:**
- Consumes: `store.listCategories`, `store.saveCategory`, `store.deleteCategory` (Task 2).
- Produces: `<ArtInfraCategories store />`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCategories.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraCategories from "../artinfra/ArtInfraCategories.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraCategories", () => {
  it("lists the 8 seeded categories in sort order", async () => {
    render(<ArtInfraCategories store={store} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(9));
  });

  it("adds a category", async () => {
    render(<ArtInfraCategories store={store} />);
    await waitFor(() => screen.getByLabelText("New category label"));
    fireEvent.change(screen.getByLabelText("New category label"), { target: { value: "Optics" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(screen.getByText("Optics")).toBeInTheDocument());
  });

  it("refuses to delete a category still in use", async () => {
    render(<ArtInfraCategories store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sensors" }));
    expect(await screen.findByText(/still used by a product/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraCategories.test.jsx`
Expected: FAIL — the stub renders only "Categories".

- [ ] **Step 3: Implement the categories screen**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCategories.jsx
import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraCategories({ store }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => store.listCategories().then(setRows), [store]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!label.trim()) return;
    await store.saveCategory({ label: label.trim() });
    setLabel("");
    load();
  };

  const move = async (row, delta) => {
    await store.saveCategory({ ...row, sort: row.sort + delta });
    load();
  };

  const remove = async (row) => {
    setError("");
    try { await store.deleteCategory(row.id); load(); }
    catch (e) {
      setError(e.message === "category_in_use"
        ? `${row.label} is still used by a product — recategorise those products first.`
        : e.message);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Categories"
        sub="Category order controls the founder-facing filter order." />

      {error && <div className="inline-error">{error}</div>}

      <div className="ai-inline-add">
        <input className="os-input" aria-label="New category label" value={label}
          placeholder="e.g. Optics" onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="os-btn" onClick={add}>Add category</button>
      </div>

      <table className="os-table">
        <thead><tr><th>Category</th><th>Sort</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td>{c.sort}</td>
              <td className="ai-row-actions">
                <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} up`}
                  onClick={() => move(c, -1)}>↑</button>
                <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} down`}
                  onClick={() => move(c, 1)}>↓</button>
                <button type="button" className="os-btn ghost" aria-label={`Delete ${c.label}`}
                  onClick={() => remove(c)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraCategories.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraCategories.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraCategories.test.jsx
git commit -m "feat(art-infra): categories screen with sort ordering"
```

---

### Task 10: Review moderation screen

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraReviews.jsx`
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraReviews.test.jsx`

**Interfaces:**
- Consumes: `store.listReviews`, `store.moderateReview`, `store.deleteReview` (Task 2).
- Produces: `<ArtInfraReviews store onChange />`; `onChange()` refreshes the shell's pending badge.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraReviews.test.jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraReviews from "../artinfra/ArtInfraReviews.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraReviews", () => {
  it("opens on the pending queue", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(3)); // 2 pending + header
  });

  it("approves a review, removing it from the pending queue", async () => {
    const onChange = vi.fn();
    render(<ArtInfraReviews store={store} onChange={onChange} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(2));
    expect(onChange).toHaveBeenCalled();
  });

  it("shows approved reviews when the filter switches", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(3)); // 2 approved + header
  });

  it("names the product and the founder for each review", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    expect(await screen.findByText("GridSense")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraReviews.test.jsx`
Expected: FAIL — the stub renders only "Reviews".

- [ ] **Step 3: Implement the moderation screen**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraReviews.jsx
import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS = [["pending", "Pending"], ["approved", "Approved"], ["hidden", "Hidden"], ["", "All"]];

export default function ArtInfraReviews({ store, onChange }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");

  const load = useCallback(
    () => store.listReviews({ status }).then(setRows), [store, status]);
  useEffect(() => { load(); }, [load]);

  const act = async (id, next) => {
    if (next === "deleted") await store.deleteReview(id);
    else await store.moderateReview(id, next);
    await load();
    onChange?.();
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q
    || r.product_name.toLowerCase().includes(q)
    || r.author_name.toLowerCase().includes(q)
    || r.author_venture.toLowerCase().includes(q));

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Review moderation"
        sub="Founder reviews stay invisible to other founders until approved." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search reviews"
        searchPlaceholder="Product, founder or venture…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS }]}
        count={visible.length} total={rows.length}
      />

      <table className="os-table">
        <thead>
          <tr><th>Product</th><th>Founder</th><th>Rating</th><th>Review</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td>{r.product_name}</td>
              <td>{r.author_name}<div className="os-sub">{r.author_venture}</div></td>
              <td>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</td>
              <td className="ai-review-body">{r.body}</td>
              <td><span className={`ai-status ai-status-${r.status}`}>{r.status}</span></td>
              <td className="ai-row-actions">
                {r.status !== "approved" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => act(r.id, "approved")}>Approve</button>
                )}
                {r.status !== "hidden" && (
                  <button type="button" className="os-btn ghost"
                    onClick={() => act(r.id, "hidden")}>Hide</button>
                )}
                <button type="button" className="os-btn ghost"
                  onClick={() => act(r.id, "deleted")}>Delete</button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={6} className="tbl-empty">Nothing in this queue.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraReviews.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraReviews.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraReviews.test.jsx
git commit -m "feat(art-infra): review moderation queue"
```

---

### Task 11: Insights screen

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraInsights.jsx`
- Test: `frontend/src/pages/admin/platform/screens/__tests__/ArtInfraInsights.test.jsx`

**Interfaces:**
- Consumes: `store.insights()` → `{perProduct, topShortlisted, neverShortlisted}` (Task 2).
- Produces: `<ArtInfraInsights store />`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/ArtInfraInsights.test.jsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraInsights from "../artinfra/ArtInfraInsights.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraInsights", () => {
  it("reports every product as never shortlisted on a fresh store", async () => {
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByTestId("never-shortlisted-count")).toHaveTextContent("12");
  });

  it("moves a product out of never-shortlisted once shortlisted", async () => {
    await store.addToShortlist("c1", 1);
    render(<ArtInfraInsights store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("never-shortlisted-count")).toHaveTextContent("11"));
    expect(screen.getByTestId("top-shortlisted")).toHaveTextContent("MEMS microphone array (8-ch)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraInsights.test.jsx`
Expected: FAIL — the stub renders only "Insights".

- [ ] **Step 3: Implement the insights screen**

```jsx
// frontend/src/pages/admin/platform/screens/artinfra/ArtInfraInsights.jsx
import { useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraInsights({ store }) {
  const [data, setData] = useState(null);
  useEffect(() => { store.insights().then(setData); }, [store]);
  if (!data) return <div className="adm-async adm-async-empty">Loading…</div>;

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Insights"
        sub="What founders are actually shortlisting — use it to decide what to stock and what to retire." />

      <div className="ai-stats">
        <div className="ai-stat">
          <div className="ai-stat-num" data-testid="never-shortlisted-count">
            {data.neverShortlisted.length}
          </div>
          <div className="ai-stat-label">Never shortlisted</div>
        </div>
        <div className="ai-stat">
          <div className="ai-stat-num">{data.topShortlisted.length}</div>
          <div className="ai-stat-label">Shortlisted at least once</div>
        </div>
      </div>

      <div className="section-lbl">Most shortlisted</div>
      <table className="os-table" data-testid="top-shortlisted">
        <thead><tr><th>Product</th><th>Vendor</th><th>Founders</th><th>Rating</th></tr></thead>
        <tbody>
          {data.topShortlisted.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.vendor}</td><td>{p.shortlisted_by}</td>
              <td>{p.rating.count > 0 ? `★ ${p.rating.avg.toFixed(1)}` : "—"}</td>
            </tr>
          ))}
          {data.topShortlisted.length === 0 && (
            <tr><td colSpan={4} className="tbl-empty">Nothing shortlisted yet.</td></tr>
          )}
        </tbody>
      </table>

      <div className="section-lbl">Never shortlisted</div>
      <table className="os-table">
        <thead><tr><th>Product</th><th>Vendor</th><th>Status</th></tr></thead>
        <tbody>
          {data.neverShortlisted.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.vendor}</td>
              <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraInsights.test.jsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra/ArtInfraInsights.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ArtInfraInsights.test.jsx
git commit -m "feat(art-infra): shortlist insights screen"
```

---

### Task 12: Stylesheet, full verification, and push for the preview

**Files:**
- Create: `frontend/src/styles/art-infra-admin.css`
- Modify: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraShell.jsx` (import the stylesheet)

**Interfaces:**
- Consumes: class names emitted by Tasks 5–11 (`ai-subnav`, `ai-badge`, `ai-status`, `ai-editor`, `ai-spec-row`, `ai-stats`, `ai-row-actions`, `ai-inline-add`, `ai-form`, `ai-modal`, `ai-review-body`, `ai-linkbtn`, `vendor-contact`, `vc-row`).
- Pre-existing classes reused, all already defined — do not redefine them: `os-table`, `os-btn`, `os-input`, `os-sub`, `os-breadcrumb`, `tbl-empty`, `inline-error`, `adm-async adm-async-empty`, plus `lp-*` from `ListToolbar`. Tokens used: `--ink`, `--ink-soft`, `--line`, `--line-strong`, `--bg-paper`, `--bg-soft`, `--accent`. There is no `--bg-sunk` token in this codebase.
- Produces: nothing consumed by later tasks — this is the last one.

- [ ] **Step 1: Write the stylesheet**

```css
/* frontend/src/styles/art-infra-admin.css
   Scoped under .ai-admin so nothing leaks into the other admin screens.
   Colours come from the existing token set — no new palette. */

.ai-admin .ai-subnav {
  display: flex; align-items: center; gap: 4px;
  border-bottom: 1px solid var(--line); margin-bottom: 20px; padding-bottom: 8px;
}
.ai-admin .ai-subnav-btn {
  background: none; border: 1px solid transparent; border-radius: 3px;
  padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer;
  color: var(--ink-soft); display: inline-flex; align-items: center; gap: 6px;
}
.ai-admin .ai-subnav-btn:hover { background: var(--bg-soft); }
.ai-admin .ai-subnav-btn.is-on {
  background: var(--bg-paper); border-color: var(--line-strong); color: var(--ink);
  font-weight: 600;
}
.ai-admin .ai-badge {
  display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--accent); color: #fff; font-size: 11px; line-height: 18px;
  text-align: center;
}

.ai-admin .ai-status {
  display: inline-block; padding: 2px 8px; border-radius: 3px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
}
.ai-admin .ai-status-published { background: #e6f4ea; color: #1e6b34; }
.ai-admin .ai-status-draft     { background: #fdf3e0; color: #8a5a12; }
.ai-admin .ai-status-retired   { background: var(--bg-soft); color: var(--ink-soft); }
.ai-admin .ai-status-pending   { background: #fdf3e0; color: #8a5a12; }
.ai-admin .ai-status-approved  { background: #e6f4ea; color: #1e6b34; }
.ai-admin .ai-status-hidden    { background: var(--bg-soft); color: var(--ink-soft); }

.ai-admin .ai-row-actions { display: flex; gap: 6px; justify-content: flex-end; }
.ai-admin .ai-review-body { max-width: 380px; }

/* The codebase has no link-styled button class — AdminPipeline makes the whole
   row clickable instead. A real <button> is used here so the name is reachable
   by keyboard and addressable by role in tests, so the class is defined here. */
.ai-admin .ai-linkbtn {
  background: none; border: 0; padding: 0; font: inherit; text-align: left;
  color: var(--accent); cursor: pointer; text-decoration: underline;
}
.ai-admin .ai-linkbtn:hover { text-decoration: none; }

.ai-admin .ai-editor { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 28px; }
@media (max-width: 1100px) { .ai-admin .ai-editor { grid-template-columns: 1fr; } }
.ai-admin .ai-editor-form { display: flex; flex-direction: column; gap: 14px; }
.ai-admin .ai-editor-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.ai-admin .ai-editor-preview {
  border: 1px solid var(--line); background: var(--bg-soft); padding: 16px; align-self: start;
}
.ai-admin .ai-leadtime { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ai-admin .ai-spec-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; }

.ai-admin .ai-inline-add { display: flex; gap: 8px; margin-bottom: 16px; max-width: 480px; }
.ai-admin .ai-form { display: flex; flex-direction: column; gap: 12px; padding: 20px 24px; }
.ai-admin .ai-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.ai-admin .ai-modal { max-width: 520px; }
.ai-admin .ai-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 16px 24px; border-top: 1px solid var(--line);
}

.ai-admin .ai-stats { display: flex; gap: 20px; margin-bottom: 28px; }
.ai-admin .ai-stat { border: 1px solid var(--line); padding: 16px 20px; min-width: 160px; }
.ai-admin .ai-stat-num { font-size: 28px; font-weight: 700; }
.ai-admin .ai-stat-label { font-size: 12px; color: var(--ink-soft); text-transform: uppercase; }

/* Vendor contact block — founder-side, so it lives under .founder-portal. */
.founder-portal .vendor-contact {
  border: 1px solid var(--line); padding: 12px 14px; margin-top: 4px;
}
.founder-portal .vc-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 3px 0; }
.founder-portal .vc-row .k { color: var(--ink-soft); }
.founder-portal .rev-form { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.founder-portal .rev-form textarea { min-height: 70px; }
```

- [ ] **Step 2: Import it in the shell**

Add as the first import line of `ArtInfraShell.jsx`:

```jsx
import "../../../../../styles/art-infra-admin.css";
```

- [ ] **Step 3: Run the full test suite**

Run: `cd frontend && npm test`
Expected: PASS. Note the pre-existing frontend baseline is 2 known failures unrelated to this work — verify any failure against untouched `release/sip-launch-v1` before treating it as yours.

- [ ] **Step 4: Verify the production build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds and emits `dist/app.html`. A failure here almost always means an unresolved import path in the `artinfra/` directory — those files sit five levels deep, so `../../../../../lib/` is correct from `screens/artinfra/`.

- [ ] **Step 5: Manually walk the preview locally**

Run: `cd frontend && npm run dev`

Open the admin portal, click the **Art Infra** tab, and confirm each of these by eye:
1. Catalog lists 12 products; search, status segments and the category select all narrow the count.
2. Clicking a product name opens the editor; typing in Name updates the preview card live.
3. Switching Pricing to "On request" removes the Price field and the preview card shows "On request" with a **Show contact** button.
4. Vendors: editing Knowles' contact email persists; deleting Knowles is refused.
5. Categories: adding one appears; deleting Sensors is refused.
6. Reviews: two pending; Approve empties one and the sub-nav badge drops.
7. Insights: counts change after shortlisting something on the founder page.
8. Founder page (`/founder/store`): says **Shortlist** not Cart, quote items say **Show contact**, revealing contact shows the vendor block, products with no approved reviews show no star line, and the review form says "Add this to your shortlist to leave a review" until shortlisted.

- [ ] **Step 6: Commit and push for the Vercel preview**

```bash
git add frontend/src/styles/art-infra-admin.css \
        frontend/src/pages/admin/platform/screens/artinfra/ArtInfraShell.jsx
git commit -m "feat(art-infra): admin stylesheet and founder vendor-contact block"
git push -u origin feat/art-infra-admin
```

Vercel builds a preview from the pushed branch. **Do not promote it to production.** Report the preview URL to the user once the build finishes; Vercel mangles branch names in the URL slug (a previous branch `post_onboarding` became `postonboarding`), so read the URL from the Vercel dashboard rather than predicting it.

---

## Phase 2 — out of scope for this plan

Do not start any of this until the user has approved the preview:

- Migration `046_art_infra_catalog.sql` — five tables, seed of 12 products / 11 vendors / 8 categories, `founder_cart_items.product_id` text → uuid FK. Re-check the number against `feat/vip-onboarding`, which holds 043–045.
- `backend/app/routers/art_infra.py` at `/admin/art-infra`, plus `art_infra_query.py`.
- Founder endpoint rewire: `GET /founder/store` DB-backed, `POST /founder/store/{slug}/review` added, `POST /founder/store/quote-request` removed.
- RBAC `infra_manager` role in `rbac.py` and `rbac.js`, plus the mirror test.
- Supabase storage bucket for datasheet files and signed-URL reads.
- Swap `artInfraMock` for the real API client — one import change per screen, which is the reason the method names match.

## Self-review notes

- **Spec coverage:** all six admin screens map to Tasks 6–11; founder-side changes to Task 4; the design system constraint to Tasks 6/10 (ListToolbar) and Task 12 (stylesheet). Publish lifecycle is in Tasks 2 and 6; sort ordering in Tasks 2 and 9. **CSV import/export and audit writes from the spec are deliberately deferred to Phase 2** — both are meaningless against an in-memory mock that resets on reload, and neither can be judged in a UI review.
- **Type consistency:** every screen calls only methods declared in Task 2's Interfaces block; founder product fields (`rating`, `vendor`, `category`, `datasheets`, `can_review`, `my_review`, `in_shortlist_qty`) are produced by `founderView` and consumed unchanged by `ProductCard` / `ProductModal`.
- **Known gap:** datasheet *upload* is not implemented in Phase 1 — there is no storage to upload to. The editor shows no datasheet manager; the founder modal renders the two mock datasheets so the section's appearance can still be judged.
