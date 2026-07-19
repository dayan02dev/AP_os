import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecoCell, RecoBadge, aggregateReco, recoTitle } from "../RecoCell.jsx";

describe("RecoCell", () => {
  const wrap = (ui) => render(<table><tbody><tr><td>{ui}</td></tr></tbody></table>);

  it("renders a dash for no reviews", () => {
    wrap(<RecoCell reco={{ yes: 0, maybe: 0, no: 0 }} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
  it("renders ONE aggregate chip for a mixed tally (majority wins)", () => {
    wrap(<RecoCell reco={{ yes: 2, maybe: 0, no: 1 }} />);
    expect(screen.getByText("YES")).toBeTruthy();
    expect(screen.queryByText("2Y")).not.toBeInTheDocument();
  });
  it("renders MAYBE when there is no majority", () => {
    wrap(<RecoCell reco={{ yes: 1, maybe: 0, no: 1 }} />);
    expect(screen.getByText("MAYBE")).toBeTruthy();
  });
  it("exposes the vote breakdown as a tooltip", () => {
    wrap(<RecoCell reco={{ yes: 2, maybe: 0, no: 1 }} />);
    expect(screen.getByTitle("2 yes · 1 no")).toBeTruthy();
  });
  it("calls onSelect with the verdict when clicked", () => {
    const onSelect = vi.fn();
    wrap(<RecoCell reco={{ yes: 2, maybe: 0, no: 1 }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Filter by reco: yes/i }));
    expect(onSelect).toHaveBeenCalledWith("yes");
  });
  it("calls onSelect with 'none' when the dash cell is clicked", () => {
    const onSelect = vi.fn();
    wrap(<RecoCell reco={{ yes: 0, maybe: 0, no: 0 }} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Filter by reco: none/i }));
    expect(onSelect).toHaveBeenCalledWith("none");
  });
  it("is inert without onSelect (no button role)", () => {
    wrap(<RecoCell reco={{ yes: 2, maybe: 0, no: 1 }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("RecoBadge", () => {
  it("renders the value label", () => {
    render(<table><tbody><tr><td><RecoBadge value="no" /></td></tr></tbody></table>);
    expect(screen.getByText("NO")).toBeTruthy();
  });
  it("renders a dash for null", () => {
    render(<table><tbody><tr><td><RecoBadge value={null} /></td></tr></tbody></table>);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("aggregateReco", () => {
  it("majority yes wins even with maybes present", () => {
    expect(aggregateReco({ yes: 4, maybe: 1, no: 0 })).toBe("yes");
    expect(aggregateReco({ yes: 3, maybe: 2, no: 0 })).toBe("yes");
    expect(aggregateReco({ yes: 2, maybe: 1, no: 0 })).toBe("yes");
  });
  it("majority no wins", () => {
    expect(aggregateReco({ yes: 1, maybe: 0, no: 2 })).toBe("no");
  });
  it("no majority / ties / maybe-heavy -> maybe", () => {
    expect(aggregateReco({ yes: 2, maybe: 1, no: 2 })).toBe("maybe");
    expect(aggregateReco({ yes: 1, maybe: 0, no: 1 })).toBe("maybe");
    expect(aggregateReco({ yes: 0, maybe: 1, no: 0 })).toBe("maybe");
    expect(aggregateReco({ yes: 1, maybe: 2, no: 0 })).toBe("maybe");
  });
  it("no reviews -> null (also for missing/partial tallies)", () => {
    expect(aggregateReco({ yes: 0, maybe: 0, no: 0 })).toBeNull();
    expect(aggregateReco(null)).toBeNull();
    expect(aggregateReco(undefined)).toBeNull();
    expect(aggregateReco({})).toBeNull();
  });
});

describe("recoTitle", () => {
  it("joins non-zero buckets in yes/maybe/no order", () => {
    expect(recoTitle({ yes: 3, maybe: 1, no: 1 })).toBe("3 yes · 1 maybe · 1 no");
    expect(recoTitle({ yes: 2, maybe: 0, no: 0 })).toBe("2 yes");
  });
  it("empty tally -> empty string", () => {
    expect(recoTitle({ yes: 0, maybe: 0, no: 0 })).toBe("");
    expect(recoTitle(null)).toBe("");
  });
});
