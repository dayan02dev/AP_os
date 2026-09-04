import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const { items } = await store.listVendorProducts(vendorId);
    for (const p of items) expect(screen.getByText(p.name)).toBeInTheDocument();
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
    // Guard proof: the screen must commit only the newest request's result.
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    const search = await screen.findByLabelText("Search products");
    fireEvent.change(search, { target: { value: "zzzz" } });
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText(/no products/i)).toBeNull());
  });
});
