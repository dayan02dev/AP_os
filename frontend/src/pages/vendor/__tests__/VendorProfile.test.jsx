import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VendorProfile from "../VendorProfile.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  vendorId = (await store.adminListVendors())[0].id;
});

describe("VendorProfile", () => {
  it("renders the required identity fields", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    for (const l of ["Display name", "Website", "Contact name", "Contact email",
      "Contact phone", "City", "Capabilities"]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
  });

  it("does NOT collect bank details or PAN", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    expect(screen.queryByLabelText(/bank/i)).toBeNull();
    expect(screen.queryByLabelText(/IFSC/i)).toBeNull();
    expect(screen.queryByLabelText(/^PAN$/i)).toBeNull();
  });

  it("persists an edit", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    const website = await screen.findByLabelText("Website");
    fireEvent.change(website, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(async () => {
      const v = await store.getVendorMe(vendorId);
      expect(v.website).toBe("https://example.com");
    });
  });

  it("surfaces a save failure instead of silently succeeding", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText(/could not save/i);
  });

  it("clears a stale error after a later success", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText(/could not save/i);
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.queryByText(/could not save/i)).toBeNull());
  });
});
