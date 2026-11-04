// SWARM2 admin_pipeline — Applications / Rejected tab + Dashboard repros at 837ccf0.
// Every test asserts the CORRECT behaviour, so it FAILS while the bug exists.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    getPipeline: vi.fn(), getBatches: vi.fn(), bulkDecide: vi.fn(), deleteBatch: vi.fn(),
    renameBatch: vi.fn(), createBatch: vi.fn(), assignBatch: vi.fn(),
    removeAppFromBatch: vi.fn(), unassignBatch: vi.fn(), getStats: vi.fn(),
  },
}));

import { AdminPipeline } from "../screens/AdminPipeline.jsx";
import { AdminDashboard } from "../screens/AdminDashboard.jsx";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";

const row = (id, status, extra = {}) => ({
  id, applicationId: `TIR-${id}`, track: "tir", native_track: "tir", name: `App-${id}`,
  founder: "F", industry: "Robotics", stage: "Idea", ai_score_overall: 7, status,
  decision: null, batches: [], reviewer_score: null, reviewers: null, reco: null, review_count: 0,
  flags: [], submitted_at: "2026-05-01T00:00:00Z", ...extra,
});

const APPS = { exclude_status: "rejected,jury_review" };
const renderApps = () => render(
  <AdminPipeline goDetail={() => {}} baseFilter={APPS} scopeKey="applications" />);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* ignore */ }
  adminPlatformApi.getBatches.mockResolvedValue({ batches: [{ id: "b1", name: "Robotics-1" }] });
});

const captureCsv = async (rows) => {
  adminPlatformApi.getPipeline.mockResolvedValue({ applications: rows, total: rows.length });
  let captured = null;
  const RealBlob = global.Blob;
  global.Blob = class extends RealBlob { constructor(p, o) { super(p, o); captured = p.join(""); } };
  global.URL.createObjectURL = vi.fn(() => "blob:x");
  global.URL.revokeObjectURL = vi.fn();
  try {
    renderApps();
    await screen.findByText(`App-${rows[0].id}`);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  } finally { global.Blob = RealBlob; }
  return captured.split("\r\n");
};

describe("Rejected tab (read-only) — batch management controls (ADMPIPE-09)", () => {
  it("offers no + Create Batch / rename / delete on the read-only tab", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
      row("r1", "rejected", { batches: [{ id: "b1", name: "Robotics-1" }], batch: "Robotics-1" }),
    ], total: 1 });
    render(<AdminPipeline goDetail={() => {}} readOnly baseFilter={{ status: "rejected" }}
      heading="Rejected applications" scopeKey="rejected" />);
    await screen.findByText("App-r1");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.queryByRole("button", { name: "+ Create Batch" })).toBeNull();
    expect(screen.queryByTitle("Delete batch Robotics-1")).toBeNull();
  });
});

describe("CSV export (ADMPIPE-20)", () => {
  it("exports the jury_review decision as Accepted, every batch, and the moved marker", async () => {
    const lines = await captureCsv([row("x1", "on_hold", {
      decision: "jury_review", moved_to_track: "sip",
      batches: [{ id: "b1", name: "A" }, { id: "b2", name: "B" }], batch: "A",
    })]);
    const data = lines[1];
    expect(data).not.toContain(",Shortlisted,");
    expect(data).toContain("TIR-x1 (→ VIP)");
    expect(data).toMatch(/A; ?B|A\|B|A, ?B/);
  });
});

describe("Rename batch — whitespace", () => {
  it("keeps the batch filter on the renamed batch when the typed name has a trailing space", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
      row("a1", "under_review", { batches: [{ id: "b1", name: "Robotics-1" }], batch: "Robotics-1" }),
    ], total: 1 });
    // Server strips whitespace (_BatchName strip_whitespace=True) and stores "Robo-2".
    adminPlatformApi.renameBatch.mockResolvedValue({ batch_id: "b1", name: "Robo-2" });
    renderApps();
    await screen.findByText("App-a1");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Robotics-1/ }));
    // After rename, both reloads return the server's trimmed name.
    adminPlatformApi.getBatches.mockResolvedValue({ batches: [{ id: "b1", name: "Robo-2" }] });
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
      row("a1", "under_review", { batches: [{ id: "b1", name: "Robo-2" }], batch: "Robo-2" }),
    ], total: 1 });
    vi.spyOn(window, "prompt").mockReturnValue("Robo-2 ");
    const dots = document.querySelector(".lp-filter-btn-group .lp-filter-btn-dots");
    await act(async () => { fireEvent.click(dots); });
    await waitFor(() => expect(adminPlatformApi.renameBatch).toHaveBeenCalled());
    // Root cause: the sticky batch filter is set to the UNTRIMMED name.
    await waitFor(() => expect(adminPlatformApi.getPipeline.mock.calls.length).toBeGreaterThan(1));
    expect(JSON.parse(sessionStorage.getItem("apos.filter.v1.admin.pipeline.applications.batch"))).toBe("Robo-2");
    // The app is in the renamed batch, so the batch-filtered list must still show it.
    await waitFor(() => expect(screen.queryByText("App-a1")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("App-a1")).not.toBeNull();
  });
});

describe("Batches list failed to load", () => {
  it("rename from the batch filter reports an error instead of silently doing nothing", async () => {
    adminPlatformApi.getBatches.mockRejectedValue(new Error("Network down"));
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
      row("a1", "under_review", { batches: [{ id: "b1", name: "Robotics-1" }], batch: "Robotics-1" }),
    ], total: 1 });
    vi.spyOn(window, "prompt").mockReturnValue("New name");
    renderApps();
    await screen.findByText("App-a1");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const dots = document.querySelector(".lp-filter-btn-group .lp-filter-btn-dots");
    await act(async () => { fireEvent.click(dots); });
    // The admin typed a new name; something must tell them it did not happen.
    expect(window.prompt).toHaveBeenCalled();
    expect(document.querySelector(".adm-pipeline-note.is-error")).not.toBeNull();
  });
});

describe("Per-row '+ New Batch…' when assign fails after create (AP-19)", () => {
  it("reports an ASSIGN failure and reloads batches so the new batch is offered", async () => {
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [row("a1", "under_review")], total: 1 });
    adminPlatformApi.createBatch.mockResolvedValue({ id: "b9", name: "Fresh" });
    adminPlatformApi.assignBatch.mockRejectedValue(Object.assign(new Error("Gateway timeout"), { status: 504 }));
    vi.spyOn(window, "prompt").mockReturnValue("Fresh");
    renderApps();
    await screen.findByText("App-a1");
    const before = adminPlatformApi.getBatches.mock.calls.length;
    const sel = screen.getByTestId("pipeline-row-a1").querySelector("select");
    await act(async () => { fireEvent.change(sel, { target: { value: "new" } }); });
    const note = await waitFor(() => {
      const n = document.querySelector(".adm-pipeline-note");
      expect(n).not.toBeNull();
      return n;
    });
    expect(note.textContent).not.toMatch(/create failed/i);
    expect(adminPlatformApi.getBatches.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("Selection count after a row leaves the filtered list", () => {
  it("'N selected' matches the rows the bulk action will act on", async () => {
    const inBatch = (id) => row(id, "under_review", { batches: [{ id: "b1", name: "Robotics-1" }], batch: "Robotics-1" });
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [inBatch("a1"), inBatch("a2")], total: 2 });
    adminPlatformApi.removeAppFromBatch.mockResolvedValue({ removed: 1 });
    renderApps();
    await screen.findByText("App-a1");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Robotics-1/ }));
    fireEvent.click(screen.getByTestId("pipeline-row-a1").querySelector('input[type="checkbox"]'));
    fireEvent.click(screen.getByTestId("pipeline-row-a2").querySelector('input[type="checkbox"]'));
    expect(screen.getByText("2 selected")).toBeTruthy();
    // Row-level "×" removes a1 from the filtered batch; it leaves the list.
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
      row("a1", "under_review"), inBatch("a2")], total: 2 });
    await act(async () => { fireEvent.click(screen.getByTestId("pipeline-row-a1").querySelector('button[title="Remove from Robotics-1"]')); });
    await waitFor(() => expect(screen.queryByText("App-a1")).toBeNull());
    expect(screen.queryByText("2 selected")).toBeNull();
  });
});

describe("Pipeline reload race (useAdminData has no stale-response guard)", () => {
  it("an older reload resolving last does not overwrite the newer list", async () => {
    let calls = 0;
    const resolvers = [];
    adminPlatformApi.getPipeline.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ applications: [row("a1", "under_review"), row("a2", "under_review")], total: 2 });
      return new Promise((res) => resolvers.push(res));
    });
    adminPlatformApi.assignBatch.mockResolvedValue({ assigned: 1, assignments_created: 0 });
    renderApps();
    await screen.findByText("App-a1");
    // Two quick per-row batch adds → two reloads in flight.
    await act(async () => { fireEvent.change(screen.getByTestId("pipeline-row-a1").querySelector("select"), { target: { value: "Robotics-1" } }); });
    await act(async () => { fireEvent.change(screen.getByTestId("pipeline-row-a2").querySelector("select"), { target: { value: "Robotics-1" } }); });
    await waitFor(() => expect(resolvers.length).toBe(2));
    const b = { batches: [{ id: "b1", name: "Robotics-1" }], batch: "Robotics-1" };
    // Newer reload (both assigned) resolves first, the older one (only a1) last.
    await act(async () => { resolvers[1]({ applications: [row("a1", "under_review", b), row("a2", "under_review", b)], total: 2 }); });
    await act(async () => { resolvers[0]({ applications: [row("a1", "under_review", b), row("a2", "under_review")], total: 2 }); });
    const a2 = screen.getByTestId("pipeline-row-a2");
    expect(a2.querySelector('button[title="Remove from Robotics-1"]')).not.toBeNull();
  });
});

describe("Admin Dashboard error handling", () => {
  it("a failed /stats load offers a Retry", async () => {
    adminPlatformApi.getStats.mockRejectedValue(new Error("timeout"));
    adminPlatformApi.getPipeline.mockResolvedValue({ applications: [], total: 0 });
    render(<AdminDashboard go={() => {}} />);
    await screen.findByText(/Failed to load dashboard/);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeNull();
  });

  it("a failed pipeline load does not render an empty industry card as if there were no data", async () => {
    adminPlatformApi.getStats.mockResolvedValue({ totals: {}, funnel: {}, status_counts: [],
      pipeline_breakdown: { total: 5, stages: { submitted: 5 } } });
    adminPlatformApi.getPipeline.mockRejectedValue(new Error("timeout"));
    render(<AdminDashboard go={() => {}} />);
    await screen.findByText(/Where the cohort is concentrated/);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/fail|error|couldn.t load/i)).not.toBeNull();
  });
});
