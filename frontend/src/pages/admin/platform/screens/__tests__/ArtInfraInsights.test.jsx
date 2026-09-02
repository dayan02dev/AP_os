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
});
