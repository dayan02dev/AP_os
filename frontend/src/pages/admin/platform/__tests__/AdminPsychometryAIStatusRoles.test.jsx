// AdminPsychometry + AdminAIStatus + AdminRoles smoke tests (Task 16)

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock adminApi so AdminRoles fetch doesn't hit the network ─────────────────
vi.mock("../../../../lib/adminApi", () => ({
  adminApi: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    grantRole: vi.fn(),
    revokeRole: vi.fn(),
  },
}));

import { adminApi } from "../../../../lib/adminApi";
import { AdminPsychometry } from "../screens/AdminPsychometry";
import { AdminAIStatus } from "../screens/AdminAIStatus";
import { AdminRoles } from "../screens/AdminRoles";

// ── AdminPsychometry ──────────────────────────────────────────────────────────

describe("AdminPsychometry screen", () => {
  it("renders the PSYCHOMETRY eyebrow heading", () => {
    render(<AdminPsychometry />);
    // PageHead strips the "A-5 · " prefix before rendering the eyebrow.
    // The word also appears in the h1 title, so use getAllByText.
    const matches = screen.getAllByText(/PSYCHOMETRY/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders a PreviewBadge", () => {
    render(<AdminPsychometry />);
    // PreviewBadge renders "Preview — backend pending"
    expect(screen.getByText(/Preview/i)).toBeTruthy();
  });

  it("renders the Karkhana Robotics row with 2/2 chip", () => {
    render(<AdminPsychometry />);
    expect(screen.getByText("Karkhana Robotics")).toBeTruthy();
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("renders the Mihira Diagnostics row with 1/3 chip", () => {
    render(<AdminPsychometry />);
    expect(screen.getByText("Mihira Diagnostics")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });
});

// ── AdminAIStatus ─────────────────────────────────────────────────────────────

describe("AdminAIStatus screen", () => {
  it("renders the AI PIPELINE eyebrow", () => {
    render(<AdminAIStatus />);
    // PageHead strips the "A-6 · " prefix before rendering the eyebrow.
    expect(screen.getByText(/AI PIPELINE/i)).toBeTruthy();
  });

  it("renders a PreviewBadge", () => {
    render(<AdminAIStatus />);
    expect(screen.getByText(/Preview/i)).toBeTruthy();
  });

  it("renders the 'Active jobs' card title", () => {
    render(<AdminAIStatus />);
    expect(screen.getByText("Active jobs")).toBeTruthy();
  });

  it("renders Pravaha Water job in the active jobs list", () => {
    render(<AdminAIStatus />);
    expect(screen.getByText(/Pravaha Water · Layer 2 scoring/i)).toBeTruthy();
  });

  it("renders the pipeline log terminal block", () => {
    render(<AdminAIStatus />);
    expect(screen.getByText("Pipeline log")).toBeTruthy();
    expect(screen.getByText(/artpark-ai watch/i)).toBeTruthy();
  });
});

// ── AdminRoles ────────────────────────────────────────────────────────────────

describe("AdminRoles screen", () => {
  beforeEach(() => {
    adminApi.listUsers.mockResolvedValue({
      users: [
        {
          id:         "u1",
          full_name:  "Vikram Sundar",
          email:      "vikram.s@artpark.in",
          roles:      ["reviewer"],
          created_at: "2026-01-10T00:00:00Z",
        },
        {
          id:         "u2",
          full_name:  "Dr. Aishwarya Pillai",
          email:      "aishwarya.p@iisc.ac.in",
          roles:      ["reviewer", "leadership"],
          created_at: "2026-01-14T00:00:00Z",
        },
      ],
      total: 2,
    });
  });

  it("renders the ROLES MANAGEMENT eyebrow heading", async () => {
    render(<AdminRoles />);
    // PageHead strips the "A-3B · " prefix before rendering the eyebrow.
    expect(screen.getByText(/ROLES MANAGEMENT/i)).toBeTruthy();
  });

  it("calls adminApi.listUsers on mount", () => {
    render(<AdminRoles />);
    expect(adminApi.listUsers).toHaveBeenCalled();
  });

  it("renders a user row once data loads", async () => {
    render(<AdminRoles />);
    // Wait for the async listUsers mock to resolve
    const row = await screen.findByText("Vikram Sundar");
    expect(row).toBeTruthy();
  });

  it("renders the email of the first user", async () => {
    render(<AdminRoles />);
    const email = await screen.findByText("vikram.s@artpark.in");
    expect(email).toBeTruthy();
  });

  it("renders a PreviewBadge on the Invite Member action", async () => {
    render(<AdminRoles />);
    // PreviewBadge next to the Invite Member button
    const previews = await screen.findAllByText(/Preview/i);
    expect(previews.length).toBeGreaterThan(0);
  });

  it("renders the User List table heading", async () => {
    render(<AdminRoles />);
    const heading = await screen.findByText("User List");
    expect(heading).toBeTruthy();
  });

  it("renders role distribution section", async () => {
    render(<AdminRoles />);
    const dist = await screen.findByText("Role Distribution");
    expect(dist).toBeTruthy();
  });

  it("shows loading state initially", () => {
    // Don't resolve the promise yet — just check the loading text appears immediately
    adminApi.listUsers.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AdminRoles />);
    expect(screen.getByText(/Loading users/i)).toBeTruthy();
  });

  it("shows error state when listUsers rejects", async () => {
    adminApi.listUsers.mockRejectedValue(new Error("net error"));
    render(<AdminRoles />);
    const errMsg = await screen.findByText(/net error/i);
    expect(errMsg).toBeTruthy();
  });
});
