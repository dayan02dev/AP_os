import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraCatalog from "../artinfra/ArtInfraCatalog.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
});

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

  it("retires a published product back to draft with a note", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    fireEvent.click(screen.getAllByRole("button", { name: "Retire" })[0]);
    await waitFor(() => expect(screen.getAllByText("draft").length).toBe(1));
  });

  it("filters by type", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "Software" } });
    await waitFor(() => expect(screen.getByText("4 of 12")).toBeInTheDocument());
  });

  it("filters by vendor", async () => {
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    await screen.findByText("12 of 12");
    await waitFor(() =>
      expect(within(screen.getByLabelText("Vendor")).getByText("Knowles")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Vendor"), { target: { value: "knowles" } });
    await waitFor(() => expect(screen.getByText("1 of 12")).toBeInTheDocument());
  });

  it("publishes a product that is awaiting review", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "Awaiting", category_id: "sensors" });
    await store.submitProduct(v.id, p.id);
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    const seg = await screen.findByRole("button", { name: "In review" });
    fireEvent.click(seg);
    await screen.findByText("Awaiting");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(async () => {
      const { items } = await store.adminListProducts({ status: "published" });
      expect(items.some((x) => x.id === p.id)).toBe(true);
    });
  });

  it("sends a product back with a required note", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "Thin", category_id: "sensors" });
    await store.submitProduct(v.id, p.id);
    render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "In review" }));
    await screen.findByText("Thin");
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.change(await screen.findByLabelText("What needs fixing?"),
      { target: { value: "Add specs" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(async () => {
      const got = await store.getVendorProduct(v.id, p.id);
      expect(got.status).toBe("draft");
      expect(got.review_note).toBe("Add specs");
    });
  });

  it("shows an error instead of an empty table when the load fails", async () => {
    const badStore = {
      adminListProducts: vi.fn().mockRejectedValue(new Error("boom")),
      adminListVendors: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
    };
    render(<ArtInfraCatalog store={badStore} goEditor={vi.fn()} />);
    expect(await screen.findByText(/could not load the catalog/i)).toBeInTheDocument();
    expect(screen.queryByText("No products match these filters.")).not.toBeInTheDocument();
  });
});
