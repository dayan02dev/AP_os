// AdminDetail smoke tests — replaces the old AdminApplicationDetail.test.js
// (AdminApplicationDetail.jsx is no longer the live screen; AdminDetail is).
//
// Mocks loadDetail so no real API calls are made.

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock loadDetail before importing AdminDetail ─────────────────────────────
vi.mock("../../../../hooks/useAdminData", () => ({
  loadDetail: vi.fn(),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    decide: vi.fn(),
    getReviewers: vi.fn().mockResolvedValue({ reviewers: [] }),
  },
}));
vi.mock("../../../../lib/leadershipApi", () => ({
  leadershipApi: {
    assignReviewers: vi.fn(),
    unassignReviewer: vi.fn(),
  },
}));

import { loadDetail } from "../../../../hooks/useAdminData";
import { AdminDetail } from "../screens/AdminDetail";

const FAKE_APP = {
  id: "test-uuid-001",
  track: "tir",
  applicationId: "TIR-00001",
  name: "Test Startup",
  founders: ["Jane Doe"],
  domain: "Robotics",
  stage: "Prototype",
  trl: "4",
  sub: "2026-06-01",
  chip: "IN REVIEW",
  flag: "orange",
  ai: { overall: 8.1 },
  aiSummary: "A strong AI-backed robotics startup.",
  rev: undefined,
  reviews: [],
  flags: [],
  adminDecision: undefined,
  adminRationale: "",
  batch: "Batch A",
  assignedReviewers: [],
  statusHistory: [],
  hidden: false,
  archived: false,
};

describe("AdminDetail — smoke test", () => {
  beforeEach(() => {
    loadDetail.mockResolvedValue(FAKE_APP);
  });

  it("renders loading state initially then shows startup name in heading", async () => {
    render(
      <AdminDetail
        startupId="test-uuid-001"
        track="tir"
        onBack={() => {}}
        onPrev={null}
        onNext={null}
        decisionMode="reviewer"
      />
    );
    // Loading state
    expect(screen.queryByText(/Loading application/i)).toBeTruthy();
    // After resolve — wait for the h2 heading
    const heading = await screen.findByRole("heading", { level: 2, name: /Test Startup/ });
    expect(heading).toBeTruthy();
  });

  it("shows error state when loadDetail rejects", async () => {
    loadDetail.mockRejectedValue(new Error("Network error"));
    render(
      <AdminDetail
        startupId="bad-id"
        track="tir"
        onBack={() => {}}
        onPrev={null}
        onNext={null}
        decisionMode="reviewer"
      />
    );
    const err = await screen.findByText(/Failed to load application/i);
    expect(err).toBeTruthy();
  });

  it("does not render jury cards in reviewer mode", async () => {
    render(
      <AdminDetail
        startupId="test-uuid-001"
        track="tir"
        onBack={() => {}}
        onPrev={null}
        onNext={null}
        decisionMode="reviewer"
      />
    );
    await screen.findByRole("heading", { level: 2, name: /Test Startup/ });
    expect(screen.queryByText(/TIR Signal Profile/i)).toBeNull();
    expect(screen.queryByText(/Final Jury Panel/i)).toBeNull();
  });

  it("renders jury cards in jury mode", async () => {
    render(
      <AdminDetail
        startupId="test-uuid-001"
        track="tir"
        onBack={() => {}}
        onPrev={null}
        onNext={null}
        decisionMode="jury"
      />
    );
    await screen.findByRole("heading", { level: 2, name: /Test Startup/ });
    expect(await screen.findByText(/TIR Signal Profile/i)).toBeTruthy();
    expect(await screen.findByText(/Final Jury Panel/i)).toBeTruthy();
  });
});
