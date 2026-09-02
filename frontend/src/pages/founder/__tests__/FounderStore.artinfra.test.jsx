import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import FounderStore from "../FounderStore.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("FounderStore (Art Infra)", () => {
  it("renders the catalog and says Shortlist, never Cart", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Shortlist/ })).toBeInTheDocument());
    expect(screen.queryByText(/\bCart\b/)).not.toBeInTheDocument();
  });

  it("adds to the shortlist and shows the count and subtotal", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    await waitFor(() => expect(screen.getByTestId("shortlist-count")).toHaveTextContent("1"));
  });

  it("keeps the push-to-procurement wording", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Shortlist/ }));
    expect(await screen.findByRole("button", { name: /Push to procurement/ })).toBeInTheDocument();
  });

  it("never renders the old quote-request wording", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    expect(screen.queryByText("Request quote")).not.toBeInTheDocument();
    expect(screen.queryByText("Quote requested ✓")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Show contact" }).length).toBe(4);
  });

  // The fixture's 12 products split 8 Hardware / 4 Software and 8 fixed-price /
  // 4 quote-priced, so button counts identify the filtered set exactly.
  // Software = c9 + c11 (fixed) and c10 + c12 (quote).
  it("filters to software only", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Add to shortlist" })).toHaveLength(8));
    expect(screen.getByText("MEMS microphone array (8-ch)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Software" }));

    await waitFor(() =>
      expect(screen.queryByText("MEMS microphone array (8-ch)")).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Add to shortlist" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Show contact" })).toHaveLength(2);
    expect(screen.getByText("Edge inference SDK (annual licence)")).toBeInTheDocument();
  });

  it("filters to quote-based only", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Add to shortlist" })).toHaveLength(8));

    fireEvent.click(screen.getByRole("button", { name: "Quote-based" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Add to shortlist" })).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Show contact" })).toHaveLength(4);
  });
});
