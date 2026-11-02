// The shell's queue must not go stale: refetch on every tab switch and when
// the window regains focus (AF-4). Badge / dashboard / CSV use the same
// "visible" definition as My Queue (inactive rows hidden).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

const rapi = vi.hoisted(() => ({
  getQueue: vi.fn(() => Promise.resolve([])),
  getHistory: vi.fn(() => Promise.resolve({ rows: [], stats: {} })),
}));
vi.mock("../../../../lib/reviewerApi.js", () => ({ reviewerApi: rapi }));
vi.mock("../../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { email: "r@x" }, logout: vi.fn() }) }));
vi.mock("../../../../components/PortalSwitcher.jsx", () => ({ default: () => null }));
vi.mock("../../../../components/AccountSettingsButton.jsx", () => ({ default: () => null }));

import ReviewerPortal, { queueCsvRows } from "../ReviewerPortal.jsx";
import ReviewerDashboard from "../ReviewerDashboard.jsx";
import { writeStickyState } from "../../../../hooks/useStickyState.js";

const row = (id, over = {}) => ({
  id, applicationId: "TIR-" + id, track: "tir", movedToTrack: null, name: "App " + id,
  founders: [], industry: "Robotics", stage: "Lab", ai: { overall: 5 },
  reviewStatus: "not-started", myScore: null, myReco: null, due: null,
  detached: false, closed: false, ...over,
});

function Nav() {
  const navigate = useNavigate();
  return (<>
    <button onClick={() => navigate("/reviewer/history")}>go-history</button>
    <button onClick={() => navigate("/reviewer/queue")}>go-queue</button>
  </>);
}
const shell = () => render(
  <MemoryRouter initialEntries={["/reviewer"]}>
    <Nav />
    <Routes>
      <Route path="/reviewer" element={<ReviewerPortal tab="dashboard" />} />
      <Route path="/reviewer/queue" element={<ReviewerPortal tab="queue" />} />
      <Route path="/reviewer/history" element={<ReviewerPortal tab="history" />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { rapi.getQueue.mockReset().mockResolvedValue([]); });

describe("ReviewerPortal queue freshness", () => {
  it("refetches the queue when switching Dashboard -> History -> Queue", async () => {
    shell();
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("go-history"));
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText("go-queue"));
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(3));
  });

  it("an app removed by an admin disappears from My Queue after a tab switch", async () => {
    rapi.getQueue.mockResolvedValueOnce([row("1"), row("2")]).mockResolvedValue([row("1")]);
    shell();
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("go-queue"));
    await waitFor(() => expect(screen.queryByText("App 2")).not.toBeInTheDocument());
    expect(screen.getByText("App 1")).toBeInTheDocument();
  });

  it("refetches when the window regains focus", async () => {
    shell();
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(1));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(2));
  });

  it("DR-4: returning to the tab (focus + visibilitychange, as browsers fire both) refetches once", async () => {
    shell();
    await waitFor(() => expect(rapi.getQueue).toHaveBeenCalledTimes(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange")); // jsdom visibilityState = "visible"
      window.dispatchEvent(new Event("focus"));
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(rapi.getQueue).toHaveBeenCalledTimes(2);
  });

  it("DR-4: a failed background refetch keeps the dashboard on screen", async () => {
    rapi.getQueue.mockResolvedValue([row("1"), row("2")]);
    shell();
    await screen.findByText("APPLICATIONS ASSIGNED");
    rapi.getQueue.mockRejectedValueOnce(new Error("network blip"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(rapi.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn.t load this data/)).toBeNull();
    expect(screen.getByText("APPLICATIONS ASSIGNED")).toBeInTheDocument();
  });

  it("the My Queue badge counts only live rows", async () => {
    rapi.getQueue.mockResolvedValue([row("1"), row("2", { detached: true, reviewStatus: "submitted" }),
      row("3", { closed: true, reviewStatus: "submitted" })]);
    shell();
    const badge = await screen.findByText("1", { selector: ".lp-tab-badge" });
    expect(badge).toBeInTheDocument();
  });
});

describe("queue CSV", () => {
  const Q = [row("1", { name: "Bravo" }), row("2", { name: "Alpha", track: "sip", applicationId: "SIP-2" }),
    row("3", { name: "Gone", detached: true, reviewStatus: "submitted" })];

  it("from My Queue exports exactly the rows the queue shows (filters + sort)", () => {
    writeStickyState("reviewer.queue", "sortCol", "name");
    const out = queueCsvRows(Q, "queue");
    expect(out.slice(1).map((r) => r[1])).toEqual(["Alpha", "Bravo"]);
    writeStickyState("reviewer.queue", "track", "tir");
    expect(queueCsvRows(Q, "queue").slice(1).map((r) => r[1])).toEqual(["Bravo"]);
  });

  it("from the dashboard exports every row and marks inactive ones", () => {
    writeStickyState("reviewer.queue", "track", "tir");
    const out = queueCsvRows(Q, "dashboard");
    expect(out).toHaveLength(4);
    const gone = out.find((r) => r[1] === "Gone");
    expect(gone[gone.length - 1]).toBe("Unassigned");
  });
});

describe("dashboard industry rows", () => {
  it("count only live rows, matching what My Queue shows for that industry", () => {
    const Q = [row("1", { industry: "Climate" }), row("2", { industry: "Climate", detached: true }),
      row("3", { industry: "Climate", closed: true }), row("4", { industry: "Health" })];
    render(<ReviewerDashboard queueAsync={{ data: Q, loading: false, error: null, reload: vi.fn() }} onPickIndustry={vi.fn()} />);
    const climate = screen.getByText("Climate", { selector: ".dash-ind-name" }).closest(".dash-ind-row");
    expect(within(climate).getByText("1", { selector: ".dash-ind-count" })).toBeInTheDocument();
  });

  it("keeps showing the dashboard during a background refetch", () => {
    render(<ReviewerDashboard queueAsync={{ data: [row("1")], loading: true, error: null, reload: vi.fn() }} onPickIndustry={vi.fn()} />);
    expect(screen.getByText("APPLICATIONS ASSIGNED")).toBeInTheDocument();
  });
});
