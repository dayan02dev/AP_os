import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ArtInfraProductEditor from "../artinfra/ArtInfraProductEditor.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";

let store;
beforeEach(() => { store = createArtInfraStore(); });

describe("ArtInfraProductEditor", () => {
  it("loads an existing product into the form", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("MEMS microphone array (8-ch)"));
  });

  it("renders a live preview card that reflects edits", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed rig" } });
    expect(within(screen.getByTestId("founder-preview")).getByText("Renamed rig")).toBeInTheDocument();
  });

  it("hides the price field for quote-priced products", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (₹)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    expect(screen.queryByLabelText("Price (₹)")).not.toBeInTheDocument();
  });

  it("clears the price when pricing switches to quote", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Price (₹)"));
    fireEvent.change(screen.getByLabelText("Pricing"), { target: { value: "quote" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await store.getProduct("c1")).price).toBeNull());
  });

  it("adds and removes spec rows", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    const before = screen.getAllByLabelText(/Spec key/).length;
    fireEvent.click(screen.getByRole("button", { name: "+ Add spec" }));
    expect(screen.getAllByLabelText(/Spec key/).length).toBe(before + 1);
  });

  it("saves and calls onDone", async () => {
    const onDone = vi.fn();
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={onDone} />);
    await waitFor(() => screen.getByLabelText("Name"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await store.getProduct("c1")).name).toBe("Saved name");
  });

  it("blocks saving without a name", async () => {
    render(<ArtInfraProductEditor store={store} productId={null} onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
