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

describe("VendorProductEditor — dynamic spec fields", () => {
  it("shows no spec fields until a category is chosen", async () => {
    renderNew();
    await screen.findByLabelText("Name");
    expect(screen.getByText(/choose a category/i)).toBeInTheDocument();
  });

  it("renders the Sensors field set when Sensors is chosen", async () => {
    renderNew();
    const cat = await screen.findByLabelText("Category");
    fireEvent.change(cat, { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    expect(screen.getByLabelText("Channels")).toBeInTheDocument();
    expect(screen.getByLabelText("SNR")).toBeInTheDocument();
  });

  it("swaps the whole field set when the category changes", async () => {
    renderNew();
    const cat = await screen.findByLabelText("Category");
    fireEvent.change(cat, { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.change(cat, { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    // The sensor-only field must be GONE, not merely hidden.
    expect(screen.queryByLabelText("Sensing modality")).toBeNull();
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });

  it("renders a unit next to a number field that declares one", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("SNR");
    expect(screen.getByText("dB(A)")).toBeInTheDocument();
  });

  it("renders a multi_enum as checkboxes, not a text box", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    expect(screen.getByRole("checkbox", { name: "Aluminium" })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Sensing modality is required/i);
  });

  it("saves a valid product and sends only writable fields", async () => {
    const onDone = vi.fn();
    render(<VendorProductEditor store={store} vendorId={vendorId}
      productId={null} onDone={onDone} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sensors" } });
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
