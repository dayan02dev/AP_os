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

  it("adds a spec row", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));
    const before = screen.getAllByLabelText(/Spec key/).length;
    fireEvent.click(screen.getByRole("button", { name: "+ Add spec" }));
    expect(screen.getAllByLabelText(/Spec key/).length).toBe(before + 1);
  });

  it("removes the right spec row, keeping neighbours intact", async () => {
    render(<ArtInfraProductEditor store={store} productId="c1" onDone={vi.fn()} />);
    await waitFor(() => screen.getByLabelText("Name"));

    // c1 ships 3 specs (Channels, SNR, Interface). Overwrite the two rows
    // that should survive with test-authored values so the post-removal
    // assertions cannot pass by coincidentally matching fixture defaults.
    fireEvent.change(screen.getByLabelText("Spec key 1"), { target: { value: "KeepFirst" } });
    fireEvent.change(screen.getByLabelText("Spec value 1"), { target: { value: "KeepFirstValue" } });
    fireEvent.change(screen.getByLabelText("Spec key 3"), { target: { value: "KeepThird" } });
    fireEvent.change(screen.getByLabelText("Spec value 3"), { target: { value: "KeepThirdValue" } });
    expect(screen.getAllByLabelText(/Spec key/)).toHaveLength(3);

    // Remove the middle row specifically — scoped to the row containing the
    // "Spec key 2" input, not just "the first Remove button found".
    const middleRow = screen.getByLabelText("Spec key 2").closest(".ai-spec-row");
    fireEvent.click(within(middleRow).getByRole("button", { name: "Remove" }));

    const keys = screen.getAllByLabelText(/Spec key/);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toHaveValue("KeepFirst");
    expect(screen.getByLabelText("Spec value 1")).toHaveValue("KeepFirstValue");
    expect(keys[1]).toHaveValue("KeepThird");
    expect(screen.getByLabelText("Spec value 2")).toHaveValue("KeepThirdValue");
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
