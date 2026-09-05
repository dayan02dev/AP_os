import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraShell from "../artinfra/ArtInfraShell.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

beforeEach(() => {
  // Pin latency: the mock resolves with 40-260ms jitter by default, which
  // makes findBy* timeouts race under parallel load. resetLatency() already
  // runs in the global setup, so this only needs to set the floor.
  configure({ minMs: 0, maxMs: 0 });
});

describe("ArtInfraShell", () => {
  it("renders the six sub-nav entries plus New product (editor is not in the sub-nav)", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    ["Catalog", "Vendors", "Categories", "Requests", "Reviews", "Insights"].forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "+ New product" })).toBeInTheDocument();
  });

  it("starts on Catalog and switches view on click", () => {
    render(<ArtInfraShell store={createArtInfraStore()} />);
    expect(screen.getByRole("button", { name: "Catalog" })).toHaveAttribute("aria-current", "page");
    // Nothing Vendors-only rendered yet -- proves the baseline before we click.
    expect(screen.queryByRole("button", { name: "+ Invite vendor" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vendors" }));

    expect(screen.getByRole("button", { name: "Vendors" })).toHaveAttribute("aria-current", "page");
    // Something only the Vendors screen renders, so this fails if a view
    // branch were deleted even though aria-current still flips correctly.
    expect(screen.getByRole("button", { name: "+ Invite vendor" })).toBeInTheDocument();
  });

  it("shows a pending-review badge from the store", async () => {
    // SAMPLE_REVIEWS seeds exactly one pending review (plus one approved).
    render(<ArtInfraShell store={createArtInfraStore()} />);
    expect(await screen.findByTestId("artinfra-pending-badge")).toHaveTextContent("1");
  });

  it("does not crash when the pending-badge fetch rejects", async () => {
    const badStore = {
      listVendorReviews: vi.fn().mockRejectedValue(new Error("boom")),
      listRequests: vi.fn().mockRejectedValue(new Error("boom")),
      adminListProducts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      adminListVendors: vi.fn().mockResolvedValue([]),
      listCategories: vi.fn().mockResolvedValue([]),
    };
    render(<ArtInfraShell store={badStore} />);
    await screen.findByRole("button", { name: "Catalog" });
    expect(screen.queryByTestId("artinfra-pending-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artinfra-requests-badge")).not.toBeInTheDocument();
  });
});
