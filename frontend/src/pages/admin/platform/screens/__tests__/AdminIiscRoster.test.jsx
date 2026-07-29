import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { createJuryInvites: vi.fn().mockResolvedValue({ results: [{ email: "x@y.com", status: "invited" }] }) },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../../lib/adminPlatformApi";
import { AdminIiscRoster } from "../AdminIiscRoster";

const ROSTER = [
  { name: "Dr. AI One", title: "Professor", department: "CSA", division: "Electrical Sciences",
    profile_url: "https://x/1", research_domain: "ML", subdomains: "deep learning",
    notable_work: "big paper", artpark_match: "Yes", matched_domains: "ai; robotics",
    reasoning: "does AI", duplicate_joint_appointment: "" },
  { name: "Dr. Health Two", title: "Assoc Prof", department: "BSSE", division: "Interdisciplinary & Physical Sciences",
    profile_url: "https://x/2", research_domain: "Bio", subdomains: "genomics",
    notable_work: "health paper", artpark_match: "Partial", matched_domains: "health",
    reasoning: "does health", duplicate_joint_appointment: "" },
  { name: "Dr. Joint Dup", title: "Professor", department: "RBCCPS", division: "Electrical Sciences",
    profile_url: "https://x/3", research_domain: "Robotics", subdomains: "control",
    notable_work: "robot paper", artpark_match: "Yes", matched_domains: "robotics",
    reasoning: "joint", duplicate_joint_appointment: "Yes" },
];

const STARTUPS = [
  { id: "a1", track: "tir", name: "AI Startup", chip: "JURY REVIEW",
    domain: "Artificial Intelligence / Foundational Models", ai: { overall: 8.5 }, founders: ["F1"] },
  { id: "a2", track: "sip", name: "Health Startup", chip: "JURY REVIEW",
    domain: "Healthcare / MedTech", ai: { overall: 7.9 }, founders: ["F2"] },
  { id: "a3", track: "tir", name: "Not Jury", chip: "SHORTLISTED",
    domain: "Healthcare / MedTech", ai: { overall: 6 }, founders: [] },
];

function mockData({ jurors = [], pendingInvites = [] } = {}) {
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline") return { data: { startups: STARTUPS }, loading: false, error: null, reload: vi.fn() };
    if (kind === "jurors")   return { data: { jurors, pendingInvites }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER) }));
});
afterEach(() => { delete global.fetch; });

async function renderRoster() {
  render(<AdminIiscRoster />);
  await screen.findByText("Dr. AI One");
}

describe("AdminIiscRoster", () => {
  it("renders all professors from the fetched roster", async () => {
    await renderRoster();
    expect(screen.getByText("Dr. AI One")).toBeTruthy();
    expect(screen.getByText("Dr. Health Two")).toBeTruthy();
    expect(screen.getByText("Dr. Joint Dup")).toBeTruthy();
  });

  it("recommends jury-selected apps by matched domain (AI prof → 1, Health prof → 1)", async () => {
    await renderRoster();
    const aiRow = screen.getByText("Dr. AI One").closest("tr");
    expect(aiRow.textContent).toMatch(/\b1\b/);
    const healthRow = screen.getByText("Dr. Health Two").closest("tr");
    expect(healthRow.textContent).toMatch(/\b1\b/);
  });

  it("domain filter narrows to matching professors", async () => {
    await renderRoster();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "health" } });
    expect(screen.queryByText("Dr. AI One")).toBeNull();
    expect(screen.getByText("Dr. Health Two")).toBeTruthy();
  });

  it("'Unique only' hides joint-appointment rows", async () => {
    await renderRoster();
    expect(screen.getByText("Dr. Joint Dup")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Unique only/i));
    expect(screen.queryByText("Dr. Joint Dup")).toBeNull();
  });

  it("Invite opens a name-prefilled modal and sends via createJuryInvites", async () => {
    await renderRoster();
    fireEvent.click(screen.getAllByText("Invite")[0]);
    expect(screen.getByDisplayValue("Dr. AI One")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "aione@iisc.ac.in" } });
    fireEvent.click(screen.getByText("Send invite"));
    await waitFor(() => expect(adminPlatformApi.createJuryInvites).toHaveBeenCalledWith(
      [{ name: "Dr. AI One", email: "aione@iisc.ac.in" }]));
  });

  it("marks a professor already in the jury roster as Invited (disabled button)", async () => {
    mockData({ jurors: [{ id: "j1", name: "Dr. AI One" }] });
    await renderRoster();
    const aiRow = screen.getByText("Dr. AI One").closest("tr");
    expect(aiRow.textContent).toMatch(/Invited/);
    const btn = Array.from(aiRow.querySelectorAll("button")).find(b => /Invite|Invited/.test(b.textContent));
    expect(btn.disabled).toBe(true);
  });

  it("opens a detail drawer with fields, profile link, and recommended apps", async () => {
    await renderRoster();
    fireEvent.click(screen.getByText("Dr. AI One"));
    expect(screen.getByText(/does AI/)).toBeTruthy();
    const link = screen.getByText(/View profile/i).closest("a");
    expect(link.getAttribute("href")).toBe("https://x/1");
    expect(screen.getByText("AI Startup")).toBeTruthy();
  });
});
