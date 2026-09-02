import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraCategories from "../artinfra/ArtInfraCategories.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import seed from "../../../../../lib/__fixtures__/artInfraSeed.json";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraCategories", () => {
  it("lists the 8 seeded categories in sort order", async () => {
    render(<ArtInfraCategories store={store} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(9));

    const expected = [...seed.categories].sort((a, b) => a.sort - b.sort).map((c) => c.label);
    const dataRows = screen.getAllByRole("row").slice(1); // drop the header row
    const rendered = dataRows.map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(rendered).toEqual(expected);
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

  it("clears a stale refusal banner after a later successful add", async () => {
    render(<ArtInfraCategories store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sensors" }));
    expect(await screen.findByText(/still used by a product/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New category label"), { target: { value: "Optics" } });
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() => {
      expect(screen.queryByText(/still used by a product/i)).not.toBeInTheDocument();
    });
  });
});
