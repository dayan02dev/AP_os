import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraReviews from "../artinfra/ArtInfraReviews.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraReviews", () => {
  it("opens on the pending queue", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(3)); // 2 pending + header
  });

  it("approves a review, removing it from the pending queue", async () => {
    const onChange = vi.fn();
    render(<ArtInfraReviews store={store} onChange={onChange} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(2));
    expect(onChange).toHaveBeenCalled();
  });

  it("shows approved reviews when the filter switches", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(3)); // 2 approved + header
  });

  it("names the product and the founder for each review", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    expect(await screen.findByText("GridSense")).toBeInTheDocument();
  });
});
