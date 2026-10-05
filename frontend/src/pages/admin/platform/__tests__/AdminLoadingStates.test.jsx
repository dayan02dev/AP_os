// Counts must not flash "0" before their data has loaded: while a fetch is
// pending the header / count shows a neutral "…", and 0 only once loaded.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
  loadDetail: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] } }),
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import AdminGate1 from "../screens/AdminGate1.jsx";
import { AdminDashboard } from "../screens/AdminDashboard";
import { AdminPipeline } from "../screens/AdminPipeline.jsx";
import { AdminSelectedApplications } from "../screens/AdminSelectedApplications.jsx";

const PENDING = { data: null, loading: true, error: null, reload: vi.fn() };
const loaded = (data) => ({ data, loading: false, error: null, reload: vi.fn() });
const STATS = { totals: {}, funnel: {}, statusCounts: [], aiScores: [], decisions: {} };

beforeEach(() => { cleanup(); useAdminData.mockReset(); });

describe("Admin Review header", () => {
  it("shows a placeholder, not 'Decide on 0 applications', while loading", () => {
    useAdminData.mockReturnValue(PENDING);
    const { container } = render(<AdminGate1 goDetail={() => {}} />);
    expect(container.textContent).not.toMatch(/Decide on 0/);
    expect(container.textContent).toMatch(/Decide on …/);
  });

  it("shows 0 once loaded and empty", () => {
    useAdminData.mockReturnValue(loaded({ startups: [] }));
    const { container } = render(<AdminGate1 goDetail={() => {}} />);
    expect(container.textContent).toMatch(/Decide on 0 applications/);
  });
});

describe("Dashboard industry card", () => {
  it("does not say 'All 0 applications' while the pipeline loads", () => {
    useAdminData.mockImplementation((kind) => (kind === "stats" ? loaded(STATS) : PENDING));
    const { container } = render(<AdminDashboard go={() => {}} />);
    expect(container.textContent).not.toMatch(/All 0 applications/);
    expect(container.textContent).toMatch(/All … applications/);
  });

  it("shows the real count once loaded", () => {
    useAdminData.mockImplementation((kind) => (kind === "stats"
      ? loaded(STATS)
      : loaded({ startups: [{ id: "a", domain: "X" }, { id: "b", domain: "Y" }] })));
    const { container } = render(<AdminDashboard go={() => {}} />);
    expect(container.textContent).toMatch(/All 2 applications/);
  });
});

describe("Applications list count", () => {
  it("does not show '0 of 0' while loading", () => {
    useAdminData.mockImplementation((kind) => (kind === "batches" ? loaded({ batches: [] }) : PENDING));
    const { container } = render(<AdminPipeline goDetail={() => {}} scopeKey="loading1" />);
    expect(container.textContent).not.toMatch(/\b0 of 0\b/);
  });
});

describe("Accepted list count", () => {
  it("does not show a 0 count while loading", () => {
    useAdminData.mockReturnValue(PENDING);
    const { container } = render(<AdminSelectedApplications goDetail={() => {}} />);
    const count = container.querySelector(".lp-count");
    expect(count == null || count.textContent === "…").toBe(true);
    expect(container.textContent).not.toMatch(/\b0 of\b/);
  });
});
