import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VendorProductEditor from "../VendorProductEditor.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  vendorId = (await store.adminListVendors())[0].id;
});

const renderNew = (theStore = store) =>
  render(<VendorProductEditor store={theStore} vendorId={vendorId}
    productId={null} onDone={vi.fn()} />);

// The Category select renders before its options load, so findByLabelText
// resolves instantly and a change fired here can land while the spec-field
// registry is still empty -- leaving no fields to assert on. Wait for
// observable readiness (real options) rather than for an element that is
// always present.
async function chooseCategory(value) {
  const cat = await screen.findByLabelText("Category");
  await waitFor(() => expect(cat.options.length).toBeGreaterThan(1));
  fireEvent.change(cat, { target: { value } });
  return cat;
}

describe("VendorProductEditor — dynamic spec fields", () => {
  it("shows no spec fields until a category is chosen", async () => {
    renderNew();
    await screen.findByLabelText("Name");
    expect(screen.getByText(/choose a category/i)).toBeInTheDocument();
  });

  it("renders the Sensors field set when Sensors is chosen", async () => {
    renderNew();
    await chooseCategory("sensors");
    await screen.findByLabelText("Sensing modality");
    expect(screen.getByLabelText("Channels")).toBeInTheDocument();
    expect(screen.getByLabelText("SNR")).toBeInTheDocument();
  });

  it("swaps the whole field set when the category changes", async () => {
    renderNew();
    const cat = await chooseCategory("sensors");
    await screen.findByLabelText("Sensing modality");
    fireEvent.change(cat, { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    // The sensor-only field must be GONE, not merely hidden.
    expect(screen.queryByLabelText("Sensing modality")).toBeNull();
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });

  it("renders a unit next to a number field that declares one", async () => {
    renderNew();
    await chooseCategory("sensors");
    // supply_voltage is the sensors field that still declares a unit: snr and
    // channels are text, because the catalog stores "68 dB(A)" as free text.
    await screen.findByLabelText("Supply voltage");
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("renders a multi_enum as checkboxes, not a text box", async () => {
    renderNew();
    await chooseCategory("fabrication");
    // surface_finish is the fabrication field still typed multi_enum:
    // materials was retyped to text because the catalog stores lists like
    // "Al 6061, ABS, PC" as free text.
    await screen.findByLabelText("Process");
    expect(screen.getByRole("checkbox", { name: "Anodised" })).toBeInTheDocument();
  });

  it("blocks save when a required spec field is empty, and says which", async () => {
    // The seeded registry has no required fields (by design — see fixture),
    // so this test proves the validation path directly by marking one field
    // required at the store boundary, the same shape a real admin edit would
    // produce via updateSpecField. Nothing about the component under test is
    // touched — only the data it is fed.
    const requiredStore = {
      ...store,
      listSpecFields: async (categoryId) => {
        const fields = await store.listSpecFields(categoryId);
        return fields.map((f) => (f.key === "modality" ? { ...f, required: true } : f));
      },
    };
    renderNew(requiredStore);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    await chooseCategory("sensors");
    await screen.findByLabelText("Sensing modality");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Sensing modality is required/i);
  });

  it("sends only writable fields", async () => {
    // A brand-new product's form holds nothing but writable keys (BLANK is
    // exactly the WRITABLE list), so spreading the whole form on save was
    // indistinguishable from building the patch explicitly -- both produced
    // the same payload and both passed. Loading an EXISTING seeded product
    // instead gives the form extra read-model fields the store does NOT
    // accept (vendor_id, status, extra_specs, sort, slug, id): save can only
    // succeed if the patch is still built from the explicit WRITABLE list.
    const onDone = vi.fn();
    render(<VendorProductEditor store={store} vendorId="artpark-fab"
      productId="c4" onDone={onDone} />);
    await screen.findByDisplayValue("Rapid PCB fabrication (2-layer, 10 pcs)");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // If the editor spread its read model, the mock would reject the write
    // (unwritable_fields) and onDone would never be called.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the preview-as-founder pane", async () => {
    renderNew();
    await screen.findByTestId("founder-preview");
  });
});
