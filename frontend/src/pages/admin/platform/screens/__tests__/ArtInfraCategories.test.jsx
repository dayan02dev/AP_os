import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraCategories from "../artinfra/ArtInfraCategories.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import seed from "../../../../../lib/__fixtures__/artInfraSeed.json";

const rowLabels = () => screen.getAllByRole("row").slice(1) // drop the header row
  .map((row) => within(row).getAllByRole("cell")[0].textContent);

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

  it("moves the second category up on the first click, not the second", async () => {
    render(<ArtInfraCategories store={store} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(9));

    const before = rowLabels();
    expect(before).toEqual([
      "Sensors", "Boards", "Compute", "Prototyping",
      "Fabrication", "Components", "Power", "Software",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move Boards up" }));

    await waitFor(() => {
      expect(rowLabels()).toEqual([
        "Boards", "Sensors", "Compute", "Prototyping",
        "Fabrication", "Components", "Power", "Software",
      ]);
    });
  });

  it("shows an error instead of an empty table when the load fails", async () => {
    const badStore = { listCategories: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<ArtInfraCategories store={badStore} />);
    expect(await screen.findByText(/could not load categories/i)).toBeInTheDocument();
    expect(screen.queryByText("No categories yet.")).not.toBeInTheDocument();
  });
});
