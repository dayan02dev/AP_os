// ADM-05 / ADM-11 / ADM-19 — Admin Review batch chips + decision history.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn(), loadDetail: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn() },
}));
vi.mock("../shell/osAtoms", () => ({
  PageHead: ({ eyebrow, title }) => <div data-testid="pagehead">{eyebrow} {title}</div>,
  Chip: ({ children }) => <span>{children}</span>,
  FlagDot: () => null,
}));
vi.mock("../ui.jsx", () => ({
  LoadingState: ({ label }) => <div>{label}</div>,
  ErrorState: ({ error }) => <div>{String(error)}</div>,
  EmptyState: ({ label }) => <div>{label}</div>,
}));

import AdminGate1 from "../screens/AdminGate1.jsx";
import { useAdminData } from "../../../../hooks/useAdminData";

const ev = (id, batches) => ({ id, track: "tir", name: `App-${id}`, domain: "X", flags: [],
  batch: batches[0] || "Unassigned", batches: batches.map((name) => ({ name })) });
const EVAL = [ev("e1", ["A"]), ev("e2", ["A", "YES"]), ev("e3", ["C", "comm"]), ev("e4", [])];

// History rows. adminDecision is the LATEST decision of any gate; a final-round
// reject (gate2_decision rejected) overwrote a 1st-gate approve.
const ALL = [
  { id: "h1", track: "tir", name: "Picked", adminDecision: "APPROVED", gate1_decision: "jury_review", sub: "2026-05-01", decidedAt: "2026-07-10T10:00:00Z" },
  { id: "h2", track: "tir", name: "FinalRej", adminDecision: "REJECTED", gate2_decision: "rejected", sub: "2026-05-02" },
  { id: "h3", track: "tir", name: "G1Rej", adminDecision: "REJECTED", gate1_decision: "rejected", sub: "2026-05-03", decidedAt: "2026-07-09T10:00:00Z" },
  { id: "h4", track: "tir", name: "G1Rej2", adminDecision: "REJECTED", sub: "2026-05-04" },
];
// Score sources for the history table: reviewer (weighted) vs AI, never mixed.
ALL[0].rev = { overall: 4.5 }; ALL[0].ai = { overall: 6.1 };
ALL[1].ai = { overall: 8.2 };   // AI only — no reviewer score

function mount() {
  useAdminData.mockImplementation((kind, params) =>
    params?.status === "evaluated"
      ? { data: { startups: EVAL }, loading: false, error: null, reload: vi.fn() }
      : { data: { startups: ALL }, loading: false, error: null, reload: vi.fn() });
  return render(<AdminGate1 goDetail={() => {}} />);
}

describe("ADM-11 batch decision groups by every batch", () => {
  it("chips count batch membership, including YES / comm", () => {
    mount();
    fireEvent.click(screen.getByText(/B · Batch decision/));
    expect(screen.getByRole("button", { name: "A (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "YES (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "comm (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unassigned (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "YES (1)" }));
    expect(screen.getByText("App-e2")).toBeTruthy();
    expect(screen.queryByText("App-e1")).toBeNull();
  });
});

describe("ADM-05 / ADM-19 decision history", () => {
  it("labels the tab and title as decisions, not 'Decide on N applications'", () => {
    mount();
    fireEvent.click(screen.getByText(/C · Decision history/));
    expect(screen.getByTestId("pagehead").textContent).toMatch(/4 decisions/);
  });

  it("shows the 1st-gate decision — a final-round reject still reads APPROVED at gate 1", () => {
    mount();
    fireEvent.click(screen.getByText(/C · Decision history/));
    const row = screen.getByText("FinalRej").closest("tr");
    expect(within(row).getByText("APPROVED")).toBeTruthy();
    expect(within(row).getByText(/final round: rejected/i)).toBeTruthy();
    // 2 of 4 selected at gate 1 → 50%
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("DATE shows decided_at when the backend sends it", () => {
    mount();
    fireEvent.click(screen.getByText(/C · Decision history/));
    const row = screen.getByText("Picked").closest("tr");
    expect(within(row).getByText("2026-07-10")).toBeTruthy();
  });
});

describe("Admin Review history score columns", () => {
  it("Reviewer column shows only the weighted reviewer score; AI has its own column", () => {
    mount();
    fireEvent.click(screen.getByText(/C · Decision history/));
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.some((h) => /Reviewer/.test(h))).toBe(true);
    expect(heads.some((h) => /^AI/.test(h))).toBe(true);
    const both = screen.getByText("Picked").closest("tr");
    expect(within(both).getByText("4.5")).toBeTruthy();
    expect(within(both).getByText("6.1")).toBeTruthy();
    const aiOnly = screen.getByText("FinalRej").closest("tr");
    // The AI 8.2 is shown once, in the AI column — the reviewer cell is "—".
    expect(within(aiOnly).getAllByText("8.2")).toHaveLength(1);
    const cells = within(aiOnly).getAllByRole("cell").map((c) => c.textContent);
    const revIdx = heads.findIndex((h) => /Reviewer/.test(h));
    expect(cells[revIdx]).toBe("—");
  });
});
