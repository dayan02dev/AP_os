import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraProductEditor from "../artinfra/ArtInfraProductEditor.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
});

// The store no longer exposes getProduct — admin reads/writes go through the
// same admin-list + vendor-scoped write calls the real screen uses.
const findProduct = async (id) => (await store.adminListProducts({})).items.find((p) => p.id === id);

describe("ArtInfraProductEditor", () => {
  it("loads an existing product into the form", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("MEMS microphone array (8-ch)"));
  });

  it("renders a live preview card that reflects edits", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed rig" } });
    expect(within(screen.getByTestId("founder-preview")).getByText("Renamed rig")).toBeInTheDocument();
  });

  it("hides the price field for quote-priced products", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (₹)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    expect(screen.queryByLabelText("Price (₹)")).not.toBeInTheDocument();
  });

  it("clears the price when pricing switches to quote", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (₹)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await findProduct("c1")).price).toBeNull());
  });

  it("swaps the whole spec field set when the category changes", async () => {
    render(<ArtInfraProductEditor store={store} productId={null} onDone={vi.fn()} />);
    const cat = await screen.findByLabelText("Category");
    fireEvent.change(cat, { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    expect(screen.getByLabelText("Channels")).toBeInTheDocument();

    fireEvent.change(cat, { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    // The sensor-only field must be GONE, not merely hidden, and the specs
    // bag reset — orphaned keys from "sensors" are not valid for "fabrication".
    expect(screen.queryByLabelText("Sensing modality")).toBeNull();
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });

  it("blocks save when a required spec field is empty, and says which", async () => {
    // The seeded registry marks nothing required (by design), so this test
    // proves the validation path directly by marking one field required at
    // the store boundary — the component and seed are untouched.
    const requiredStore = {
      ...store,
      listSpecFields: async (categoryId) => {
        const fields = await store.listSpecFields(categoryId);
        return fields.map((f) => (f.key === "modality" ? { ...f, required: true } : f));
      },
    };
    render(<ArtInfraProductEditor store={requiredStore} productId={null} onDone={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Sensing modality is required/i);
  });

  it("saves and calls onDone", async () => {
    const onDone = vi.fn();
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={onDone} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await findProduct("c1")).name).toBe("Saved name");
  });

  it("never shows a rating in the preview, since its reviews are always forced empty", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    // c1 ships two approved reviews (avg 4.5) in the real catalog view, but the
    // preview pane always renders rating: {avg:0, count:0} — showing a rating
    // here would contradict the "No reviews yet." text right below it.
    expect(within(screen.getByTestId("founder-preview")).queryByText(/★/)).not.toBeInTheDocument();
  });

  it("blocks saving without a name", async () => {
    render(<ArtInfraProductEditor store={store} productId={null} onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
