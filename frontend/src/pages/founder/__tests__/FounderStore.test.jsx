import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderStore from "../FounderStore.jsx";
import { founderApi } from "../../../lib/founderApi.js";

function product(over = {}) {
  return {
    id: "c1", name: "MEMS microphone array (8-ch)", vendor: "Knowles", cat: "Sensors",
    type: "Hardware", pricing: "fixed", price: 8200,
    blurb: "Low-noise 8-channel MEMS array for acoustic sensing.",
    desc: "A pre-calibrated 8-microphone MEMS array.",
    specs: [{ k: "Channels", v: "8, matched ±1 dB" }],
    datasheets: [{ kind: "PDF", name: "Array datasheet (rev C)" }],
    reviews: [{ name: "Rohan Iyer", company: "AuralDx", rating: 5, text: "Great array." }],
    in_cart_qty: 0, quote_requested: false,
    ...over,
  };
}
function quoteProduct(over = {}) {
  return product({
    id: "c6", name: "Custom enclosure CNC machining", vendor: "Precision Enclosures",
    cat: "Fabrication", pricing: "quote", price: 0, quote_requested: false,
    ...over,
  });
}
function bundle(overrides = {}) {
  return { catalog: [product(), quoteProduct()], cart: [], cart_subtotal: 0, ...overrides };
}

describe("FounderStore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the catalog and filters by type", async () => {
    vi.spyOn(founderApi, "getStore").mockResolvedValue(bundle());
    render(<FounderStore />);

    await waitFor(() => expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument());
    expect(screen.getByText("Custom enclosure CNC machining")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quote-based" }));
    await waitFor(() => expect(screen.queryByText("MEMS microphone array (8-ch)")).not.toBeInTheDocument());
    expect(screen.getByText("Custom enclosure CNC machining")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hardware" }));
    await waitFor(() => expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument());
  });

  it("adds a fixed-price product to the cart and shows it in the popover", async () => {
    vi.spyOn(founderApi, "getStore")
      .mockResolvedValueOnce(bundle())
      .mockResolvedValueOnce(bundle({
        cart: [{ product_id: "c1", qty: 1, product: product() }],
        cart_subtotal: 8200,
      }));
    vi.spyOn(founderApi, "addToCart").mockResolvedValue({});
    render(<FounderStore />);

    await waitFor(() => expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Add to cart")[0]);
    await waitFor(() => expect(founderApi.addToCart).toHaveBeenCalledWith("c1", 1));

    fireEvent.click(screen.getByRole("button", { name: /Cart/ }));
    await waitFor(() => expect(screen.getByText(/8,200 each/)).toBeInTheDocument());
    expect(screen.getByText("Cart · 1 items")).toBeInTheDocument();
  });

  it("flips the quote CTA to Quote requested after requesting", async () => {
    vi.spyOn(founderApi, "getStore")
      .mockResolvedValueOnce(bundle())
      .mockResolvedValueOnce(bundle({ catalog: [product(), quoteProduct({ quote_requested: true })] }));
    vi.spyOn(founderApi, "requestQuote").mockResolvedValue({ quote_requested: true });
    render(<FounderStore />);

    await waitFor(() => expect(screen.getByText("Request quote")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Request quote"));

    await waitFor(() => expect(founderApi.requestQuote).toHaveBeenCalledWith("c6"));
    await waitFor(() => expect(screen.getByText("Quote requested ✓")).toBeInTheDocument());
  });

  it("opens the product modal with specs, reviews, and datasheets", async () => {
    vi.spyOn(founderApi, "getStore").mockResolvedValue(bundle());
    render(<FounderStore />);

    await waitFor(() => expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MEMS microphone array (8-ch)"));

    await waitFor(() => expect(screen.getByText("Founder reviews")).toBeInTheDocument());
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Array datasheet (rev C)")).toBeInTheDocument();
  });
});
