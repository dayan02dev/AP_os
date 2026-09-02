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
