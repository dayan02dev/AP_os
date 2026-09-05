import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraInsights from "../artinfra/ArtInfraInsights.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
});

describe("ArtInfraInsights", () => {
  it("reports every product as never requested on a fresh store", async () => {
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByTestId("never-requested-count")).toHaveTextContent("12");
  });

  it("moves a product out of never-requested once requested", async () => {
    const { catalog } = await store.founderStore();
    await store.createRequest({ product_id: catalog[0].id, note: "x" });
    render(<ArtInfraInsights store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("never-requested-count")).toHaveTextContent("11"));
    expect(screen.getByTestId("top-requested")).toHaveTextContent(catalog[0].name);
  });

  it("shows the mean approved rating across the whole catalog", async () => {
    // Sample data ships one APPROVED review (rating 5, on the Knowles vendor)
    // and one pending review (rating 4) that must not count — mean is 5.0.
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByTestId("mean-approved-rating")).toHaveTextContent("★ 5.0");
  });

  it("counts requests rather than shortlists", async () => {
    const { catalog } = await store.founderStore();
    const requested = catalog[0];
    const untouched = catalog[1];
    await store.createRequest({ product_id: requested.id, note: "x" });

    render(<ArtInfraInsights store={store} />);
    await screen.findByText("Most requested");

    // Assert the VALUE, not just the header: the requested product's row
    // must show a request count of 1 (its Requests cell -- Product, Vendor,
    // Requests, Rating).
    const requestedRow = screen.getByText(requested.name).closest("tr");
    expect(within(requestedRow).getAllByRole("cell")[2]).toHaveTextContent("1");

    // A product nobody requested must not show up in "Most requested" at
    // all -- i.e. its count is genuinely 0, not a hardcoded stand-in.
    const topRequestedTable = screen.getByTestId("top-requested");
    expect(within(topRequestedTable).queryByText(untouched.name)).not.toBeInTheDocument();
  });

  it("shows an error instead of a permanent Loading… when insights() rejects", async () => {
    configure({ failNext: "server_error" });
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByText(/could not load insights/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
