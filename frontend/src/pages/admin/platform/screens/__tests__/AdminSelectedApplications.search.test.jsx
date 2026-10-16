// The Accepted tab's search must find an application by its display ID
// ("26853", "TIR-26853", "VIP-26303"), the way the Applications tab does —
// it used to match only project / industry / founder, so pasting a TIR number
// returned nothing (24 of the 26 rows here are TIR).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { full_name: "Admin", email: "admin@artpark.in" } }),
}));
vi.mock("../../../../../lib/icDocumentsApi", () => ({
  icDocumentsApi: { list: vi.fn(), upload: vi.fn(), sign: vi.fn(), fileUrl: vi.fn() },
}));
vi.mock("../../../../../lib/pdfSign", () => ({ stampSignature: vi.fn() }));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { AdminSelectedApplications } from "../AdminSelectedApplications";

const PIPELINE = {
  startups: [
    { id: "app-1", applicationId: "TIR-26853", name: "Portable rehabilitation robotics",
      founders: ["Founder A"], domain: "Health", track: "tir",
      chip: "JURY REVIEW", status: "jury_review", sub: "2026-06-09" },
    { id: "app-2", applicationId: "SIP-26303", name: "Structured Oncology Reporting",
      founders: ["Founder B"], domain: "Health", track: "sip",
      chip: "JURY REVIEW", status: "jury_review", sub: "2026-06-10" },
  ],
  total: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockImplementation((kind) => {
    if (kind === "icDocuments")
      return { data: { byKey: {} }, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
});

const search = (value) =>
  fireEvent.change(screen.getByPlaceholderText(/search project/i), { target: { value } });

describe("AdminSelectedApplications search by display ID", () => {
  it.each(["26853", "TIR-26853", "tir-26853", " TIR26853 "])("finds the TIR row for %j", (q) => {
    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    search(q);
    expect(screen.getByText("Portable rehabilitation robotics")).toBeInTheDocument();
    expect(screen.queryByText("Structured Oncology Reporting")).not.toBeInTheDocument();
  });

  it("finds a VIP row by its VIP- (shown) or SIP- (stored) prefix", () => {
    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    search("VIP-26303");
    expect(screen.getByText("Structured Oncology Reporting")).toBeInTheDocument();
    search("SIP-26303");
    expect(screen.getByText("Structured Oncology Reporting")).toBeInTheDocument();
    expect(screen.queryByText("Portable rehabilitation robotics")).not.toBeInTheDocument();
  });

  it("still matches project, founder and industry text", () => {
    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    search("founder a");
    expect(screen.getByText("Portable rehabilitation robotics")).toBeInTheDocument();
    expect(screen.queryByText("Structured Oncology Reporting")).not.toBeInTheDocument();
  });
});
