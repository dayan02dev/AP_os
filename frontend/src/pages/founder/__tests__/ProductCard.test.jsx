import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProductCard from "../components/ProductCard.jsx";

const base = {
  id: "c1", name: "MEMS array", blurb: "Acoustic sensing.",
  type: "Hardware", pricing: "fixed", price: 8200,
  vendor: { name: "Knowles" }, category: { label: "Sensors" },
  rating: { avg: 0, count: 0 }, in_shortlist_qty: 0,
};

describe("ProductCard", () => {
  it("shows Add to shortlist for fixed-price products", () => {
    render(<ProductCard product={base} onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add to shortlist" })).toBeInTheDocument();
  });

  it("shows Show contact for quote-priced products", () => {
    render(<ProductCard product={{ ...base, pricing: "quote", price: null }}
      onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show contact" })).toBeInTheDocument();
    expect(screen.getByText("On request")).toBeInTheDocument();
  });

  it("hides the rating line entirely when there are no approved reviews", () => {
    render(<ProductCard product={base} onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it("shows the rating line when approved reviews exist", () => {
    render(<ProductCard product={{ ...base, rating: { avg: 4.5, count: 2 } }}
      onOpen={vi.fn()} onPrimary={vi.fn()} />);
    expect(screen.getByText("★ 4.5 · 2 reviews")).toBeInTheDocument();
  });

  it("fires onPrimary without opening the modal", () => {
    const onOpen = vi.fn(); const onPrimary = vi.fn();
    render(<ProductCard product={base} onOpen={onOpen} onPrimary={onPrimary} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to shortlist" }));
    expect(onPrimary).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
