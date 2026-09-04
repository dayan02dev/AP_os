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

  it("saves a valid product and sends only writable fields", async () => {
    const onDone = vi.fn();
    render(<VendorProductEditor store={store} vendorId={vendorId}
      productId={null} onDone={onDone} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    await chooseCategory("sensors");
    await screen.findByLabelText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Sensing modality"), { target: { value: "Acoustic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // If the editor spread its read model, the mock would reject the write.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the preview-as-founder pane", async () => {
    renderNew();
    await screen.findByTestId("founder-preview");
  });
});
