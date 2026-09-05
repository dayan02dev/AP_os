import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraVendors from "../artinfra/ArtInfraVendors.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
});

describe("ArtInfraVendors", () => {
  it("lists the 11 seeded vendors", async () => {
    render(<ArtInfraVendors store={store} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(12)); // 11 + header
  });

  it("edits a vendor contact and persists it", async () => {
    render(<ArtInfraVendors store={store} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Knowles" }));
    fireEvent.change(screen.getByLabelText("Contact email"),
      { target: { value: "sales@knowles.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vendor" }));
    await waitFor(async () => {
      const v = (await store.adminListVendors()).find((x) => x.id === "knowles");
      expect(v.contact_email).toBe("sales@knowles.example");
    });
  });

  it("invites a vendor by email", async () => {
    render(<ArtInfraVendors store={store} />);
    await screen.findByText("Knowles");
    fireEvent.click(screen.getByRole("button", { name: "+ Invite vendor" }));
    fireEvent.change(await screen.findByLabelText("Contact email"),
      { target: { value: "new@vendor.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NewCo" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByText("NewCo");
    const rows = await store.adminListVendors({ status: "invited" });
    expect(rows.some((v) => v.contact_email === "new@vendor.com")).toBe(true);
  });

  it("suspending a vendor is offered for approved vendors, and only those", async () => {
    render(<ArtInfraVendors store={store} />);
    await screen.findByText("Knowles");

    // Invite a vendor so a non-approved ("invited") row exists alongside the
    // 11 seeded (already-approved) vendors -- both branches must be present
    // for this test to actually discriminate on the status gate.
    fireEvent.click(screen.getByRole("button", { name: "+ Invite vendor" }));
    fireEvent.change(await screen.findByLabelText("Contact email"),
      { target: { value: "new@vendor.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NewCo" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByText("NewCo");

    const allVendors = await store.adminListVendors();
    const approvedCount = allVendors.filter((v) => v.status === "approved").length;

    // Correspondence, not just "some Suspend button exists": the number of
    // Suspend buttons must equal the number of approved vendors rendered.
    expect(screen.getAllByRole("button", { name: /^Suspend / }).length).toBe(approvedCount);

    const newCoRow = screen.getByText("NewCo").closest("tr");
    expect(within(newCoRow).getByRole("button", { name: "Approve NewCo" })).toBeInTheDocument();
    expect(within(newCoRow).queryByRole("button", { name: "Suspend NewCo" })).not.toBeInTheDocument();
  });

  it("shows a Status column reflecting the vendor's lifecycle state", async () => {
    render(<ArtInfraVendors store={store} />);
    await screen.findByText("Knowles");
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  it("shows an error instead of an empty table when the load fails", async () => {
    const badStore = { adminListVendors: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<ArtInfraVendors store={badStore} />);
    expect(await screen.findByText(/could not load vendors/i)).toBeInTheDocument();
    expect(screen.queryByText("No vendors yet.")).not.toBeInTheDocument();
  });
});
