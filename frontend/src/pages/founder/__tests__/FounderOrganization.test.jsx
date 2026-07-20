import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderOrganization from "../FounderOrganization.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const TEAM = [
  { id: "m1", name: "Priya Ramachandran", title: "Co-founder / CEO", employment_type: "full-time", monthly_cost: 120000 },
  { id: "m2", name: "Arjun Mehta", title: "Firmware lead", employment_type: "full-time", monthly_cost: 95000 },
];

const APPROACH = {
  business_member_id: "m1", technology_member_id: "m2", product_member_id: null, customer_member_id: null,
};

const EXPENSE = {
  bom: [{ id: "b1", item: "MEMS mic array", qty: 2, unit_cost: 8200 }],
  equipment: [{ id: "e1", item: "Oscilloscope", cost: 45000 }],
  procurement: [],
  totals: { bom_total: 16400, equipment_total: 45000, capital_total: 61400, proc_estimate: 0, proc_quoted: 0, proc_committed: 0, proc_open_count: 0, proc_committed_count: 0, proc_variance: 0 },
  grant_amount: 2500000, budget_drawn: 0, budget_pct: 0,
};

function mockLoad({ team = TEAM, approach = APPROACH, expense = EXPENSE } = {}) {
  vi.spyOn(founderApi, "listTeam").mockResolvedValue(team);
  vi.spyOn(founderApi, "getApproach").mockResolvedValue(approach);
  vi.spyOn(founderApi, "getExpense").mockResolvedValue(expense);
}

describe("FounderOrganization — 3-step wizard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the 3-step stepper and the team table", async () => {
    mockLoad();
    render(<MemoryRouter><FounderOrganization /></MemoryRouter>);

    await screen.findByText("Organization building · Technology Innovator in Residence");
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("BOM & equipment")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 steps")).toBeInTheDocument();

    expect(screen.getByText(/Build your founding/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Priya Ramachandran")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Arjun Mehta")).toBeInTheDocument();
    // Monthly payroll footer = 120000 + 95000 = 215000 -> fmtL = ₹2.15L
    expect(screen.getByText("₹2.15L")).toBeInTheDocument();
    expect(screen.getByText("Headcount:")).toBeInTheDocument();
  });

  it("+ Add a team member calls addTeam and appends an editable row", async () => {
    mockLoad();
    const newRow = { id: "m9", name: "New team member", title: "", employment_type: "full-time", monthly_cost: 0 };
    vi.spyOn(founderApi, "addTeam").mockResolvedValue(newRow);

    render(<MemoryRouter><FounderOrganization /></MemoryRouter>);
    await screen.findByText("Organization building · Technology Innovator in Residence");

    fireEvent.click(screen.getByText("+ Add a team member"));

    await waitFor(() => expect(founderApi.addTeam).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByDisplayValue("New team member")).toBeInTheDocument());
  });

  it("Roles step renders 4 hat cards with an Owned-by select of team members", async () => {
    mockLoad();
    render(<MemoryRouter><FounderOrganization /></MemoryRouter>);
    await screen.findByText("Organization building · Technology Innovator in Residence");

    fireEvent.click(screen.getByText("Roles"));
    await screen.findByText("Who wears which", { exact: false });

    expect(screen.getByText("Business hat")).toBeInTheDocument();
    expect(screen.getByText("Technology hat")).toBeInTheDocument();
    expect(screen.getByText("Product hat")).toBeInTheDocument();
    expect(screen.getByText("Customer hat")).toBeInTheDocument();

    const selects = screen.getAllByText("Priya Ramachandran · Co-founder / CEO", { selector: "option" });
    expect(selects.length).toBeGreaterThan(0);
  });

  it("Roles step: changing a hat's owner calls putApproach", async () => {
    mockLoad();
    vi.spyOn(founderApi, "putApproach").mockResolvedValue({ ...APPROACH, product_member_id: "m2" });

    render(<MemoryRouter><FounderOrganization /></MemoryRouter>);
    await screen.findByText("Organization building · Technology Innovator in Residence");
    fireEvent.click(screen.getByText("Roles"));
    await screen.findByText("Product hat");

    const productCard = screen.getByText("Product hat").closest(".fj-hat-card");
    const select = productCard.querySelector("select");
    fireEvent.change(select, { target: { value: "m2" } });

    await waitFor(() => expect(founderApi.putApproach).toHaveBeenCalledWith(
      expect.objectContaining({ product_member_id: "m2" }),
    ));
  });

  it("BOM & equipment step renders both tables with subtotals", async () => {
    mockLoad();
    render(<MemoryRouter><FounderOrganization /></MemoryRouter>);
    await screen.findByText("Organization building · Technology Innovator in Residence");

    fireEvent.click(screen.getByText("BOM & equipment"));
    await screen.findByText("Capital and", { exact: false });

    expect(screen.getByDisplayValue("MEMS mic array")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Oscilloscope")).toBeInTheDocument();
    expect(screen.getByText("One-time capital total")).toBeInTheDocument();
    // BOM subtotal 16400 + equipment 45000 = 61400 -> ₹0.61L
    expect(screen.getByText("₹0.61L")).toBeInTheDocument();
  });
});
