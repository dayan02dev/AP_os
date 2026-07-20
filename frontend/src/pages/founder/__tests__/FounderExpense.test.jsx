import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import FounderExpense from "../FounderExpense.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const EXPENSE_DATA = {
  bom: [], equipment: [],
  procurement: [
    { id: "p1", item: "MEMS mic array", category: "BOM", qty: 2, estimate: 8200, vendor: "Knowles", quote: 8500, lead_weeks: 4, status: "quoted" },
    { id: "p2", item: "Oscilloscope", category: "Equipment", qty: 1, estimate: 45000, vendor: "", quote: 0, lead_weeks: 2, status: "estimate" },
  ],
  totals: {
    bom_total: 0, equipment_total: 0, capital_total: 0,
    proc_estimate: 600000, proc_quoted: 650000, proc_committed: 0,
    proc_open_count: 2, proc_committed_count: 0, proc_variance: 50000,
  },
  grant_amount: 2500000, budget_drawn: 0, budget_pct: 0,
};

function mockLoad(data = EXPENSE_DATA) {
  vi.spyOn(founderApi, "getExpense").mockResolvedValue(data);
}

describe("FounderExpense — Procurement page", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the 4 stat tiles and the line-item table", async () => {
    mockLoad();
    render(<FounderExpense />);

    await screen.findByText("Procurement");
    expect(screen.getByText(/Turn your BOM into/)).toBeInTheDocument();

    // Estimated / Quoted totals appear both in the stat tile and the table's
    // Totals footer row (matches the mockup's procEstLabel/procQuotedLabel reuse).
    expect(screen.getAllByText("₹6L").length).toBe(2);
    expect(screen.getAllByText("₹6.5L").length).toBe(2);
    expect(screen.getByText(/vs estimate/)).toBeInTheDocument();
    expect(screen.getByText("₹0L")).toBeInTheDocument(); // Committed
    expect(screen.getByText("2 open · 0 committed")).toBeInTheDocument();

    expect(screen.getByDisplayValue("MEMS mic array")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Knowles")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Oscilloscope")).toBeInTheDocument();
  });

  it("+ Add a line item calls addProcurement and reloads the bundle", async () => {
    mockLoad();
    vi.spyOn(founderApi, "addProcurement").mockResolvedValue({
      id: "p9", item: "New line item", category: "BOM", qty: 1, estimate: 0,
      vendor: "", quote: 0, lead_weeks: 4, status: "estimate",
    });

    render(<FounderExpense />);
    await screen.findByText("Procurement");
    await waitFor(() => expect(founderApi.getExpense).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("+ Add a line item"));

    await waitFor(() => expect(founderApi.addProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ item: "New line item", category: "BOM" }),
    ));
    await waitFor(() => expect(founderApi.getExpense).toHaveBeenCalledTimes(2));
  });

  it("Sync from BOM & equipment calls syncProcurement then reloads the bundle", async () => {
    mockLoad();
    vi.spyOn(founderApi, "syncProcurement").mockResolvedValue(EXPENSE_DATA.procurement);

    render(<FounderExpense />);
    await screen.findByText("Procurement");
    await waitFor(() => expect(founderApi.getExpense).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("↺ Sync from BOM & equipment"));

    await waitFor(() => expect(founderApi.syncProcurement).toHaveBeenCalled());
    await waitFor(() => expect(founderApi.getExpense).toHaveBeenCalledTimes(2));
  });
});
