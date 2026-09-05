import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import ArtInfraSpecFields from "../artinfra/ArtInfraSpecFields.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => { configure({ minMs: 0, maxMs: 0 }); store = createArtInfraStore(); });

const renderIt = () => render(
  <ArtInfraSpecFields store={store} categoryId="sensors"
    categoryLabel="Sensors" onBack={vi.fn()} />);

describe("ArtInfraSpecFields", () => {
  it("lists the fields defined for this category only", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    expect(screen.queryByText("Process")).toBeNull();   // fabrication's field
  });

  it("adds a field", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Field label"), { target: { value: "IP rating" } });
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "ip_rating" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    await screen.findByText("IP rating");
  });

  it("refuses a duplicate key in the same category", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Field label"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "channels" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    await screen.findByText(/already a field/i);
  });

  it("archives rather than deletes, and warns that values are kept", async () => {
    renderIt();
    await screen.findByText("Channels");
    fireEvent.click(screen.getByRole("button", { name: "Archive Channels" }));
    await waitFor(() => expect(screen.queryByText("Channels")).toBeNull());
    const fields = await store.listSpecFields("sensors");
    const archived = fields.find((f) => f.key === "channels");
    expect(archived.archived_at).not.toBeNull();   // soft, not destroyed
  });

  // Renamed from "warns before archiving a required field": the .vp-note
  // renders unconditionally (no fixture field here is `required`), so this
  // never tested conditional behaviour -- it only tests that the standing
  // soft-archive notice is present. Kept (rather than deleted) because
  // "archives rather than deletes, and warns that values are kept" below
  // never asserts the notice text itself, only the archive outcome.
  it("shows a standing notice that archiving is soft, regardless of any field being required", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    expect(screen.getByText(/existing products keep their values/i)).toBeInTheDocument();
  });

  it("edits a field's label and the change propagates", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    fireEvent.click(screen.getByRole("button", { name: "Edit Sensing modality" }));
    fireEvent.change(await screen.findByLabelText("Edit label"),
      { target: { value: "Sensing modality (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await screen.findByText("Sensing modality (renamed)");
    expect(screen.queryByText("Sensing modality")).toBeNull();

    const fields = await store.listSpecFields("sensors");
    const renamed = fields.find((f) => f.label === "Sensing modality (renamed)");
    expect(renamed).toBeTruthy();
  });

  it("surfaces a failure", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Archive Channels" }));
    await screen.findByText(/could not/i);
  });
});
