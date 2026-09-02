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
