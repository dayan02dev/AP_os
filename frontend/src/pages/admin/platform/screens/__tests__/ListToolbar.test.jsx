import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ListToolbar from "../ListToolbar";

describe("ListToolbar", () => {
  it("renders a labelled search box and reports typing", () => {
    const onSearch = vi.fn();
    render(<ListToolbar search="" onSearch={onSearch}
      searchLabel="Search things" searchPlaceholder="Type…" count={0} total={0} />);
    const input = screen.getByLabelText("Search things");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onSearch).toHaveBeenCalledWith("abc");
  });

  it("renders each segment group with its options", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={2} total={9}
      segments={[{ ariaLabel: "Track", value: "all", onChange: vi.fn(),
        options: [["all", "All tracks"], ["tir", "TIR"]] }]} />);
    expect(screen.getByRole("group", { name: "Track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TIR" })).toBeInTheDocument();
  });

  it("marks the active segment with aria-pressed", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0}
      segments={[{ ariaLabel: "Track", value: "tir", onChange: vi.fn(),
        options: [["all", "All tracks"], ["tir", "TIR"]] }]} />);
    expect(screen.getByRole("button", { name: "TIR" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All tracks" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the count as 'n of total'", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={3} total={12} />);
    expect(screen.getByText("3 of 12")).toBeInTheDocument();
  });

  it("collapses when there is no panel, and expands when there is", () => {
    const { rerender, container } = render(
      <ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0} />);
    expect(container.querySelector(".lp-filter-area").className).toContain("is-collapsed");
    rerender(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0}
      panel={<div>panel body</div>} />);
    expect(container.querySelector(".lp-filter-area").className).not.toContain("is-collapsed");
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });
});
