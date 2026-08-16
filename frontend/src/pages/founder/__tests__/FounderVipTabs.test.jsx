import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";
import { api } from "../../../lib/api.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

const me = (locked) => ({
  status: locked ? "offered" : "onboarded", track: "sip",
  project_name: "Dharini", mou_signed: !locked,
  locked: { cohort: locked, dashboard: locked },
});

describe("VIP cohort tabs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the TLR evaluation screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    vi.spyOn(founderApi, "getAir").mockResolvedValue({
      catalog: { levers: [], questions: {}, criteria: {}, documents: {} },
      round: { id: "r1", round_label: "FY26-27-Q2", status: "draft", submitted_at: null, verified_at: null },
      levers: [],
      rollups: { claimed: { technology: null, commercial: null, overall: null }, verified: { technology: null, commercial: null, overall: null } },
    });
    render(<MemoryRouter><FounderPortal tab="tlr" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/ARTPARK Innovation Readiness/i)).toBeInTheDocument());
  });

  it("renders the MIS screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    vi.spyOn(founderApi, "getMis").mockResolvedValue({
      catalog: {
        kinds: ["monthly", "quarterly"],
        sections: { monthly: [], quarterly: [] },
        narrative_fields: {}, entry_fields: {}, metrics: [], metric_groups: [],
        headcount_categories: [], financial_series: {}, financial_buckets: { needs: [] },
      },
      monthly: [{ period_key: "2026-06", label: "Jun 2026", status: "draft", due_date: "2026-07-05", overdue: false }],
      quarterly: [],
    });
    render(<MemoryRouter><FounderPortal tab="mis" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Monthly and quarterly reporting/i)).toBeInTheDocument());
    // Real content, not the old placeholder: the kind tab and the fetched
    // period's own label both come from the real FounderMis shell.
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
  });

  it("locks both VIP tabs until the MOU is signed", async () => {
    for (const tab of ["tlr", "mis"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(true));
      const { unmount } = render(<MemoryRouter><FounderPortal tab={tab} /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText(/sign your MOU/i)).toBeInTheDocument());
      unmount();
    }
  });

  it("hides Push to procurement for a VIP founder but keeps it for TIR", async () => {
    vi.spyOn(founderApi, "getStore").mockResolvedValue({
      catalog: [], cart: [{ product_id: "p1", name: "Thing", qty: 1, unit_price: 100, line_total: 100 }],
      cart_subtotal: 100,
    });

    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "sip" });
    const vip = render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cart/ }));
    expect(screen.queryByText(/Push to procurement/i)).not.toBeInTheDocument();
    vip.unmount();

    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "tir" });
    render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cart/ }));
    await waitFor(() => expect(screen.getByText(/Push to procurement/i)).toBeInTheDocument());
  });

  it("shows the real VIP process dashboard on the dashboard tab, not the TIR residency dashboard", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "sip", project_name: "Dharini" });
    vi.spyOn(founderApi, "getAir").mockResolvedValue({
      catalog: { levers: [], questions: {}, criteria: {}, documents: {} },
      round: { id: "r1", round_label: "FY26-27-Q2", status: "draft", submitted_at: null, verified_at: null },
      levers: [],
      rollups: { claimed: { technology: null, commercial: null, overall: null }, verified: { technology: null, commercial: null, overall: null } },
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue({
      catalog: { metrics: [] },
      monthly: [],
      quarterly: [],
    });
    render(<MemoryRouter><FounderPortal tab="dashboard" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Dharini")).toBeInTheDocument());
    expect(screen.queryByText(/Residency dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TIR ·/)).not.toBeInTheDocument();
  });

  it("still shows the residency dashboard for a TIR founder", async () => {
    vi.spyOn(founderApi, "getResidency").mockResolvedValue({
      app: { project_name: "Dharini", cohort: "Cohort 04", team_names: [], week: 1, weeks_total: 24, weeks_remaining: 23 },
      tiles: { derisking_pct: 0, validated: 0, total_experiments: 0, tasks_done: 0, tasks_total: 0, budget_drawn: 0, budget_pct: 0, next_milestone: null },
      experiments: [],
      feed: [],
      expense: { monthly_payroll: 0, payroll_drawn: 0, bom_total: 0, equip_total: 0, remaining: 0, segments: {}, proc_committed: 0, proc_quoted: 0, proc_count: 0 },
    });
    vi.spyOn(founderApi, "listTeam").mockResolvedValue([]);
    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "tir" });
    render(<MemoryRouter><FounderPortal tab="dashboard" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Residency dashboard")).toBeInTheDocument());
    expect(screen.getByText(/TIR ·/)).toBeInTheDocument();
  });

  it("fetches the VIP application from the sip endpoint, not the TIR one", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([{ id: "a1" }]);
    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "sip" });
    render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/sip-applications/me/submitted"));
    expect(get).not.toHaveBeenCalledWith("/applications/me/submitted");
  });
});
