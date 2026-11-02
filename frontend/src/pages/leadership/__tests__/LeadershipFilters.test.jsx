// Leadership filters end to end — every control on the Applications tab and
// the Dashboard-tab click-throughs, driven through the real
// LeadershipDashboard against an in-memory backend double that applies the
// same filter rules as leadership.py. "fix:" tests pin regressions fixed in
// LF-1/4/5/6/9/10.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "lead@x.io", roles: ["leadership"] }, logout: () => {} }),
}));
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getStats: vi.fn(),
    getIndustryCategories: vi.fn(),
    listApplications: vi.fn(),
    getApplication: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock("../../../lib/icDocumentsApi.js", () => ({
  icDocumentsApi: { list: vi.fn(() => Promise.resolve({ documents: [] })) },
}));

import LeadershipDashboard from "../LeadershipDashboard.jsx";
import { stageQuery, STAGES } from "../pipelineStages.js";
import { readReviewIdList, ID_LIST_KEY } from "../reviewNav.js";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { clearStickyState, writeStickyState } from "../../../hooks/useStickyState.js";

// ── fixture rows (shape of GET /leadership/applications) ──────────────
const mk = (id, over) => ({
  id, track: "tir", native_track: "tir", display_id: `TIR-${id}`, status: "under_review",
  pipeline_stage: "under_review", project_name: `P-${id}`, founder: { name: `F-${id}`, affiliation: "O" },
  industry: { id: "rob", label: "Robotics" }, stage: { label: "Lab" }, ai_score_overall: 7.1,
  submitted_at: "2026-07-01T00:00:00Z", reco: { yes: 0, maybe: 0, no: 0 }, review_count: 0, ...over,
});

let ROWS;
function seed(n = 0) {
  ROWS = [
    mk("T1", { status: "submitted", pipeline_stage: "submitted", ai_score_overall: 9.2 }),
    // raw submitted + gate-1 reject decision: backend stage=submitted, status overlaid
    mk("T2", { status: "rejected", pipeline_stage: "submitted", gate1_decision: "rejected", gate2_decision: null }),
    mk("T3", { status: "evaluated", pipeline_stage: "reviewed", industry: { id: "cli", label: "Climate" },
      reco: { yes: 2, maybe: 0, no: 0 }, review_count: 2 }),
    mk("T4", { status: "rejected", pipeline_stage: "gate1_rejected", gate2_decision: null, ai_score_overall: 3.4 }),
    mk("T5", { status: "rejected", pipeline_stage: "final_rejected", gate2_decision: "rejected" }),
    mk("T6", { status: "jury_review", pipeline_stage: "final_pending", final_selected: false }),
    mk("T7", { status: "jury_review", pipeline_stage: "final_selected", final_selected: true }),
    mk("S1", { track: "sip", native_track: "sip", display_id: "VIP-S1", industry: { id: "cli", label: "Climate" },
      reco: { yes: 1, maybe: 0, no: 0 }, review_count: 1 }),
    mk("S2", { track: "sip", native_track: "sip", display_id: "VIP-S2", status: "ai_screening", pipeline_stage: "submitted",
      industry: null, ai_score_overall: null }),
    mk("M1", { track: "sip", native_track: "tir", moved_to_track: "sip", status: "evaluated", pipeline_stage: "reviewed" }),
  ];
  for (let i = 0; i < n; i += 1) ROWS.push(mk(`X${i}`, { project_name: `Bulk-${i}` }));
}

const SERVER_STAGES = ["reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"];
function backend(p = {}) {
  let rows = ROWS.slice();
  if (p.track) rows = rows.filter((r) => r.track === p.track);
  if (SERVER_STAGES.includes(p.status)) rows = rows.filter((r) => r.pipeline_stage === p.status);
  else if (p.status) rows = rows.filter((r) => (r.status === "rejected" && r.pipeline_stage === "submitted" ? "submitted" : r.status) === p.status);
  if (p.industry === "unclassified") rows = rows.filter((r) => !r.industry);
  else if (p.industry) rows = rows.filter((r) => r.industry?.id === p.industry);
  if (p.ai_score_bucket != null) {
    rows = rows.filter((r) => r.ai_score_overall != null
      && Math.min(9, Math.floor(r.ai_score_overall)) === Number(p.ai_score_bucket));
  }
  if (p.search) {
    const s = p.search.toLowerCase();
    rows = rows.filter((r) => r.project_name.toLowerCase().includes(s) || r.display_id.toLowerCase().includes(s));
  }
  if (p.recommendation) {
    rows = rows.filter((r) => {
      const t = r.reco; const n = t.yes + t.maybe + t.no;
      const v = n < 2 ? null : t.yes >= 2 && t.no < 2 ? "yes" : t.no >= 2 && t.yes < 2 ? "no" : "maybe";
      return (v || (r.review_count === 1 ? "single" : "none")) === p.recommendation;
    });
  }
  if (p.sort === "project") {
    rows.sort((a, b) => a.project_name.localeCompare(b.project_name) * (p.order === "desc" ? -1 : 1));
  }
  const off = Number(p.offset || 0); const lim = Number(p.limit || 50);
  return { applications: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off };
}

const STATS = {
  totals: { apps_submitted: 10, tir_count: 7, sip_count: 3, avg_ai_score: 7 },
  funnel: {},
  ai_score_overalls: [9.2, 7.1, 7.1, 3.4, 7.1, 7.1, 7.1, 7.1, 7.1],
  pipeline_breakdown: {
    total: 10,
    stages: { submitted: 3, under_review: 1, reviewed: 2, gate1_rejected: 1, final_pending: 1,
      final_rejected: 1, final_selected: 1, offered: 0, onboarded: 0, on_hold: 0, waitlisted: 0, withdrawn: 0 },
    by_track: {
      tir: { total: 7, stages: { submitted: 2, under_review: 0, reviewed: 1, gate1_rejected: 1, final_pending: 1,
        final_rejected: 1, final_selected: 1, offered: 0, onboarded: 0, on_hold: 0, waitlisted: 0, withdrawn: 0 } },
      sip: { total: 3, stages: { submitted: 1, under_review: 1, reviewed: 1, gate1_rejected: 0, final_pending: 0,
        final_rejected: 0, final_selected: 0, offered: 0, onboarded: 0, on_hold: 0, waitlisted: 0, withdrawn: 0 } },
    },
  },
};

function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
function renderDash() {
  return render(
    <MemoryRouter initialEntries={["/leadership"]}>
      <Routes>
        <Route path="/leadership" element={<LeadershipDashboard />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const calls = () => leadershipApi.listApplications.mock.calls.map((c) => c[0]);
// The visible page's request (limit 50). Full-list fetches (limit 200: CSV,
// review list, filtered AI-chip counts) are asserted separately.
const lastCall = () => calls().filter((c) => c.limit !== 200).at(-1);
const visibleIds = () => screen.queryAllByRole("row").slice(1)
  .map((tr) => (tr.querySelector(".lp-id-col")?.textContent || "").trim());

async function openApps() {
  renderDash();
  fireEvent.click(screen.getByRole("button", { name: /^Applications/i }));
  await waitFor(() => expect(screen.getByText("P-T1")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
}
const chip = (re) => screen.getAllByRole("button").find((b) => re.test(b.textContent.trim()));

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  clearStickyState();
  sessionStorage.removeItem(ID_LIST_KEY);
  seed();
  leadershipApi.getStats.mockResolvedValue(STATS);
  leadershipApi.getIndustryCategories.mockResolvedValue({
    categories: [{ id: "rob", label: "Robotics", count: 7 }, { id: "cli", label: "Climate", count: 2 }],
    total: 9, unclassified: { count: 1 },
  });
  leadershipApi.listApplications.mockImplementation((p) => Promise.resolve(backend(p)));
});

// ── pure stage → query mapping ────────────────────────────────────────
describe("stageQuery", () => {
  it("ok: server stages + single-status stages go to the API as `status`", () => {
    for (const id of SERVER_STAGES) expect(stageQuery(id)).toEqual({ status: id, keep: null });
    for (const id of ["under_review", "offered", "onboarded", "on_hold", "waitlisted", "withdrawn"]) {
      expect(stageQuery(id).status).toBe(STAGES.find((s) => s.id === id).statuses[0]);
      expect(stageQuery(id).keep).toBeNull();
    }
  });
  it("fix (LF-6): `submitted` keep() narrows on pipeline_stage, not the overlaid row.status", () => {
    const { status, keep } = stageQuery("submitted");
    expect(status).toBeUndefined();
    const row = { status: "rejected", pipeline_stage: "submitted", gate1_decision: "rejected" };
    expect(keep(row, {})).toBe(true); // backend counts it in the Submitted chip
    expect(keep({ status: "submitted", pipeline_stage: "under_review" }, {})).toBe(false);
    // Rows without pipeline_stage (older backend) fall back to the raw status.
    expect(keep({ status: "ai_screening" }, {})).toBe(true);
    expect(keep({ status: "rejected" }, {})).toBe(false);
  });
});

// ── every control, through the UI ─────────────────────────────────────
describe("Applications tab controls", () => {
  it("ok: track chips send effective track and narrow rows; All tracks clears", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    await waitFor(() => expect(lastCall().track).toBe("sip"));
    await waitFor(() => expect(visibleIds().sort()).toEqual(["TIR-M1 → VIP", "VIP-S1", "VIP-S2"].sort()));
    fireEvent.click(screen.getByRole("button", { name: "All tracks" }));
    await waitFor(() => expect(lastCall().track).toBeUndefined());
  });

  it.each(SERVER_STAGES)("ok: stage chip %s → status=<stage>, rows match chip count", async (id) => {
    await openApps();
    const label = STAGES.find((s) => s.id === id).label;
    fireEvent.click(chip(new RegExp(`^${label}`)));
    await waitFor(() => expect(lastCall().status).toBe(id));
    await waitFor(() => expect(visibleIds()).toHaveLength(STATS.pipeline_breakdown.stages[id]));
  });

  it("ok: Under review chip → status=under_review", async () => {
    await openApps();
    fireEvent.click(chip(/^Under review/));
    await waitFor(() => expect(lastCall().status).toBe("under_review"));
    await waitFor(() => expect(visibleIds()).toEqual(["VIP-S1"]));
  });

  it("fix (LF-6): Submitted chip count (3) = rows listed", async () => {
    await openApps();
    fireEvent.click(chip(/^Submitted\s*3/));
    await waitFor(() => expect(screen.queryByText("Loading applications…")).toBeNull());
    await waitFor(() => expect(visibleIds().length).toBeGreaterThan(0));
    expect(visibleIds().sort()).toEqual(["TIR-T1", "TIR-T2", "VIP-S2"]);
  });

  it("ok: AI score chip → ai_score_bucket, rows narrowed", async () => {
    await openApps();
    fireEvent.click(chip(/^3–4$/));
    await waitFor(() => expect(lastCall().ai_score_bucket).toBe(3));
    await waitFor(() => expect(visibleIds()).toEqual(["TIR-T4"]));
  });

  it("ok: industry chip → industry=<id>", async () => {
    await openApps();
    fireEvent.click(chip(/^Climate/));
    await waitFor(() => expect(lastCall().industry).toBe("cli"));
    await waitFor(() => expect(visibleIds().sort()).toEqual(["TIR-T3", "VIP-S1"]));
  });

  it.each([["Yes", "yes", ["TIR-T3"]], ["1 review", "single", ["VIP-S1"]]])(
    "ok: reco chip %s → recommendation=%s", async (label, v, ids) => {
      await openApps();
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(lastCall().recommendation).toBe(v));
      await waitFor(() => expect(visibleIds()).toEqual(ids));
    });

  it("ok: search is debounced, trimmed, prefix-stripped and resets the page", async () => {
    await openApps();
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "  TIR-T3 " } });
    await waitFor(() => expect(lastCall().search).toBe("T3"), { timeout: 2000 });
    expect(lastCall().offset).toBe(0);
  });

  it("ok: combined filters are all sent together", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    fireEvent.click(chip(/^Climate/));
    fireEvent.click(screen.getByRole("button", { name: "1 review" }));
    await waitFor(() => expect(lastCall()).toMatchObject({ track: "sip", industry: "cli", recommendation: "single" }));
    await waitFor(() => expect(visibleIds()).toEqual(["VIP-S1"]));
  });

  it("ok: header sort → sort/order server-side, toggles direction, resets offset", async () => {
    await openApps();
    const th = () => screen.getAllByRole("columnheader").find((h) => h.textContent.startsWith("Project"));
    fireEvent.click(th());
    await waitFor(() => expect(lastCall()).toMatchObject({ sort: "project", order: "asc", offset: 0 }));
    fireEvent.click(th());
    await waitFor(() => expect(lastCall()).toMatchObject({ sort: "project", order: "desc" }));
  });

  it("ok: pagination Next/Previous move offset by 50", async () => {
    seed(60);
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(lastCall().offset).toBe(50));
    await waitFor(() => expect(screen.getByText(/Showing 51–70 of 70/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    await waitFor(() => expect(lastCall().offset).toBe(0));
  });

  it("ok: filters are sticky across unmount/remount; Clear filters resets", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    fireEvent.click(chip(/^Climate/));
    await waitFor(() => expect(lastCall()).toMatchObject({ track: "sip", industry: "cli" }));
    cleanup();
    renderDash();
    await waitFor(() => expect(lastCall()).toMatchObject({ track: "sip", industry: "cli" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(lastCall()).toMatchObject({ track: undefined, industry: undefined }));
  });

  it("fix (LF-9): a stale sticky offset past the end resets to page 1", async () => {
    writeStickyState("leadership", "view", "applications");
    writeStickyState("leadership", "offset", 100);
    renderDash();
    await waitFor(() => expect(calls().some((c) => c.offset === 100)).toBe(true));
    await waitFor(() => expect(lastCall().offset).toBe(0));
    await waitFor(() => expect(visibleIds()).toHaveLength(10));
    expect(screen.getByText(/Showing 1–10 of 10/)).toBeTruthy();
  });

  it("fix (LF-9): an offset past the end of a filtered list lands on its last page", async () => {
    seed(60); // 70 rows; 67 match the Robotics industry
    writeStickyState("leadership", "view", "applications");
    writeStickyState("leadership", "industry", "rob");
    writeStickyState("leadership", "offset", 150);
    renderDash();
    await waitFor(() => expect(lastCall()).toMatchObject({ industry: "rob", offset: 50 }));
    await waitFor(() => expect(screen.getByText(/Showing 51–67 of 67/)).toBeTruthy());
  });

  it("ok: Clear filters resets every dimension, page included", async () => {
    seed(60);
    await openApps();
    fireEvent.click(chip(/^3–4$/));
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    fireEvent.click(chip(/^Climate/));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "T" } });
    await waitFor(() => expect(lastCall()).toMatchObject({
      track: "tir", industry: "cli", ai_score_bucket: 3, recommendation: "yes", search: "T",
    }), { timeout: 2000 });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(lastCall()).toMatchObject({
      track: undefined, industry: undefined, ai_score_bucket: undefined,
      recommendation: undefined, search: undefined, status: undefined, offset: 0,
    }));
    await waitFor(() => expect(screen.getByText(/Showing 1–50 of 70/)).toBeTruthy());
  });

  it("ok: a stage chip combined with track sends both and lists the intersection", async () => {
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    await waitFor(() => expect(lastCall().track).toBe("tir"));
    fireEvent.click(chip(/^Final rejected/));
    await waitFor(() => expect(lastCall()).toMatchObject({ track: "tir", status: "final_rejected" }));
    await waitFor(() => expect(visibleIds()).toEqual(["TIR-T5"]));
  });

  it("ok: re-clicking an active Applications-tab chip toggles it off", async () => {
    await openApps();
    fireEvent.click(chip(/^Climate/));
    await waitFor(() => expect(lastCall().industry).toBe("cli"));
    fireEvent.click(chip(/^Climate/));
    await waitFor(() => expect(lastCall().industry).toBeUndefined());
  });

  it("fix (LF-10): AI chip counts follow the other active filters", async () => {
    await openApps();
    const aiChip = (label) => screen.getAllByRole("button").find((b) => b.textContent.trim() === label);
    // Unfiltered: the global histogram (seven 7.x scores).
    expect(aiChip("7–8").title).toMatch(/· 7 applications/);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    // VIP rows: S1 7.1, M1 7.1, S2 unscored → 2 in 7–8, 0 in 9–10 (T1 is TIR).
    await waitFor(() => expect(aiChip("7–8").title).toMatch(/· 2 applications/));
    expect(aiChip("9–10").disabled).toBe(true);
    expect(aiChip("3–4").disabled).toBe(true);
    // The counts come from one full-list fetch with every filter but the AI bucket.
    expect(calls().some((c) => c.limit === 200 && c.track === "sip" && c.ai_score_bucket === undefined)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All tracks" }));
    await waitFor(() => expect(aiChip("7–8").title).toMatch(/· 7 applications/));
    expect(aiChip("9–10").disabled).toBe(false);
  });

  it("ok: AI chip counts are not fetched while the filter panel is closed", async () => {
    writeStickyState("leadership", "view", "applications");
    writeStickyState("leadership", "track", "sip");
    renderDash();
    await waitFor(() => expect(lastCall()?.track).toBe("sip"));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls().some((c) => c.limit === 200 && c.track === "sip")).toBe(false);
  });
});

// ── Review Prev/Next walks the filtered list ──────────────────────────
describe("Review page id-list", () => {
  it("ok: opening a review stores the filtered list (full list once fetched)", async () => {
    seed(60);
    await openApps();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    await waitFor(() => expect(visibleIds()).toHaveLength(3));
    fireEvent.click(screen.getByText("P-S1"));
    fireEvent.click(await screen.findByRole("button", { name: /Review application/ }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/leadership/applications/sip/S1/review"));
    expect(readReviewIdList().map((e) => e.id).sort()).toEqual(["M1", "S1", "S2"]);
  });

  it("fix (LF-1): a slow background full-list fetch from an EARLIER open does not overwrite the filtered list", async () => {
    seed(60); // 70 rows → unfiltered list > 1 page → background fetch
    let release;
    const gate = new Promise((r) => { release = r; });
    leadershipApi.listApplications.mockImplementation(async (p) => {
      if (p.limit === 200 && !p.track) await gate; // the unfiltered "all" fetch is slow
      return backend(p);
    });
    // 1) open a review from the UNFILTERED list → background fetch pending
    await openApps();
    fireEvent.click(screen.getByText("P-T1"));
    fireEvent.click(await screen.findByRole("button", { name: /Review application/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toBeTruthy());
    cleanup();
    // 2) come back, filter VIP, open a review → VIP list (fits one page) stored
    renderDash();
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    await waitFor(() => expect(visibleIds()).toHaveLength(3));
    fireEvent.click(screen.getByText("P-S1"));
    fireEvent.click(await screen.findByRole("button", { name: /Review application/ }));
    await waitFor(() => expect(readReviewIdList().map((e) => e.id).sort()).toEqual(["M1", "S1", "S2"]));
    // 3) the stale unfiltered fetch lands
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(readReviewIdList().map((e) => e.id).sort()).toEqual(["M1", "S1", "S2"]);
  });
});

// ── Dashboard-tab click-throughs (breakdown cells, histogram, industry bars) ──
describe("Dashboard-tab click-throughs", () => {
  const industryBar = (label) => screen.getAllByRole("button")
    .find((b) => b.classList.contains("lp-ind-row") && b.textContent.startsWith(label));

  it("ok: clicking an industry bar filters and switches to Applications", async () => {
    renderDash();
    await waitFor(() => expect(industryBar("Climate")).toBeTruthy());
    fireEvent.click(industryBar("Climate"));
    await waitFor(() => expect(lastCall()?.industry).toBe("cli"));
    await waitFor(() => expect(visibleIds().sort()).toEqual(["TIR-T3", "VIP-S1"]));
  });

  it("fix (LF-4): re-clicking the same bar after returning to Dashboard re-applies the filter and shows the list", async () => {
    renderDash();
    await waitFor(() => expect(industryBar("Climate")).toBeTruthy());
    fireEvent.click(industryBar("Climate"));
    await waitFor(() => expect(visibleIds()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Dashboard/ }));
    await waitFor(() => expect(industryBar("Climate")).toBeTruthy());
    fireEvent.click(industryBar("Climate"));
    await waitFor(() => expect(screen.queryByLabelText("Search applications")).not.toBeNull(), { timeout: 500 });
    await waitFor(() => expect(lastCall().industry).toBe("cli"));
    await waitFor(() => expect(visibleIds()).toHaveLength(2));
  });

  it("fix (LF-4): re-clicking the active breakdown stage re-applies it and shows the list", async () => {
    writeStickyState("leadership", "stage", "reviewed");
    renderDash();
    const cell = await waitFor(() => {
      const b = screen.getAllByRole("button").find((x) => /Reviewed/.test(x.textContent) && x.closest(".lp-card, section, div"));
      expect(b).toBeTruthy();
      return b;
    });
    fireEvent.click(cell);
    await waitFor(() => expect(screen.queryByLabelText("Search applications")).not.toBeNull());
    await waitFor(() => expect(lastCall().status).toBe("reviewed"));
  });

  it("fix (LF-4/5): a histogram bar click always filters, clears hidden filters and shows the list", async () => {
    writeStickyState("leadership", "scoreBucket", 3);
    writeStickyState("leadership", "track", "sip");
    renderDash();
    const bar = await screen.findByRole("button", { name: /Show 1 application in score range 3–4/ });
    fireEvent.click(bar);
    await waitFor(() => expect(screen.queryByLabelText("Search applications")).not.toBeNull());
    await waitFor(() => expect(lastCall()).toMatchObject({ ai_score_bucket: 3, track: undefined }));
    await waitFor(() => expect(visibleIds()).toEqual(["TIR-T4"]));
  });

  it("fix (LF-5): a dashboard click-through clears hidden sticky filters, so the list = the bar count", async () => {
    writeStickyState("leadership", "track", "tir");
    writeStickyState("leadership", "reco", "yes");
    renderDash();
    await waitFor(() => expect(industryBar("Robotics")).toBeTruthy());
    fireEvent.click(industryBar("Robotics")); // bar says 7 (global)
    await waitFor(() => expect(lastCall()?.industry).toBe("rob"));
    expect(lastCall()).toMatchObject({ track: undefined, recommendation: undefined });
    await waitFor(() => expect(visibleIds()).toHaveLength(7));
  });
});
