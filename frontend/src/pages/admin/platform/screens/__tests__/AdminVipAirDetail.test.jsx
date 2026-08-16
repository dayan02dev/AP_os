// AdminVipAirDetail — one AIR round: three answers + ticked criteria +
// evidence per lever, verify/downgrade with a note, confirm-all, and the
// "verifying the 6th lever flips the assessment to verified" consequence
// made visible before the verifier commits (spec §7). Seams mocked:
// lib/adminVipApi (network). useAsync (ui.jsx) is real.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../../lib/adminVipApi.js", () => ({
  adminVipApi: {
    getAirQueue: vi.fn(),
    getAirAssessment: vi.fn(),
    verifyLever: vi.fn(),
    confirmAllLevers: vi.fn(),
  },
}));

import { adminVipApi } from "../../../../../lib/adminVipApi.js";
import { AdminVipAirDetail } from "../AdminVipAirDetail.jsx";

const CATALOG = {
  levers: [
    { key: "scientific_principles", name: "Scientific Principles & Models", family: "technology" },
    { key: "architecture", name: "Architecture & System Definition", family: "technology" },
  ],
  questions: {
    scientific_principles: [
      { id: "q1", text: "How well documented are the core principles?", options: [
        { id: "A", level: 1, text: "High-level idea only." },
        { id: "B", level: 2, text: "Literature search complete." },
        { id: "C", level: 3, text: "Lab tests demonstrate POC." },
      ] },
      { id: "q2", text: "Model maturity?", options: [
        { id: "A", level: 2, text: "Concept only." },
        { id: "B", level: 3, text: "Models built, HIL integrated." },
      ] },
      { id: "q3", text: "Reliability data?", options: [
        { id: "A", level: 5, text: "Functional, no MTBF yet." },
      ] },
    ],
  },
  criteria: {}, documents: {},
};

function lever(overrides = {}) {
  return {
    lever: "scientific_principles", name: "Scientific Principles & Models", family: "technology",
    q1_option: "C", q2_option: "B", q3_option: null,
    criteria_checked: ["Comprehensive literature & patent search."],
    claimed_level: 3, verified_level: null, verifier_note: null,
    required_document: "Literature Review", criteria: ["Comprehensive literature & patent search.", "Feasibility scan."],
    evidence: [
      { id: "ev-1", doc_label: "Literature Review", filename: "lit-review.pdf",
        size_bytes: 204800, content_type: "application/pdf", uploaded_at: "2026-08-01T00:00:00Z",
        storage_path: "asm-1/ev-1.pdf", signed_url: "https://signed.example/ev-1.pdf" },
      { id: "ev-2", doc_label: "Feasibility Scan", filename: "scan.pdf",
        size_bytes: 10240, content_type: "application/pdf", uploaded_at: "2026-08-01T00:00:00Z",
        storage_path: "asm-1/ev-2.pdf", signed_url: null },
    ],
    ...overrides,
  };
}

function lever2(overrides = {}) {
  return {
    lever: "architecture", name: "Architecture & System Definition", family: "technology",
    q1_option: "B", q2_option: null, q3_option: null,
    criteria_checked: [], claimed_level: 2, verified_level: null, verifier_note: null,
    required_document: null, criteria: [], evidence: [],
    ...overrides,
  };
}

function bundle({ status = "submitted", levers = [lever(), lever2()], overrides = {} } = {}) {
  return {
    catalog: CATALOG,
    round: { id: "asm-1", round_label: "FY26-27-Q1", status, submitted_at: "2026-08-10T09:00:00Z", verified_at: null, verified_by: null },
    levers,
    rollups: { claimed: { technology: 2, commercial: null, overall: null }, verified: { technology: null, commercial: null, overall: null } },
    application_id: "app-1", startup: "Helios Robotics",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminVipAirDetail — loading / error", () => {
  it("shows a loading state", () => {
    adminVipApi.getAirAssessment.mockReturnValue(new Promise(() => {}));
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("maps assessment_not_found to real copy, not a blank screen", async () => {
    adminVipApi.getAirAssessment.mockRejectedValue({ code: "assessment_not_found", details: {} });
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/could not be found/i)).toBeTruthy());
  });
});

describe("AdminVipAirDetail — rendering the round", () => {
  it("renders the startup, round label and lever answers", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.getByText(/FY26-27-Q1/)).toBeTruthy();
    expect(screen.getByText(/Lab tests demonstrate POC/)).toBeTruthy();
    expect(screen.getByText(/Models built, HIL integrated/)).toBeTruthy();
  });

  it("shows q3 as not answered when unanswered", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.getAllByText(/not answered/i).length).toBeGreaterThan(0);
  });

  it("ticks checked criteria and leaves the rest unticked", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    const checked = screen.getByText("Comprehensive literature & patent search.").closest("li");
    const unchecked = screen.getByText("Feasibility scan.").closest("li");
    expect(checked.className).toMatch(/checked/);
    expect(unchecked.className).not.toMatch(/checked/);
  });

  it("links evidence with a signed URL and flags evidence without one", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    const link = screen.getByText("lit-review.pdf").closest("a");
    expect(link.getAttribute("href")).toBe("https://signed.example/ev-1.pdf");
    expect(screen.getByText(/link unavailable/i)).toBeTruthy();
  });
});

describe("AdminVipAirDetail — the completion consequence", () => {
  it("warns that verifying the last lever will complete the round", async () => {
    // 5 of 6 already verified — one lever left.
    const levers = [
      lever({ lever: "scientific_principles", verified_level: 3 }),
      lever2({ lever: "architecture", verified_level: 2, claimed_level: 2 }),
      lever2({ lever: "qualification", verified_level: 2, claimed_level: 2 }),
      lever2({ lever: "user_needs", verified_level: 2, claimed_level: 2 }),
      lever2({ lever: "supply_chain", verified_level: 2, claimed_level: 2 }),
      lever2({ lever: "reliability", claimed_level: 2 }), // the one left
    ];
    adminVipApi.getAirAssessment.mockResolvedValue(bundle({ levers }));
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.getByText(/complete this round/i)).toBeTruthy();
  });

  it("does not show the completion warning with more than one lever left", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle()); // 2 levers, 0 verified
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByText(/complete this round/i)).toBeNull();
  });

  it("shows a fully-verified banner and hides write controls once the round is verified", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle({
      status: "verified",
      levers: [lever({ verified_level: 3 }), lever2({ verified_level: 2, claimed_level: 2 })],
    }));
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.getByText(/fully verified/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify lever/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm all/i })).toBeNull();
  });
});

describe("AdminVipAirDetail — verify / downgrade one lever", () => {
  it("constrains the level select to 1..claimed_level so a verifier cannot raise it", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    const select = screen.getByLabelText("Verified level — Scientific Principles & Models");
    const values = within(select).getAllByRole("option").map((o) => o.value);
    expect(values).toEqual(["3", "2", "1"]);
  });

  it("defaults the select to the claimed level (the common case)", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    const select = screen.getByLabelText("Verified level — Scientific Principles & Models");
    expect(select.value).toBe("3");
  });

  it("submits the verify call with the chosen level and note, scoped to this assessment_id", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    adminVipApi.verifyLever.mockResolvedValue(bundle({ levers: [lever({ verified_level: 2, verifier_note: "Evidence weak" }), lever2()] }));
    const onChanged = vi.fn();
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());

    const select = screen.getByLabelText("Verified level — Scientific Principles & Models");
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Verifier note — Scientific Principles & Models"), { target: { value: "Evidence weak" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify lever — Scientific Principles & Models" }));

    await waitFor(() => expect(adminVipApi.verifyLever).toHaveBeenCalledWith(
      "asm-1", "scientific_principles", { verified_level: 2, verifier_note: "Evidence weak" },
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("maps a verified_level_out_of_range failure to real copy", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    adminVipApi.verifyLever.mockRejectedValue({ code: "verified_level_out_of_range", details: { claimed_level: 3 } });
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Verify lever — Scientific Principles & Models" }));
    await waitFor(() => expect(screen.getByText(/claimed level \(AIR 3\)/i)).toBeTruthy());
  });

  it("hides write controls when canWrite is false", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={false} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    expect(screen.queryByLabelText("Verified level — Scientific Principles & Models")).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm all/i })).toBeNull();
  });
});

describe("AdminVipAirDetail — confirm all at claimed", () => {
  it("asks for confirmation before firing, and warns distinctly when it would overwrite an earlier decision", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle({
      levers: [lever({ verified_level: 1 }), lever2()], // one already downgraded from claimed 3 to 1
    }));
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /confirm all at claimed/i }));
    expect(screen.getByText(/overwrite/i)).toBeTruthy();
    expect(adminVipApi.confirmAllLevers).not.toHaveBeenCalled();
  });

  it("calls the API once confirmed, scoped to this assessment_id", async () => {
    adminVipApi.getAirAssessment.mockResolvedValue(bundle());
    adminVipApi.confirmAllLevers.mockResolvedValue(bundle({ levers: [lever({ verified_level: 3 }), lever2({ verified_level: 2 })] }));
    const onChanged = vi.fn();
    render(<AdminVipAirDetail assessmentId="asm-1" canWrite={true} onBack={vi.fn()} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText("Helios Robotics")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /confirm all at claimed/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(adminVipApi.confirmAllLevers).toHaveBeenCalledWith("asm-1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
