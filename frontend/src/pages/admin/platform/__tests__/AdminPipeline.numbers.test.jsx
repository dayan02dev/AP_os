// Pipeline fixes from the portal-numbers QA pass:
//   ADM-13 dashboard industry pre-filter (sticky key), ADM-14 Onboarded chip,
//   ADM-15 status options derived from rows + Unspecified industry + batch counts,
//   ADM-16 ID / founder / reco sorting, ADM-18 "No reviews" vs "1 review".
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { writeStickyState } from "../../../../hooks/useStickyState.js";
import { adaptPipelineRow } from "../../../../lib/adminDataAdapter";

const base = { track: "tir", stage: "Lab", ai: { overall: 7 }, flags: [], sub: "2026-07-01", batches: [] };
const ROWS = [
  { ...base, id: "u1", applicationId: "TIR-26580", name: "Alpha", founders: ["zed"], domain: "Robotics",
    chip: "IN REVIEW", reco: { yes: 1 }, reviewers: { submitted: 1, assigned: 2 }, batches: [{ name: "A" }] },
  { ...base, id: "u2", applicationId: "TIR-1001", name: "Beta", founders: [" Sachin"], domain: "—",
    chip: "EVALUATED", reco: null, reviewers: { submitted: 0, assigned: 2 }, batches: [{ name: "A" }, { name: "B" }] },
  { ...base, id: "u3", applicationId: "VIP-26639", track: "sip", name: "Gamma", founders: ["amit"], domain: "Robotics",
    chip: "ONBOARDED", reco: { yes: 2 }, reviewers: { submitted: 2, assigned: 2 } },
  { ...base, id: "u4", applicationId: "TIR-27000", name: "Delta", founders: ["Bea"], domain: "Health",
    chip: "ACCEPTED", reco: { no: 2 }, reviewers: { submitted: 3, assigned: 0 } },
];

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (key) =>
    key === "batches"
      ? { data: { batches: [] }, loading: false, error: null, reload: () => {} }
      : { data: { startups: ROWS }, loading: false, error: null, reload: () => {} },
}));

import { AdminPipeline } from "../screens/AdminPipeline.jsx";

let n = 0;
const mount = () => {
  const scopeKey = `numbers${++n}`;
  const r = render(<AdminPipeline goDetail={() => {}} scopeKey={scopeKey} />);
  return { ...r, scopeKey };
};
const rowNames = () => screen.getAllByTestId(/^pipeline-row-/).map((tr) => within(tr).getAllByRole("cell")[1].textContent);
const openFilters = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));

describe("ADM-14 onboarded vs offered", () => {
  it("adapter maps onboarded to its own chip", () => {
    expect(adaptPipelineRow({ id: "x", status: "onboarded" }).chip).toBe("ONBOARDED");
    expect(adaptPipelineRow({ id: "x", status: "offered" }).chip).toBe("ACCEPTED");
  });
  it("Onboarded and Offered filters return different rows", () => {
    mount(); openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Onboarded/ }));
    expect(rowNames()).toEqual(["Gamma"]);
    fireEvent.click(screen.getByRole("button", { name: /^Offered/ }));
    expect(rowNames()).toEqual(["Delta"]);
  });
});

describe("ADM-15 filter options from loaded rows", () => {
  it("lists only statuses present, each with a count", () => {
    mount(); openFilters();
    expect(screen.getByRole("button", { name: /^Under review\s*1$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Evaluated\s*1$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Withdrawn/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Waitlisted/ })).toBeNull();
  });
  it("adds an Unspecified industry chip that filters null-industry rows", () => {
    mount(); openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^— Unspecified\s*1$/ }));
    expect(rowNames()).toEqual(["Beta"]);
  });
  it("batch chips carry membership counts", () => {
    mount(); openFilters();
    expect(screen.getByRole("button", { name: /^A\s*2$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^B\s*1$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unassigned\s*2$/ })).toBeTruthy();
  });
});

describe("ADM-13 dashboard → Applications industry pre-filter", () => {
  it("honours the sticky industry key written by the dashboard", () => {
    writeStickyState("admin.pipeline.preset", "industry", "Health");
    render(<AdminPipeline goDetail={() => {}} scopeKey="preset" />);
    expect(rowNames()).toEqual(["Delta"]);
  });
});

describe("ADM-16 sorting", () => {
  it("sorts by display ID (track then numeric seq), not UUID", () => {
    mount();
    fireEvent.click(screen.getByText("ID"));
    expect(rowNames()).toEqual(["Beta", "Alpha", "Delta", "Gamma"]);
  });
  it("sorts founders trimmed and case-insensitive", () => {
    mount();
    fireEvent.click(screen.getByText("FOUNDER"));
    expect(rowNames()).toEqual(["Gamma", "Delta", "Beta", "Alpha"]);
  });
  it("RECO header sorts yes > maybe > no > pending > none", () => {
    mount();
    fireEvent.click(screen.getByText("Reco"));
    expect(rowNames()).toEqual(["Gamma", "Delta", "Alpha", "Beta"]);
  });
});

describe("ADM-18 reco '—' split", () => {
  it("separates 'No reviews' from '1 review'", () => {
    mount(); openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^1 review\s*1$/ }));
    expect(rowNames()).toEqual(["Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: /^No reviews\s*1$/ }));
    expect(rowNames()).toEqual(["Beta"]);
  });
});

describe("C2 reviewers cell never renders submitted > assigned as 'N / 0'", () => {
  it("shows the review count with a detached note instead", () => {
    mount();
    expect(screen.queryByText("3 / 0")).toBeNull();
    expect(screen.getByText(/3 reviews/)).toBeTruthy();
  });
});
