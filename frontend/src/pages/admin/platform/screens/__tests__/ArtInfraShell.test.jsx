import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ArtInfraShell from "../artinfra/ArtInfraShell.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

describe("ArtInfraShell", () => {
  it("renders the five sub-nav entries plus New product (editor is not in the sub-nav)", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    ["Catalog", "Vendors", "Categories", "Reviews", "Insights"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "+ New product" })).toBeInTheDocument();
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

  it("does not crash when the pending-badge fetch rejects", async () => {
    const badStore = {
      listReviews: vi.fn().mockRejectedValue(new Error("boom")),
      listProducts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listVendors: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
    };
    render(<ArtInfraShell store={badStore} />);
    await screen.findByRole("button", { name: "Catalog" });
    expect(screen.queryByTestId("artinfra-pending-badge")).not.toBeInTheDocument();
  });
});
