import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { buildPipelineCsv } from "../helpers/pipelineCsv.js";

// ─── Pure helper: buildPipelineCsv ──────────────────────────────────────────

describe("buildPipelineCsv", () => {
  it("emits a header row even with no data", () => {
    const csv = buildPipelineCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(
      "ID,Track,Name,Founder,Industry,Stage,AI Score,Status,Decision,Batch,Submitted",
    );
  });

  it("maps a row's fields, uppercases the track, and formats the score", () => {
    const csv = buildPipelineCsv([
      {
        applicationId: "TIR-00001",
        track: "tir",
        name: "Acme",
        founder: "Asha",
        industry: "Robotics",
        stage: "Pilot",
        ai_score_overall: 8.25,
        status: "under_review",
        decision: "shortlisted",
        batch: "Batch A",
        submitted_at: "2026-05-01",
      },
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe(
      "TIR-00001,TIR,Acme,Asha,Robotics,Pilot,8.3,Under Review,Shortlisted,Batch A,2026-05-01",
    );
  });

  it("guards nulls/missing fields and blanks a missing score", () => {
    const csv = buildPipelineCsv([
      { track: "sip", id: 42, name: "Beta", ai_score_overall: null },
    ]);
    const [, row] = csv.split("\r\n");
    // ID falls back to id, score/decision/batch blank, track relabeled to VIP.
    expect(row).toBe("42,VIP,Beta,,,,,,,,");
  });

  it("quotes cells that contain commas or quotes", () => {
    const csv = buildPipelineCsv([
      { applicationId: "X", track: "tir", name: 'Foo, "Bar"', founder: "Z" },
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toContain('"Foo, ""Bar"""');
  });
});

// ─── Smoke test: AdminPipeline screen component ─────────────────────────────

// Mock useAdminData to return a realistic startup row + batches.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn((kind) => {
    if (kind === "pipeline") {
      return {
        data: {
          startups: [
            {
              id: "abc123",
              applicationId: "TIR-00001",
              track: "tir",
              name: "TestStartup",
              founders: ["Jane Doe"],
              domain: "Healthcare / MedTech",
              stage: "Prototype",
              ai: { overall: 7.5 },
              rev: undefined,
              chip: "SHORTLISTED",
              hidden: false,
              archived: false,
              batch: "Batch A",
              sub: "2026-05-01",
            },
          ],
          total: 1,
        },
        loading: false,
        error: null,
        reload: vi.fn(),
      };
    }
    // batches kind
    return {
      data: { batches: [{ id: "b1", name: "Batch A", phase: "" }] },
      loading: false,
      error: null,
      reload: vi.fn(),
    };
  }),
}));

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    bulkDecide: vi.fn().mockResolvedValue({ results: [] }),
    patchMeta: vi.fn().mockResolvedValue({}),
    assignBatch: vi.fn().mockResolvedValue({}),
    createBatch: vi.fn().mockResolvedValue({ id: "b2" }),
    renameBatch: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => React.createElement("span", { "data-testid": "preview-badge" }, "Preview"),
}));

// ui.jsx Chip component mock
vi.mock("../ui.jsx", () => ({
  Chip: ({ children }) => React.createElement("span", { "data-testid": "chip" }, children),
}));

import { AdminPipeline } from "../screens/AdminPipeline.jsx";

describe("AdminPipeline screen (smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a row for the mocked startup", () => {
    render(
      React.createElement(AdminPipeline, {
        goDetail: vi.fn(),
        decisionMode: "reviewer",
      }),
    );
    expect(screen.getByText("TestStartup")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
  });

  it("shows the pipeline section tag", () => {
    render(
      React.createElement(AdminPipeline, {
        goDetail: vi.fn(),
        decisionMode: "reviewer",
      }),
    );
    expect(screen.getByText(/A-2 · PIPELINE/)).toBeTruthy();
  });

  it("in jury mode renders PreviewBadge for the jury assignment column", () => {
    render(
      React.createElement(AdminPipeline, {
        goDetail: vi.fn(),
        decisionMode: "jury",
      }),
    );
    expect(screen.getAllByTestId("preview-badge").length).toBeGreaterThan(0);
  });
});
