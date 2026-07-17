import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecoCell, RecoBadge } from "../RecoCell.jsx";

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
