import { describe, it, expect, beforeEach } from "vitest";
import { createArtInfraStore } from "../artInfraMock.js";
import { configure, resetLatency } from "../artInfraLatency.js";

const ME = "app-me";
let store;

beforeEach(() => {
  resetLatency();
  configure({ minMs: 0, maxMs: 0 });   // deterministic in tests
  store = createArtInfraStore();
});

describe("disclosure rule — the security-relevant contract", () => {
  it("omits the contact block entirely when there is no approved request", async () => {
    const { catalog } = await store.founderStore();
    const p = catalog[0];
    expect(p.contact_state).toBe("none");
    // Absent from the PAYLOAD, not merely hidden in the UI.
    expect(p.vendor.contact_email).toBeUndefined();
    expect(p.vendor.contact_phone).toBeUndefined();
    expect(p.vendor.contact_name).toBeUndefined();
  });

  it("still omits it while the request is only pending", async () => {
    const before = await store.founderStore();
    await store.createRequest({ product_id: before.catalog[0].id, note: "need 4" });
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("pending");
    expect(after.catalog[0].vendor.contact_email).toBeUndefined();
  });

  it("includes it once the request is approved", async () => {
    const before = await store.founderStore();
    const req = await store.createRequest({ product_id: before.catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("approved");
    expect(after.catalog[0].vendor).toHaveProperty("contact_email");
  });

  it("unlocks EVERY product from that vendor, not just the one requested", async () => {
    const before = await store.founderStore();
    const target = before.catalog[0];
    const sibling = before.catalog.find(
      (p) => p.vendor.id === target.vendor.id && p.id !== target.id);
    const req = await store.createRequest({ product_id: target.id, note: "x" });
    await store.approveRequest(req.id);
    const after = await store.founderStore();
    if (sibling) {
      const s = after.catalog.find((p) => p.id === sibling.id);
      expect(s.contact_state).toBe("approved");
      expect(s.vendor).toHaveProperty("contact_email");
    }
    // A DIFFERENT vendor must stay locked.
    const other = after.catalog.find((p) => p.vendor.id !== target.vendor.id);
    expect(other.contact_state).toBe("none");
    expect(other.vendor.contact_email).toBeUndefined();
  });

  it("re-locks a declined request", async () => {
    const before = await store.founderStore();
    const req = await store.createRequest({ product_id: before.catalog[0].id, note: "x" });
    await store.declineRequest(req.id, "Out of budget");
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("declined");
    expect(after.catalog[0].vendor.contact_email).toBeUndefined();
    expect(after.catalog[0].request_note).toBe("Out of budget");
  });
});

describe("write methods reject unknown fields", () => {
  it("refuses a product patch carrying read-model junk", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "X", category_id: "sensors" });
    // `vendor`, `rating` and `pending_reviews` are READ-model fields.
    await expect(
      store.updateVendorProduct(v.id, p.id, {
        name: "Y", vendor: { id: v.id }, rating: { avg: 5, count: 1 },
      }),
    ).rejects.toThrow(/unwritable_fields/);
  });

  it("refuses a request patch with an unexpected key", async () => {
    const { catalog } = await store.founderStore();
    await expect(
      store.createRequest({ product_id: catalog[0].id, note: "x", status: "approved" }),
    ).rejects.toThrow(/unwritable_fields/);
  });
});

describe("vendor scoping", () => {
  it("never returns another vendor's products", async () => {
    const vendors = await store.adminListVendors();
    const { items } = await store.listVendorProducts(vendors[0].id);
    for (const p of items) expect(p.vendor_id).toBe(vendors[0].id);
  });

  it("refuses to mutate a product belonging to another vendor", async () => {
    const vendors = await store.adminListVendors();
    const { items } = await store.listVendorProducts(vendors[0].id);
    if (items.length) {
      const other = vendors.find((v) => v.id !== vendors[0].id);
      await expect(
        store.updateVendorProduct(other.id, items[0].id, { name: "hijack" }),
      ).rejects.toThrow(/not_found/);
    }
  });
});

describe("survives destructuring — no `this` anywhere", () => {
  it("works when methods are pulled off the store", async () => {
    const { founderStore, addToShortlist, setShortlistQty } = store;
    const { catalog } = await founderStore();
    await addToShortlist(catalog[0].id, 2);
    // Phase 1's setShortlistQty called this.removeFromShortlist and broke here.
    await setShortlistQty(catalog[0].id, 0);
    const after = await founderStore();
    expect(after.shortlist).toHaveLength(0);
  });
});

describe("product lifecycle", () => {
  it("moves draft -> pending_review -> published", async () => {
    const [v] = await store.adminListVendors();
    let p = await store.createVendorProduct(v.id, { name: "New", category_id: "sensors" });
    expect(p.status).toBe("draft");
    p = await store.submitProduct(v.id, p.id);
    expect(p.status).toBe("pending_review");
    p = await store.publishProduct(p.id);
    expect(p.status).toBe("published");
  });

  it("send-back returns it to draft with the admin's note", async () => {
    const [v] = await store.adminListVendors();
    let p = await store.createVendorProduct(v.id, { name: "New", category_id: "sensors" });
    p = await store.submitProduct(v.id, p.id);
    p = await store.sendBackProduct(p.id, "Add a datasheet");
    expect(p.status).toBe("draft");
    expect(p.review_note).toBe("Add a datasheet");
  });

  it("hides non-published products from the founder catalog", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "Hidden", category_id: "sensors" });
    const { catalog } = await store.founderStore();
    expect(catalog.find((c) => c.id === p.id)).toBeUndefined();
  });
});

describe("reviews are vendor-level and gated on an approved request", () => {
  it("refuses a review with no approved request", async () => {
    const { catalog } = await store.founderStore();
    await expect(
      store.submitVendorReview(catalog[0].vendor.id, { rating: 5, body: "great" }),
    ).rejects.toThrow(/not_eligible/);
  });

  it("accepts one once the request is approved", async () => {
    const { catalog } = await store.founderStore();
    const req = await store.createRequest({ product_id: catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const r = await store.submitVendorReview(catalog[0].vendor.id, {
      rating: 5, body: "Responsive" });
    expect(r.status).toBe("pending");
    expect(r.application_id).toBe(ME);
  });

  it("shows an approved vendor rating on every product from that vendor", async () => {
    // Sample-free: SAMPLE_REVIEWS seeds an approved 5-star review for `knowles`,
    // which is catalog[0]'s vendor, so the shared store's mean would be 4.5.
    // This test is about the aggregation rule, not about the fixture's fiction.
    const store = createArtInfraStore(undefined, { seedSamples: false });
    const { catalog } = await store.founderStore();
    const vendorId = catalog[0].vendor.id;
    const req = await store.createRequest({ product_id: catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const r = await store.submitVendorReview(vendorId, { rating: 4, body: "Good" });
    await store.moderateVendorReview(r.id, "approved");
    const after = await store.founderStore();
    for (const p of after.catalog.filter((x) => x.vendor.id === vendorId)) {
      expect(p.rating.count).toBeGreaterThan(0);
      expect(p.rating.avg).toBe(4);
    }
  });
});

describe("injected failure surfaces to the caller", () => {
  it("rejects when the harness is told to fail", async () => {
    configure({ failNext: "server_error" });
    await expect(store.founderStore()).rejects.toThrow("server_error");
  });
});
