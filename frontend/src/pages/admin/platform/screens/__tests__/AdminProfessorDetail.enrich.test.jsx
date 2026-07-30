// The "From their profile page" card: on-demand live enrichment of one
// professor's own faculty page. Deliberately NOT auto-triggered — 809 professors
// × (page fetch + LLM) is real money, so an admin asks for it per profile.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../lib/academicProfilesApi", () => ({
  academicProfilesApi: { get: vi.fn(), enrich: vi.fn() },
}));

import { academicProfilesApi } from "../../../../../lib/academicProfilesApi";
import { AdminProfessorDetail, hasAnything } from "../AdminProfessorDetail";

const PROF = {
  name: "Siddharth Barman", title: "Associate Professor", department: "CSA",
  division: "Electrical Sciences", profile_url: "https://csa.iisc.ac.in/~barman/",
  research_domain: "Theoretical CS", subdomains: "fair division; game theory",
  notable_work: "Approximation algorithms", artpark_match: "Partial",
  matched_domains: "ai", reasoning: "adjacent to multi-agent AI",
  duplicate_joint_appointment: "",
};

const FULL = {
  status: "done",
  fetched_at: "2026-07-30T10:00:00Z",
  model: "google/gemini-2.5-flash",
  extracted: {
    emails: ["barman@iisc.ac.in"],
    phone: "+91 80 2293 2368",
    position: "Associate Professor, CSA",
    lab: { name: "Algorithms Lab", url: "https://csa.iisc.ac.in/lab" },
    education: ["PhD, Caltech, 2012"],
    research_interests: ["fair division", "mechanism design"],
    publications: [{ title: "Nash social welfare", venue: "SODA", year: "2018" }],
    awards: ["Best Paper, EC 2019"],
    links: [{ label: "Google Scholar", url: "https://scholar.google.com/x" }],
    summary: "Works on approximation algorithms and fair division.",
  },
};

const renderPage = (props = {}) =>
  render(<AdminProfessorDetail prof={PROF} recommended={[]} onBack={vi.fn()} {...props} />);

beforeEach(() => {
  academicProfilesApi.get.mockResolvedValue({ profile: null, enrichable: true });
  academicProfilesApi.enrich.mockResolvedValue({ profile: FULL, cached: false, empty: false });
});

describe("ProfilePageDetails — before fetching", () => {
  it("checks the cache on mount but does NOT auto-enrich", async () => {
    renderPage();
    await waitFor(() => expect(academicProfilesApi.get).toHaveBeenCalledWith(PROF.profile_url));
    expect(academicProfilesApi.enrich).not.toHaveBeenCalled();
    expect(await screen.findByText("Fetch details")).toBeTruthy();
  });

  it("explains that nothing has been fetched yet", async () => {
    renderPage();
    expect(await screen.findByText(/Not fetched yet/i)).toBeTruthy();
  });

  it("offers no fetch button for a URL outside the roster allow-list", async () => {
    academicProfilesApi.get.mockResolvedValue({ profile: null, enrichable: false });
    renderPage();
    expect(await screen.findByText(/isn't in the roster allow-list/i)).toBeTruthy();
    expect(screen.queryByText("Fetch details")).toBeNull();
  });
});

describe("ProfilePageDetails — a successful fetch", () => {
  it("renders every extracted section", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));

    expect(await screen.findByText(/Works on approximation algorithms/)).toBeTruthy();

    // Scope to the card: "fair division" is also a scraped subdomain chip
    // elsewhere on the page, so a page-wide query is ambiguous.
    const card = screen.getByText("From their profile page").closest(".os-card");
    expect(card.textContent).toContain("barman@iisc.ac.in");
    expect(card.textContent).toContain("+91 80 2293 2368");
    expect(card.textContent).toContain("Associate Professor, CSA");
    expect(card.textContent).toContain("Algorithms Lab");
    expect(card.textContent).toContain("PhD, Caltech, 2012");
    expect(card.textContent).toContain("fair division");
    expect(card.textContent).toContain("mechanism design");
    expect(card.textContent).toContain("Nash social welfare");
    expect(card.textContent).toContain("SODA");
    expect(card.textContent).toContain("2018");
    expect(card.textContent).toContain("Best Paper, EC 2019");
    expect(card.textContent).toContain("Google Scholar");
    expect(screen.getByText("FETCHED")).toBeTruthy();
  });

  it("mails and links out correctly", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    await screen.findByText("barman@iisc.ac.in");
    expect(screen.getByText("barman@iisc.ac.in").closest("a").getAttribute("href"))
      .toBe("mailto:barman@iisc.ac.in");
    const scholar = screen.getByText(/Google Scholar/).closest("a");
    expect(scholar.getAttribute("href")).toBe("https://scholar.google.com/x");
    expect(scholar.getAttribute("rel")).toContain("noopener");
  });

  it("says the extraction is a reading aid, not a verified record", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    expect(await screen.findByText(/reading aid, not a verified record/i)).toBeTruthy();
  });

  it("offers Re-fetch afterwards, which forces a refresh", async () => {
    academicProfilesApi.get.mockResolvedValue({ profile: FULL, enrichable: true });
    renderPage();
    fireEvent.click(await screen.findByText("Re-fetch"));
    await waitFor(() => expect(academicProfilesApi.enrich)
      .toHaveBeenCalledWith(PROF.profile_url, PROF.name, true));
  });

  it("passes force=false on the very first fetch", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    await waitFor(() => expect(academicProfilesApi.enrich)
      .toHaveBeenCalledWith(PROF.profile_url, PROF.name, false));
  });
});

describe("ProfilePageDetails — failures and thin pages", () => {
  it("shows the recorded reason when the page could not be read", async () => {
    academicProfilesApi.enrich.mockResolvedValue({
      profile: { status: "failed", error_code: "page_timeout",
                 error: "The profile page took too long to respond.", http_status: null },
      cached: false,
    });
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    expect(await screen.findByText("FAILED")).toBeTruthy();
    expect(screen.getByText(/took too long to respond/)).toBeTruthy();
  });

  it("includes the HTTP status when there was one", async () => {
    academicProfilesApi.enrich.mockResolvedValue({
      profile: { status: "failed", error_code: "page_unavailable",
                 error: "The profile page returned HTTP 404.", http_status: 404 },
    });
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    expect(await screen.findByText(/HTTP 404/)).toBeTruthy();
  });

  it("distinguishes 'fetched but empty' from 'not fetched'", async () => {
    academicProfilesApi.enrich.mockResolvedValue({
      profile: { status: "done", extracted: {}, fetched_at: "2026-07-30T10:00:00Z" },
      empty: true,
    });
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    expect(await screen.findByText(/no extractable details/i)).toBeTruthy();
  });

  it("surfaces a thrown request error inline", async () => {
    academicProfilesApi.enrich.mockRejectedValue({ details: { message: "AI extraction timed out. Try again." } });
    renderPage();
    fireEvent.click(await screen.findByText("Fetch details"));
    expect(await screen.findByText("AI extraction timed out. Try again.")).toBeTruthy();
  });

  it("does not crash when the professor has no profile_url", async () => {
    render(<AdminProfessorDetail prof={{ ...PROF, profile_url: "" }} onBack={vi.fn()} />);
    expect(await screen.findByText("From their profile page")).toBeTruthy();
    expect(academicProfilesApi.get).not.toHaveBeenCalled();
  });
});

describe("hasAnything", () => {
  it("mirrors the backend's is_empty", () => {
    expect(hasAnything(null)).toBe(false);
    expect(hasAnything({})).toBe(false);
    expect(hasAnything({ emails: [], publications: [], summary: null })).toBe(false);
    expect(hasAnything({ summary: "x" })).toBe(true);
    expect(hasAnything({ emails: ["a@b.co"] })).toBe(true);
    expect(hasAnything({ lab: { name: "L" } })).toBe(true);
    expect(hasAnything({ lab: { name: null } })).toBe(false);
  });
});
