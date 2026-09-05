import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProductModal from "../components/ProductModal.jsx";

const base = {
  id: "c1", name: "MEMS array", description: "A pre-calibrated array.",
  type: "Hardware", pricing: "fixed", price: 8200,
  vendor: { id: "knowles", name: "Knowles" },
  category: { label: "Sensors" },
  spec_fields: [{ key: "channels", label: "Channels", data_type: "text",
    unit: null, enum_options: null, sort: 0 }],
  specs: { channels: "8, matched ±1 dB" },
  extra_specs: [],
  lead_time_weeks_min: 3, lead_time_weeks_max: 4,
  datasheets: [{ id: "d1", kind: "PDF", name: "Array datasheet (rev C)",
    external_url: "https://example.org/a.pdf" }],
  reviews: [{ id: "r1", author_name: "Rhea Nair", author_venture: "AuralDx",
    rating: 5, body: "Great array." }],
  rating: { avg: 5, count: 1 }, can_review: false, my_review: null,
  contact_state: "none", request_id: null, request_note: "",
};

const noop = () => {};
const noopAsync = () => Promise.resolve({});

describe("ProductModal", () => {
  it("renders specs from the registry, the derived lead time, reviews and datasheets", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop}
      onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("8, matched ±1 dB")).toBeInTheDocument();
    expect(screen.getByText("Lead time")).toBeInTheDocument();
    expect(screen.getByText("3–4 weeks")).toBeInTheDocument();
    expect(screen.getByText("Great array.")).toBeInTheDocument();
    expect(screen.getByText("Array datasheet (rev C)")).toBeInTheDocument();
  });

  it("renders extra_specs alongside registry fields", () => {
    render(<ProductModal
      product={{ ...base, extra_specs: [{ k: "Note", v: "Legacy free-text field" }] }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("Legacy free-text field")).toBeInTheDocument();
  });

  it("omits a spec row whose value is empty", () => {
    render(<ProductModal product={{ ...base, specs: { channels: "" } }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
  });

  it("hides the datasheets section entirely when there are none", () => {
    render(<ProductModal product={{ ...base, datasheets: [] }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.queryByText("Datasheets & docs")).not.toBeInTheDocument();
  });

  it("says there are no reviews yet rather than rendering an empty list", () => {
    render(<ProductModal product={{ ...base, reviews: [], rating: { avg: 0, count: 0 } }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument();
  });

  it("opens the request form for a quote-priced product with no request yet", async () => {
    const onRequestContact = vi.fn().mockResolvedValue({});
    render(<ProductModal product={{ ...base, pricing: "quote", price: null }}
      onClose={noop} onPrimary={noop} onRequestContact={onRequestContact} onSubmitReview={noop} />);
    expect(screen.queryByLabelText("What do you need?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request contact" }));
    fireEvent.change(screen.getByLabelText("What do you need?"),
      { target: { value: "4 units by October" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(onRequestContact).toHaveBeenCalledWith("c1", "4 units by October");
  });

  it("shows a pending state instead of the form", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null, contact_state: "pending" }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByRole("button", { name: "Requested — awaiting approval" })).toBeDisabled();
    expect(screen.getByText("ARTPARK is reviewing your request.")).toBeInTheDocument();
    expect(screen.queryByLabelText("What do you need?")).not.toBeInTheDocument();
  });

  it("shows the decline reason and lets the founder try again", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null,
      contact_state: "declined", request_note: "Vendor is out of stock." }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText("Declined: Vendor is out of stock.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request declined" })).not.toBeDisabled();
  });

  it("reveals the vendor contact only once approved, never before", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null,
      contact_state: "approved",
      vendor: { id: "knowles", name: "Knowles", contact_name: "Asha Rao",
        contact_email: "asha@knowles.example", contact_phone: "+91 80 1234 5678",
        artpark_ref: "AP-KN-01" } }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText("asha@knowles.example")).toBeInTheDocument();
    expect(screen.getByText("AP-KN-01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact available" })).toBeInTheDocument();

    // The "never before" half: for none/pending/declined the contact section
    // must be entirely absent from the DOM, not merely visually hidden. Each
    // fixture genuinely omits the contact fields, as the real payload does --
    // a component bug that always renders the section would still pass if the
    // fixture carried contact data it just chose not to show.
    const noContactVendor = { id: "knowles", name: "Knowles" };
    for (const state of ["none", "pending", "declined"]) {
      const { container, unmount } = render(<ProductModal product={{ ...base,
        pricing: "quote", price: null, contact_state: state, vendor: noContactVendor }}
        onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
      expect(container.querySelector(".vendor-contact")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("never shows the old Show contact copy", () => {
    render(<ProductModal product={{ ...base, pricing: "quote", price: null }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.queryByText(/show contact/i)).not.toBeInTheDocument();
  });

  it("tells a founder they can review the vendor once ARTPARK approves a request", () => {
    render(<ProductModal product={base} onClose={noop} onPrimary={noop}
      onRequestContact={noopAsync} onSubmitReview={noop} />);
    expect(screen.getByText(
      "You can review this vendor once ARTPARK approves a request to them."))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Your review")).not.toBeInTheDocument();
  });

  it("submits a review against the vendor id once eligible", async () => {
    const onSubmitReview = vi.fn().mockResolvedValue({});
    render(<ProductModal product={{ ...base, can_review: true }}
      onClose={noop} onPrimary={noop} onRequestContact={noopAsync} onSubmitReview={onSubmitReview} />);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "Solid." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    expect(onSubmitReview).toHaveBeenCalledWith("knowles", { rating: 5, body: "Solid." });
  });
});
