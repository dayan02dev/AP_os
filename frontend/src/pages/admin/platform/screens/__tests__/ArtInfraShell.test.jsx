import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ArtInfraShell from "../artinfra/ArtInfraShell.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

describe("ArtInfraShell", () => {
  it("renders the six sub-nav entries", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    ["Catalog", "Vendors", "Categories", "Reviews", "Insights"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
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
});
