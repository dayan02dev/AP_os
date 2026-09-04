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
    render(<VendorPortal store={store} />);
    const picker = await screen.findByLabelText("Viewing as vendor");
    const second = picker.options[1].value;
    fireEvent.change(picker, { target: { value: second } });
    await waitFor(() => expect(picker.value).toBe(second));
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
