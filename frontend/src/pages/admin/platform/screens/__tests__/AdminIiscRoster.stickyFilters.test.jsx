// The Academic Jury Roster resets when an admin switches tabs or opens a
// professor page, so its search + facet filters must be sticky too.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/academicProfilesApi", () => ({
  academicProfilesApi: {
    get: vi.fn().mockResolvedValue({ profile: null, enrichable: true }),
    enrich: vi.fn(),
  },
}));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { createJuryInvites: vi.fn() },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { AdminIiscRoster } from "../AdminIiscRoster";

const ROSTER = [
  { name: "Dr. AI One", title: "Professor", department: "CSA", division: "Electrical Sciences",
    profile_url: "https://x/1", research_domain: "ML", subdomains: "deep learning",
    notable_work: "big paper", artpark_match: "Yes", matched_domains: "ai; robotics",
    reasoning: "does AI", duplicate_joint_appointment: "" },
  { name: "Dr. Health Two", title: "Assoc Prof", department: "BSSE", division: "Interdisciplinary",
    profile_url: "https://x/2", research_domain: "Bio", subdomains: "genomics",
    notable_work: "health paper", artpark_match: "Partial", matched_domains: "health",
    reasoning: "does health", duplicate_joint_appointment: "" },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline")
      return { data: { startups: [] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "jurors")
      return { data: { jurors: [], pendingInvites: [] }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
  // The roster loads its 809 professors from a static JSON asset, not the API.
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER) }));
});
afterEach(() => { delete global.fetch; });

describe("AdminIiscRoster sticky filters", () => {
  it("keeps the search text after the roster unmounts and remounts", async () => {
    const first = render(<AdminIiscRoster />);
    await screen.findByText("Dr. AI One");
    expect(screen.getByText("Dr. Health Two")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "AI One" } });
    expect(screen.queryByText("Dr. Health Two")).not.toBeInTheDocument();
    first.unmount();

    render(<AdminIiscRoster />);
    await screen.findByText("Dr. AI One");
    expect(screen.getByLabelText("Search")).toHaveValue("AI One");
    expect(screen.queryByText("Dr. Health Two")).not.toBeInTheDocument();
  });
});
