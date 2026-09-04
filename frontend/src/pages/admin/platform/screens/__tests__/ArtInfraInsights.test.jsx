import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ArtInfraInsights from "../artinfra/ArtInfraInsights.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraInsights", () => {
  it("reports every product as never shortlisted on a fresh store", async () => {
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByTestId("never-shortlisted-count")).toHaveTextContent("12");
  });

  it("moves a product out of never-shortlisted once shortlisted", async () => {
    await store.addToShortlist("c1", 1);
    render(<ArtInfraInsights store={store} />);
    await waitFor(() =>
      expect(screen.getByTestId("never-shortlisted-count")).toHaveTextContent("11"));
    expect(screen.getByTestId("top-shortlisted")).toHaveTextContent("MEMS microphone array (8-ch)");
  });

  it("shows the mean approved rating across the whole catalog", async () => {
    // Sample data ships two APPROVED reviews (5 and 4, both on c1) and two
    // pending reviews that must not count — mean is (5+4)/2 = 4.5.
    render(<ArtInfraInsights store={store} />);
    expect(await screen.findByTestId("mean-approved-rating")).toHaveTextContent("★ 4.5");
  });
});
