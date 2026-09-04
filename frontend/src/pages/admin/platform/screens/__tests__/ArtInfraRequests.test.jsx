import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import ArtInfraRequests from "../artinfra/ArtInfraRequests.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store, req;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  const { catalog } = await store.founderStore();
  req = await store.createRequest({ product_id: catalog[0].id, note: "Need 4 by October" });
});

describe("ArtInfraRequests", () => {
  it("shows the pending request with its product, vendor and note", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("approving removes it from the pending queue", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByText("Need 4 by October")).toBeNull());
    const approved = await store.listRequests({ status: "approved" });
    expect(approved).toHaveLength(1);
  });

  it("refuses to decline without a reason", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm decline" }));
    await screen.findByText(/reason is required/i);
  });

  it("declines with a reason the founder will see", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(await screen.findByLabelText("Reason"), { target: { value: "Out of budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    await waitFor(async () => {
      const [r] = await store.listRequests({ status: "declined" });
      expect(r.decision_note).toBe("Out of budget");
    });
  });

  it("notifies the shell after every decision so the badge updates", async () => {
    const onChange = vi.fn();
    render(<ArtInfraRequests store={store} onChange={onChange} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
