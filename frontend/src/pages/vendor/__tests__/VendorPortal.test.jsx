import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VendorPortal from "../VendorPortal.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store;
beforeEach(() => { configure({ minMs: 0, maxMs: 0 }); store = createArtInfraStore(); });

describe("VendorPortal", () => {
  it("renders the three sub-nav entries", async () => {
    render(<VendorPortal store={store} />);
    await screen.findByRole("button", { name: "Profile" });
    expect(screen.getByRole("button", { name: "My catalog" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New product" })).toBeInTheDocument();
  });

  it("shows a view-as picker listing real vendors", async () => {
    render(<VendorPortal store={store} />);
    const picker = await screen.findByLabelText("Viewing as vendor");
    await waitFor(() => expect(picker.options.length).toBeGreaterThan(1));
  });

  it("switching vendor re-scopes the screen", async () => {
    // A previous version of this test only asserted `picker.value` matched
    // what was typed into the <select> -- true even if the picker were fully
    // disconnected from the screens below it. Assert the OBSERVABLE effect
    // instead: the catalog below must show the newly-picked vendor's own
    // products and must stop showing the previous vendor's.
    render(<VendorPortal store={store} />);
    const picker = await screen.findByLabelText("Viewing as vendor");
    fireEvent.click(screen.getByRole("button", { name: "My catalog" }));

    fireEvent.change(picker, { target: { value: "knowles" } });
    await screen.findByText("MEMS microphone array (8-ch)");
    expect(screen.queryByText("Rapid PCB fabrication (2-layer, 10 pcs)")).toBeNull();

    fireEvent.change(picker, { target: { value: "artpark-fab" } });
    await screen.findByText("Rapid PCB fabrication (2-layer, 10 pcs)");
    expect(screen.queryByText("MEMS microphone array (8-ch)")).toBeNull();
  });

  it("marks the active sub-nav entry with aria-current", async () => {
    render(<VendorPortal store={store} />);
    const profile = await screen.findByRole("button", { name: "Profile" });
    expect(profile).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "My catalog" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "My catalog" }))
        .toHaveAttribute("aria-current", "page"));
  });
});
