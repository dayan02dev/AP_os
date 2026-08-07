import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
// The detail page mounts the profile-page enrichment card; stub the network so
// these tests stay about the roster and the page, not enrichment.
vi.mock("../../../../../lib/academicProfilesApi", () => ({
  academicProfilesApi: {
    get: vi.fn().mockResolvedValue({ profile: null, enrichable: true }),
    enrich: vi.fn(),
  },
}));
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

  // Assert on the recommended-apps CELL, not the row's concatenated textContent:
  // the count sits between two other words there, so a /\b1\b/ style match on the
  // whole row is meaningless.
  const recoCountOf = (name) => {
    const cells = screen.getByText(name).closest("tr").querySelectorAll("td");
    return cells[cells.length - 2].textContent.trim();   // last col is the Invite button
  };

  it("recommends jury-selected apps by matched domain (AI prof → 1, Health prof → 1)", async () => {
    await renderRoster();
    expect(recoCountOf("Dr. AI One")).toBe("1");
    expect(recoCountOf("Dr. Health Two")).toBe("1");
  });

  it("shows 0 for a professor whose domains match no jury-selected app", async () => {
    await renderRoster();
    // Dr. Joint Dup is robotics-only; neither seeded app is a robotics app.
    expect(recoCountOf("Dr. Joint Dup")).toBe("0");
  });

  it("lists division as its own column and keeps the department chip", async () => {
    await renderRoster();
    const row = screen.getByText("Dr. AI One").closest("tr");
    expect(row.textContent).toContain("CSA");
    expect(row.textContent).toContain("Electrical Sciences");
  });

  it("sorts by ARTPARK match with Yes ahead of Partial", async () => {
    await renderRoster();
    fireEvent.click(screen.getByText(/ARTPARK MATCH/i));
    const names = Array.from(document.querySelectorAll("tbody tr"))
      .map((tr) => tr.querySelector(".startup").textContent);
    expect(names[0]).toContain("Dr. AI One");        // Yes
    expect(names[names.length - 1]).toContain("Dr. Health Two");  // Partial
  });

  it("Clear filters restores the full list", async () => {
    await renderRoster();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "health" } });
    expect(screen.queryByText("Dr. AI One")).toBeNull();
    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Dr. AI One")).toBeTruthy();
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

  it("lets the admin correct the scraped name before sending the invite", async () => {
    // Roster names are AI-parsed off faculty pages and are regularly wrong,
    // so the field seeds from the roster but must be editable.
    render(<AdminIiscRoster />);
    fireEvent.click((await screen.findAllByText("Invite"))[0]);
    const nameField = screen.getByLabelText("Invite name");
    expect(nameField.value).toBe("Dr. AI One");
    expect(nameField.readOnly).toBe(false);

    fireEvent.change(nameField, { target: { value: "Prof. A. One" } });
    fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "aione@iisc.ac.in" } });
    fireEvent.click(screen.getByText("Send invite"));

    await waitFor(() => expect(adminPlatformApi.createJuryInvites).toHaveBeenCalledWith(
      [{ name: "Prof. A. One", email: "aione@iisc.ac.in" }]));
  });

  it("refuses to send an invite with the name blanked out", async () => {
    render(<AdminIiscRoster />);
    fireEvent.click((await screen.findAllByText("Invite"))[0]);
    fireEvent.change(screen.getByLabelText("Invite name"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "a@iisc.ac.in" } });
    fireEvent.click(screen.getByText("Send invite"));
    await waitFor(() => expect(screen.getByText("Enter a name.")).toBeTruthy());
    expect(adminPlatformApi.createJuryInvites).not.toHaveBeenCalled();
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

});

// The detail is a FULL PAGE now, not a drawer: it replaces the list rather than
// overlaying it, so the other professors must be gone while it is open.
describe("AdminIiscRoster — full-page professor detail", () => {
  const openFirst = async () => {
    await renderRoster();
    fireEvent.click(screen.getByText("Dr. AI One"));
  };

  it("replaces the list instead of overlaying it", async () => {
    await openFirst();
    expect(screen.getByText("Academic jury roster")).toBeTruthy();   // breadcrumb
    expect(screen.getByText("← Back to roster")).toBeTruthy();
    // The other rows are gone — this is a page, not a drawer over the table.
    expect(screen.queryByText("Dr. Health Two")).toBeNull();
    expect(screen.queryByText("Dr. Joint Dup")).toBeNull();
  });

  it("shows the scraped detail fields, the match reasoning and the profile link", async () => {
    await openFirst();
    expect(screen.getByText("ML")).toBeTruthy();               // research domain
    expect(screen.getByText("deep learning")).toBeTruthy();    // subdomain chip
    expect(screen.getByText("big paper")).toBeTruthy();        // notable work
    expect(screen.getByText(/does AI/)).toBeTruthy();          // reasoning
    const link = screen.getByText(/View IISc profile/i).closest("a");
    expect(link.getAttribute("href")).toBe("https://x/1");
  });

  it("renders a stat row and the matched-domain fit table with full labels", async () => {
    await openFirst();
    expect(screen.getByText("Matched domains")).toBeTruthy();
    expect(screen.getByText("Recommended apps")).toBeTruthy();
    // Scope to the fit table: the AI label also appears as an app's industry.
    const fitTable = screen.getByText("ARTPARK industry").closest("table");
    expect(fitTable.textContent).toContain("Artificial Intelligence / Foundational Models");
    expect(fitTable.textContent).toContain("Robotics & Automation");
    // Per-domain app counts: ai has the one AI startup, robotics has none.
    const cells = (tok) => Array.from(fitTable.querySelectorAll("tbody tr"))
      .find((tr) => tr.textContent.startsWith(tok)).querySelectorAll("td");
    expect(cells("ai")[2].textContent.trim()).toBe("1");
    expect(cells("robotics")[2].textContent.trim()).toBe("0");
  });

  it("lists the recommended jury-selected applications", async () => {
    await openFirst();
    expect(screen.getByText("AI Startup")).toBeTruthy();
    expect(screen.queryByText("Not Jury")).toBeNull();     // SHORTLISTED, not jury_review
    expect(screen.queryByText("Health Startup")).toBeNull(); // wrong domain for this prof
  });

  it("walks to the next professor and back again", async () => {
    await openFirst();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByText("Next professor →"));
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText(/does health/)).toBeTruthy();
    fireEvent.click(screen.getByText("← Prev professor"));
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("hides Prev on the first professor and Next on the last", async () => {
    await openFirst();
    expect(screen.queryByText("← Prev professor")).toBeNull();
    fireEvent.click(screen.getByText("Next professor →"));
    fireEvent.click(screen.getByText("Next professor →"));
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(screen.queryByText("Next professor →")).toBeNull();
  });

  it("returns to the list with filters still applied", async () => {
    await renderRoster();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "health" } });
    fireEvent.click(screen.getByText("Dr. Health Two"));
    expect(screen.getByText("1 of 1 (filtered)")).toBeTruthy();
    fireEvent.click(screen.getByText("← Back to roster"));
    // Back on the list, still narrowed to the health domain.
    expect(screen.getByText("Dr. Health Two")).toBeTruthy();
    expect(screen.queryByText("Dr. AI One")).toBeNull();
  });

  it("invites from the detail page", async () => {
    await openFirst();
    fireEvent.click(screen.getByText("Invite to jury"));
    expect(screen.getByDisplayValue("Dr. AI One")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "a@iisc.ac.in" } });
    fireEvent.click(screen.getByText("Send invite"));
    await waitFor(() => expect(adminPlatformApi.createJuryInvites).toHaveBeenCalledWith(
      [{ name: "Dr. AI One", email: "a@iisc.ac.in" }]));
  });

  it("disables the invite button for someone already on the jury", async () => {
    mockData({ jurors: [{ id: "j1", name: "Dr. AI One" }] });
    await openFirst();
    expect(screen.getByText("Already invited").disabled).toBe(true);
  });
});
