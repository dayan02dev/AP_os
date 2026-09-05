import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VendorCatalog from "../VendorCatalog.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  const vendors = await store.adminListVendors();
  vendorId = vendors.find((v) => v.id === "knowles")?.id || vendors[0].id;
});

describe("VendorCatalog", () => {
  it("lists only this vendor's products", async () => {
    // artpark-fab has 2 published products -- enough to prove a real list,
    // unlike knowles's single product which satisfies `length > 1` (header +
    // one row) with no tenancy check at all. The discriminating half of this
    // test is the ABSENCE assertion: a reviewer swapped listVendorProducts for
    // adminListProducts({}) (all 12 products across all 11 vendors) and this
    // still passed when it only checked presence -- it must also prove a
    // named product belonging to a DIFFERENT vendor never renders here.
    const fabId = (await store.adminListVendors()).find((v) => v.id === "artpark-fab").id;
    render(<VendorCatalog store={store} vendorId={fabId} goEditor={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const { items } = await store.listVendorProducts(fabId);
    expect(items.length).toBeGreaterThan(1);
    for (const p of items) expect(screen.getByText(p.name)).toBeInTheDocument();

    // knowles's product must never appear on artpark-fab's My Catalog screen.
    expect(screen.queryByText("MEMS microphone array (8-ch)")).toBeNull();
  });

  it("shows the admin's send-back note on a returned draft", async () => {
    const p = await store.createVendorProduct(vendorId, { name: "Returned", category_id: "sensors" });
    await store.submitProduct(vendorId, p.id);
    await store.sendBackProduct(p.id, "Add a datasheet");
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText("Add a datasheet");
  });

  it("submits a draft for review", async () => {
    const p = await store.createVendorProduct(vendorId, { name: "Fresh", category_id: "sensors" });
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText("Fresh");
    fireEvent.click(screen.getByRole("button", { name: `Submit Fresh for review` }));
    await waitFor(async () => {
      const got = await store.getVendorProduct(vendorId, p.id);
      expect(got.status).toBe("pending_review");
    });
  });

  it("opens the editor when the name is clicked", async () => {
    const goEditor = vi.fn();
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={goEditor} />);
    const { items } = await store.listVendorProducts(vendorId);
    await screen.findByText(items[0].name);
    fireEvent.click(screen.getByRole("button", { name: items[0].name }));
    expect(goEditor).toHaveBeenCalledWith(items[0].id);
  });

  it("reports a load failure", async () => {
    configure({ failNext: "server_error" });
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText(/could not load/i);
  });

  it("ignores a stale response that lands after a newer one", async () => {
    // Guard proof: the screen must commit only the newest request's result,
    // even when an EARLIER request's response arrives LATER. With latency
    // pinned to 0ms (see beforeEach) every call is FIFO, so a stale response
    // could never physically land late and this test could pass with the
    // request-id guard deleted -- it never exercised a real race. To make
    // the race real, the "zzzz" search (fired first) is delayed with a real
    // setTimeout while every other call resolves immediately, so the "zzzz"
    // response is guaranteed to land AFTER the later, cleared-search response.
    const slowStore = {
      ...store,
      listVendorProducts: (vId, opts) => {
        const p = store.listVendorProducts(vId, opts);
        if (opts && opts.search === "zzzz") {
          return new Promise((resolve, reject) => {
            p.then((v) => setTimeout(() => resolve(v), 50), reject);
          });
        }
        return p;
      },
    };
    render(<VendorCatalog store={slowStore} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText("MEMS microphone array (8-ch)");

    const search = await screen.findByLabelText("Search products");
    fireEvent.change(search, { target: { value: "zzzz" } });   // slow: lands last, physically
    fireEvent.change(search, { target: { value: "" } });        // fast: should win the render

    // Give the deliberately-delayed "zzzz" response time to resolve and,
    // if the guard were broken, clobber the screen with "no products".
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(screen.queryByText(/no products/i)).toBeNull();
    expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument();
  });
});
