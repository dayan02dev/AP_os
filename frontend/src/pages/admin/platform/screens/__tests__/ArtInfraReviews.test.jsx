import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraReviews from "../artinfra/ArtInfraReviews.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
});

describe("ArtInfraReviews", () => {
  it("opens on the pending queue", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(2)); // 1 pending + header
  });

  it("approves a review, removing it from the pending queue", async () => {
    const onChange = vi.fn();
    render(<ArtInfraReviews store={store} onChange={onChange} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    await screen.findByText("Nothing in this queue.");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows approved reviews when the filter switches", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await screen.findAllByRole("button", { name: "Approve" });
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(2)); // 1 approved + header
  });

  it("names the vendor and the founder for each review", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    expect(await screen.findByText("Ishan Gupta")).toBeInTheDocument();
  });

  it("shows the vendor a review is about, not a product", async () => {
    render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
    await screen.findByText("Ishan Gupta");
    expect(screen.getByRole("columnheader", { name: "Vendor" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Product" })).toBeNull();
  });

  it("shows an error instead of an empty table when the load fails", async () => {
    const badStore = { listVendorReviews: vi.fn().mockRejectedValue(new Error("boom")) };
    render(<ArtInfraReviews store={badStore} onChange={vi.fn()} />);
    expect(await screen.findByText(/could not load reviews/i)).toBeInTheDocument();
    expect(screen.queryByText("Nothing in this queue.")).not.toBeInTheDocument();
  });
});
