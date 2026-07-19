import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecoCell, RecoBadge, aggregateReco, recoTitle } from "../RecoCell.jsx";

describe("RecoCell", () => {
  it("renders a dash for no reviews", () => {
    render(<table><tbody><tr><td><RecoCell reco={{ yes: 0, maybe: 0, no: 0 }} /></td></tr></tbody></table>);
    expect(screen.getByText("—")).toBeTruthy();
  });
  it("renders a single chip when unanimous", () => {
    render(<table><tbody><tr><td><RecoCell reco={{ yes: 3, maybe: 0, no: 0 }} /></td></tr></tbody></table>);
    expect(screen.getByText("YES")).toBeTruthy();
  });
  it("renders a compact tally when reviewers differ", () => {
    render(<table><tbody><tr><td><RecoCell reco={{ yes: 2, maybe: 0, no: 1 }} /></td></tr></tbody></table>);
    expect(screen.getByText("2Y")).toBeTruthy();
    expect(screen.getByText("1N")).toBeTruthy();
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
