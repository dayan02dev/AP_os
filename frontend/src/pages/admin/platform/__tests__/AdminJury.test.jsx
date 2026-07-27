// AdminJury v2 tests (Task 13).
//
// The v2 screen has two tabs (Applications / Jury Roster), a JuryInviteModal,
// enrichment-status chips, picked-by chips, and a Recommended-for filter that
// reactively reloads the pipeline with a `recommended_for` param.
//
// Seams mocked: hooks/useAdminData (data), lib/adminPlatformApi (network),
// screens/ManageJurorsDrawer (stubbed — has its own data deps). osAtoms + ui.jsx
// render for real (pure presentational).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createJuryInvites: vi.fn(),
    enrichJuror: vi.fn().mockResolvedValue({ ok: true }),
    recomputeRecommendations: vi.fn().mockResolvedValue({ status: "queued" }),
    autoAssignJury: vi.fn(),
  },
}));

// The drawer carries its own useAdminData("jurorApplications")/pipeline loads;
// stub it so AdminJury tests stay isolated to the roster + applications UI.
vi.mock("../screens/ManageJurorsDrawer", () => ({
  ManageJurorsDrawer: () => <div data-testid="manage-jurors-drawer" />,
}));

import { beforeEach as viBeforeEach } from "vitest";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminJury } from "../screens/AdminJury";

// The global setup runs vi.restoreAllMocks() after every test, which strips the
// factory-set resolved values — re-establish them before each test so the
// fire-and-forget enrich/recompute calls always return a thenable.
viBeforeEach(() => {
  adminPlatformApi.enrichJuror.mockResolvedValue({ ok: true });
  adminPlatformApi.recomputeRecommendations.mockResolvedValue({ status: "queued" });
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const JUROR_DONE = {
  id: "j1", name: "Anand Mahindra", email: "a@x.com",
  domains: ["Robotics"], domain: "Robotics",
  enrichmentStatus: "done", picks: "1 / 3", picksSubmitted: 1,
  weight: 1.0, last: "2026-06-20",
};
const JUROR_PENDING = {
  id: "j2", name: "Kiran Shaw", email: "k@x.com",
  domains: ["HealthTech"], domain: "HealthTech",
  enrichmentStatus: "pending", picks: "0 / 3", picksSubmitted: 0,
  weight: 1.0, last: "—",
};
const JUROR_FAILED = {
  id: "j3", name: "Nandan N", email: "n@x.com",
  domains: ["FinTech"], domain: "FinTech",
  enrichmentStatus: "failed", picks: "0 / 3", picksSubmitted: 0,
  weight: 2.0, last: "—",
};

const JURY_APP = {
  id: "app-1", track: "tir", name: "Karkhana Robotics", domain: "Robotics",
  chip: "JURY REVIEW", ai: { overall: 8.4 }, founders: ["Aanya"],
  jury_assigned_names: ["Anand Mahindra"],
  picked_by: [{ juror_user_id: "j1", name: "Anand Mahindra", note: "great fit" }],
  jury_assigned: 1, recommendation: null,
};
const SHORTLISTED_APP = {
  id: "app-2", track: "tir", name: "Should Not Show", domain: "Bio",
  chip: "SHORTLISTED", ai: { overall: 7 }, founders: [],
  jury_assigned_names: [], picked_by: [], jury_assigned: 0,
};

// stable return objects → the auto-queue effect (dep = jurors data) fires once
function setup({ jurors = [], startups = [], pendingInvites = [] } = {}) {
  const jurorsRet = {
    data: { jurors, pendingInvites }, loading: false, error: null, reload: vi.fn(),
  };
  const pipelineRet = {
    data: { startups }, loading: false, error: null, reload: vi.fn(),
  };
  useAdminData.mockImplementation((kind) => {
    if (kind === "jurors") return jurorsRet;
    if (kind === "pipeline") return pipelineRet;
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
  return { jurorsRet, pipelineRet };
}

describe("AdminJury v2 — roster tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders enrichment-status chips, domains, and picks", () => {
    setup({ jurors: [JUROR_DONE, JUROR_PENDING, JUROR_FAILED] });
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Jury Roster"));

    expect(screen.getByText("Anand Mahindra")).toBeTruthy();
    expect(screen.getByText("Robotics")).toBeTruthy();      // domain chip
    expect(screen.getByText("Enriched")).toBeTruthy();       // done
    expect(screen.getByText("Queued")).toBeTruthy();         // pending
    expect(screen.getByText("Failed")).toBeTruthy();         // failed
    expect(screen.getByText("Re-run")).toBeTruthy();         // failed → re-run
    expect(screen.getByText("1 / 3")).toBeTruthy();          // picks for done juror
  });

  it("Re-run on a failed juror calls enrichJuror", () => {
    setup({ jurors: [JUROR_FAILED] });
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Jury Roster"));
    fireEvent.click(screen.getByText("Re-run"));
    expect(adminPlatformApi.enrichJuror).toHaveBeenCalledWith("j3");
  });

  it("auto-queues enrichment for pending jurors on mount", async () => {
    setup({ jurors: [JUROR_PENDING, JUROR_DONE] });
    render(<AdminJury />);
    await waitFor(() =>
      expect(adminPlatformApi.enrichJuror).toHaveBeenCalledWith("j2"));
    expect(adminPlatformApi.enrichJuror).not.toHaveBeenCalledWith("j1");
  });

  it("empty roster shows the invite hint", () => {
    setup({ jurors: [] });
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Jury Roster"));
    expect(screen.getByText(/No jury members yet/i)).toBeTruthy();
  });

  it("renders the pending-invites strip", () => {
    setup({
      jurors: [JUROR_DONE],
      pendingInvites: [{ name: "Dr. Rao", email: "rao@x.com", sent_at: "2026-07-01" }],
    });
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Jury Roster"));
    expect(screen.getByText("Dr. Rao")).toBeTruthy();
    expect(screen.getByText("rao@x.com")).toBeTruthy();
  });
});

describe("AdminJury v2 — applications tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides non-JURY-REVIEW rows", () => {
    setup({ startups: [JURY_APP, SHORTLISTED_APP] });
    render(<AdminJury />);
    expect(screen.getByText("Karkhana Robotics")).toBeTruthy();
    expect(screen.queryByText("Should Not Show")).toBeNull();
  });

  it("shows assigned-juror and picked-by chips", () => {
    setup({ startups: [JURY_APP] });
    render(<AdminJury />);
    // Name appears in both the Assigned-jurors chip and the Picked-by chip.
    expect(screen.getAllByText("Anand Mahindra").length).toBeGreaterThanOrEqual(2);
  });

  it("selecting a Recommended-for juror reloads the pipeline with recommended_for", async () => {
    setup({ jurors: [JUROR_DONE], startups: [JURY_APP] });
    render(<AdminJury />);
    fireEvent.change(screen.getByLabelText("Recommended for"), {
      target: { value: "j1" },
    });
    await waitFor(() =>
      expect(useAdminData).toHaveBeenCalledWith("pipeline", { recommended_for: "j1" }));
  });

  it("Recompute calls recomputeRecommendations for the selected juror", () => {
    setup({ jurors: [JUROR_DONE], startups: [JURY_APP] });
    render(<AdminJury />);
    fireEvent.change(screen.getByLabelText("Recommended for"), {
      target: { value: "j1" },
    });
    fireEvent.click(screen.getByText("Recompute"));
    expect(adminPlatformApi.recomputeRecommendations).toHaveBeenCalledWith("j1");
  });
});

describe("AdminJury v2 — refresh suggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Refresh AI suggestions recomputes for all jurors (no juror id) and does not assign", async () => {
    adminPlatformApi.recomputeRecommendations.mockResolvedValue({ queued: ["j1", "j2"] });
    setup({ jurors: [JUROR_DONE] });
    render(<AdminJury />);
    fireEvent.click(screen.getByText(/Refresh AI suggestions/i));
    await waitFor(() =>
      expect(adminPlatformApi.recomputeRecommendations).toHaveBeenCalledWith());
    expect(adminPlatformApi.autoAssignJury).not.toHaveBeenCalled();
  });

  it("is enabled even when no juror has matchedAt yet", () => {
    setup({ jurors: [JUROR_DONE] });
    render(<AdminJury />);
    expect(screen.getByText(/Refresh AI suggestions/i).closest("button")).not.toBeDisabled();
  });
});

describe("AdminJury v2 — invite modal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the entered rows and renders per-row result chips", async () => {
    adminPlatformApi.createJuryInvites.mockResolvedValue({
      results: [
        { email: "a@x.com", status: "invited", form_url: "/jury/respond/t1" },
        { email: "b@x.com", status: "already_invited", form_url: "/jury/respond/t2" },
      ],
    });
    setup({});
    render(<AdminJury />);

    fireEvent.click(screen.getByText("Invite member"));

    let names = screen.getAllByLabelText("Invite name");
    let emails = screen.getAllByLabelText("Invite email");
    fireEvent.change(names[0], { target: { value: "A" } });
    fireEvent.change(emails[0], { target: { value: "a@x.com" } });

    fireEvent.click(screen.getByText("Add another"));
    names = screen.getAllByLabelText("Invite name");
    emails = screen.getAllByLabelText("Invite email");
    fireEvent.change(names[1], { target: { value: "B" } });
    fireEvent.change(emails[1], { target: { value: "b@x.com" } });

    fireEvent.click(screen.getByText("Send invites"));

    await waitFor(() =>
      expect(adminPlatformApi.createJuryInvites).toHaveBeenCalledWith([
        { name: "A", email: "a@x.com" },
        { name: "B", email: "b@x.com" },
      ]));

    expect(await screen.findByText("Invited")).toBeTruthy();
    expect(screen.getByText("Already invited")).toBeTruthy();
  });

  it("has no password field", () => {
    setup({});
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Invite member"));
    expect(screen.queryByText(/password/i)).toBeNull();
  });
});
