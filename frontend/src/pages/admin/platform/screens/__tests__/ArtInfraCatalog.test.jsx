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
