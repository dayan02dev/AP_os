// The Accepted tab unmounts when an admin opens an application (the shell
// swaps `page` to 'detail') or switches tabs, so its filters must be sticky.
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
    { id: "app-1", name: "TirCo", founders: ["A"], domain: "Robotics", track: "tir",
      chip: "JURY REVIEW", status: "jury_review", sub: "TIR-1" },
    { id: "app-2", name: "VipCo", founders: ["B"], domain: "Health", track: "sip",
      chip: "JURY REVIEW", status: "jury_review", sub: "VIP-1" },
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

describe("AdminSelectedApplications sticky filters", () => {
  it("keeps the track filter after the screen unmounts and remounts", () => {
    const first = render(<AdminSelectedApplications goDetail={vi.fn()} />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    expect(screen.getByText("TirCo")).toBeInTheDocument();
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
  });

  it("keeps the search text after a remount", () => {
    const first = render(<AdminSelectedApplications goDetail={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search project/i), { target: { value: "TirCo" } });
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    expect(screen.getByPlaceholderText(/search project/i)).toHaveValue("TirCo");
  });
});
