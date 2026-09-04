import { render, screen, waitFor } from "@testing-library/react";
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
    await store.createRequest({ product_id: catalog[0].id, note: "x" });
    render(<ArtInfraInsights store={store} />);
    await screen.findByText("Most requested");
    expect(screen.getByRole("columnheader", { name: "Requests" })).toBeInTheDocument();
  });
});
