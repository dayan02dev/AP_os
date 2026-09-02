import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProductModal from "../components/ProductModal.jsx";

const base = {
  id: "c1", name: "MEMS array", description: "A pre-calibrated array.",
  type: "Hardware", pricing: "fixed", price: 8200,
  vendor: { name: "Knowles", contact_name: "Asha Rao",
    contact_email: "asha@knowles.example", contact_phone: "+91 80 1234 5678",
    artpark_ref: "AP-KN-01" },
  category: { label: "Sensors" },
  specs: [{ k: "Channels", v: "8, matched ±1 dB" }],
  lead_time_weeks_min: 3, lead_time_weeks_max: 4,
  datasheets: [{ id: "d1", kind: "PDF", name: "Array datasheet (rev C)",
    external_url: "https://example.org/a.pdf" }],
  reviews: [{ id: "r1", author_name: "Rhea Nair", author_venture: "AuralDx",
    rating: 5, body: "Great array." }],
  rating: { avg: 5, count: 1 }, can_review: false, my_review: null,
};

const noop = () => {};

describe("ProductModal", () => {
  it("renders specs, the derived lead time, reviews and datasheets", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Lead time")).toBeInTheDocument();
    expect(screen.getByText("3–4 weeks")).toBeInTheDocument();
    expect(screen.getByText("Great array.")).toBeInTheDocument();
    expect(screen.getByText("Array datasheet (rev C)")).toBeInTheDocument();
  });

  it("hides the datasheets section entirely when there are none", () => {
    render(<ProductModal product={{ ...base, datasheets: [] }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.queryByText("Datasheets & docs")).not.toBeInTheDocument();
  });

  it("says there are no reviews yet rather than rendering an empty list", () => {
    render(<ProductModal product={{ ...base, reviews: [], rating: { avg: 0, count: 0 } }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument();
  });

  it("reveals the vendor contact for a quote-priced product", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null }}
      onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.queryByText("asha@knowles.example")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show contact" }));
    expect(screen.getByText("asha@knowles.example")).toBeInTheDocument();
    expect(screen.getByText("AP-KN-01")).toBeInTheDocument();
  });

  it("tells a founder to shortlist before reviewing", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop} onSubmitReview={noop} />);
    expect(screen.getByText("Add this to your shortlist to leave a review.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your review")).not.toBeInTheDocument();
  });

  it("submits a review once the product is shortlisted", async () => {
    const onSubmitReview = vi.fn().mockResolvedValue({});
    render(<ProductModal product={{ ...base, can_review: true }}
      onClose={noop} onPrimary={noop} onSubmitReview={onSubmitReview} />);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "Solid." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(onSubmitReview).toHaveBeenCalledWith("c1", { rating: 5, body: "Solid." });
  });
});
