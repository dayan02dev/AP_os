import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import FounderStore from "../FounderStore.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });   // deterministic in tests
  store = createArtInfraStore();
});

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
    expect(screen.queryByText(/show contact/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Request contact" }).length).toBe(4);
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
    expect(screen.getAllByRole("button", { name: "Request contact" })).toHaveLength(2);
    expect(screen.getByText("Edge inference SDK (annual licence)")).toBeInTheDocument();
  });

  it("filters to quote-based only", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Add to shortlist" })).toHaveLength(8));

    fireEvent.click(screen.getByRole("button", { name: "Quote-based" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Add to shortlist" })).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Request contact" })).toHaveLength(4);
  });

  // Coverage restored for what FounderStore.test.jsx used to cover before it
  // was deleted: the popover's line item (ci-name / ci-price / header count)
  // and the qty +/- path, which routes through setShortlistQty →
  // removeFromShortlist — a hazard because setShortlistQty calls
  // `this.removeFromShortlist` internally, so it only works when invoked
  // through the store reference (as FounderStore does).
  it("shows the popover line item, updates qty on +/-, and removes it at zero", async () => {
    const { container } = render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]); // c1 @ ₹8,200
    fireEvent.click(await screen.findByRole("button", { name: /Shortlist/ }));

    const popover = () => container.querySelector(".cart-pop");
    await waitFor(() =>
      expect(within(popover()).getByText("Shortlist · 1 items")).toBeInTheDocument());
    expect(within(popover()).getByText("MEMS microphone array (8-ch)")).toBeInTheDocument();
    expect(within(popover()).getByText("₹8,200 each")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Increase MEMS microphone array (8-ch) quantity" }));
    await waitFor(() =>
      expect(within(popover()).getByText("Shortlist · 2 items")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Decrease MEMS microphone array (8-ch) quantity" }));
    await waitFor(() =>
      expect(within(popover()).getByText("Shortlist · 1 items")).toBeInTheDocument());

    // Dropping to zero removes the line entirely, not just showing qty 0.
    fireEvent.click(screen.getByRole("button", { name: "Decrease MEMS microphone array (8-ch) quantity" }));
    await waitFor(() => {
      expect(within(popover()).getByText("Shortlist · 0 items")).toBeInTheDocument();
      expect(within(popover()).queryByText("MEMS microphone array (8-ch)")).not.toBeInTheDocument();
      expect(within(popover()).getByText(/shortlist is empty/i)).toBeInTheDocument();
    });
  });

  it("shows a push confirmation with the item count, cleared on the next shortlist change", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    // Wait for the add to actually land. The mock is async with jitter, so
    // clicking Push in the same tick hits a disabled button and push()
    // early-returns on an empty shortlist. Waiting on the count badge waits
    // for observable state instead of assuming a synchronous resolve.
    await screen.findByTestId("shortlist-count");
    fireEvent.click(screen.getByRole("button", { name: /Shortlist/ }));
    const pushBtn = await screen.findByRole("button", { name: /Push to procurement/ });
    await waitFor(() => expect(pushBtn).not.toBeDisabled());
    fireEvent.click(pushBtn);

    expect(await screen.findByTestId("procurement-confirmation"))
      .toHaveTextContent("1 item moved to your procurement plan.");

    // Same shape again: push() sets the confirmation before its own load()
    // resolves, so `busy` (and the Add button's disabled state) can still be
    // true right when the confirmation first appears. Wait for the button to
    // actually be clickable before clicking it.
    const addAgainBtn = screen.getAllByRole("button", { name: "Add to shortlist" })[0];
    await waitFor(() => expect(addAgainBtn).not.toBeDisabled());
    fireEvent.click(addAgainBtn);
    await waitFor(() =>
      expect(screen.queryByTestId("procurement-confirmation")).not.toBeInTheDocument());
  });

  it("opens the product modal when a card is clicked", async () => {
    render(<FounderStore store={store} />);
    await waitFor(() => screen.getAllByRole("button", { name: "Add to shortlist" }));
    fireEvent.click(screen.getByText("MEMS microphone array (8-ch)"));
    expect(await screen.findByText("Overview")).toBeInTheDocument();
  });
});

describe("request flow", () => {
  it("raises a request and shows the pending state", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const btn = (await screen.findAllByRole("button", { name: "Request contact" }))[0];
    fireEvent.click(btn);
    const note = await screen.findByLabelText("What do you need?");
    fireEvent.change(note, { target: { value: "Need 4 units by October" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText("Requested — awaiting approval");
  });

  // FounderStore refetches on mount and after the founder's own actions; there
  // is no live cross-portal channel, and the spec does not ask for one. An
  // approval made elsewhere while this page stays mounted therefore needs a
  // reload. Real navigation (founder -> admin -> founder) remounts and refetches,
  // so this only bites a page left open. Revisit when Phase 2 picks a refetch
  // strategy.
  it("shows the contact block after an approval, on the next load", async () => {
    const store = createArtInfraStore();
    const { catalog } = await store.founderStore();
    const quote = catalog.find((p) => p.pricing === "quote");

    // Approve first, THEN render -- this is the realistic founder -> admin ->
    // founder navigation, which remounts the component and refetches.
    const req = await store.createRequest({ product_id: quote.id, note: "x" });
    await store.approveRequest(req.id);
    render(<FounderStore store={store} />);
    await screen.findAllByRole("button", { name: "Contact available" });

    // Assert the contact block itself, inside the product's own modal, not
    // just the button label.
    fireEvent.click(screen.getByText(quote.name));
    await screen.findByText("Overview");
    expect(await screen.findByText("Vendor contact")).toBeInTheDocument();
  });

  it("surfaces a failed request instead of appearing to succeed", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const btn = (await screen.findAllByRole("button", { name: "Request contact" }))[0];
    fireEvent.click(btn);
    fireEvent.change(await screen.findByLabelText("What do you need?"),
      { target: { value: "x" } });
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(/could not send/i);
  });

  it("leaves the shortlist mechanics alone", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const add = (await screen.findAllByRole("button", { name: "Add to shortlist" }))[0];
    fireEvent.click(add);
    await screen.findByTestId("shortlist-count");
  });
});
