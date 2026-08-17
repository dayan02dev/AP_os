// Reject on the Accepted tab: a final-gate rejection reachable without
// switching to the Final Gate screen. Writes must key on the NATIVE track —
// a TIR application moved to VIP shows here as VIP but lives in
// tir_applications.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { full_name: "Nirav Sanghavi", email: "nirav@artpark.in" } }),
}));
vi.mock("../../../../../lib/icDocumentsApi", () => ({
  icDocumentsApi: {
    list: vi.fn(), upload: vi.fn(), sign: vi.fn(),
    fileUrl: vi.fn().mockResolvedValue({ url: "https://signed.example/ic.pdf" }),
  },
}));
vi.mock("../../../../../lib/pdfSign", () => ({
  stampSignature: vi.fn(),
  formatSignedAt: () => "30 Jul 2026 14:12 IST",
}));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { decideGate2: vi.fn() },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../../lib/adminPlatformApi";
import { AdminSelectedApplications } from "../AdminSelectedApplications";

const VIP_A = {
  id: "app-1", track: "sip", nativeTrack: "sip", name: "Helios Robotics",
  applicationId: "SIP-101", domain: "Robotics & Automation", founders: ["Asha Rao"],
  ai: { overall: 8.4 }, chip: "JURY REVIEW",
};
// Natively TIR, displayed as VIP — the native-track trap.
const MOVED_TO_VIP = {
  id: "app-3", track: "sip", nativeTrack: "tir", movedToTrack: "sip",
  name: "Prithvi Aero", applicationId: "TIR-207", domain: "Defense & Aerospace",
  founders: ["Meera S"], ai: { overall: 9.0 }, chip: "JURY REVIEW",
};

const reloadPipeline = vi.fn();

function wire(startups = [VIP_A]) {
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline")
      return { data: { startups }, loading: false, error: null, reload: reloadPipeline };
    if (kind === "icDocuments")
      return { data: { documents: [], byKey: {} }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

/** Open the reject modal for the row whose project name is `name`. */
function openReject(name) {
  const row = screen.getByText(name).closest("tr");
  fireEvent.click(within(row).getByRole("button", { name: /^reject$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  adminPlatformApi.decideGate2.mockResolvedValue({ decision: "rejected" });
});

describe("AdminSelectedApplications — reject", () => {
  it("offers a Reject action on every row, even with no memo uploaded", () => {
    wire();
    render(<AdminSelectedApplications />);
    const row = screen.getByText("Helios Robotics").closest("tr");
    const reject = within(row).getByRole("button", { name: /^reject$/i });
    expect(reject).toBeEnabled();
  });

  it("requires a reason before the rejection can be confirmed", () => {
    wire();
    render(<AdminSelectedApplications />);
    openReject("Helios Robotics");

    const confirm = screen.getByRole("button", { name: /reject application/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Not a fit for the cohort" } });
    expect(confirm).toBeEnabled();
  });

  it("records a gate-2 rejection with the reason and reloads the list", async () => {
    wire();
    render(<AdminSelectedApplications />);
    openReject("Helios Robotics");
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Duplicate submission" } });
    fireEvent.click(screen.getByRole("button", { name: /reject application/i }));

    await waitFor(() => {
      expect(adminPlatformApi.decideGate2).toHaveBeenCalledWith("sip", "app-1", {
        decision: "rejected",
        rationale: "Duplicate submission",
      });
    });
    await waitFor(() => expect(reloadPipeline).toHaveBeenCalled());
  });

  it("writes against the NATIVE track for an application moved to another track", async () => {
    wire([MOVED_TO_VIP]);
    render(<AdminSelectedApplications />);
    openReject("Prithvi Aero");
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Out of scope" } });
    fireEvent.click(screen.getByRole("button", { name: /reject application/i }));

    await waitFor(() => {
      // Displayed as VIP, but it lives in tir_applications.
      expect(adminPlatformApi.decideGate2).toHaveBeenCalledWith("tir", "app-3", {
        decision: "rejected",
        rationale: "Out of scope",
      });
    });
  });

  it("explains a 409 when the application was already decided elsewhere", async () => {
    wire();
    adminPlatformApi.decideGate2.mockRejectedValue({
      status: 409, details: { code: "not_in_jury_review" },
    });
    render(<AdminSelectedApplications />);
    openReject("Helios Robotics");
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Not a fit" } });
    fireEvent.click(screen.getByRole("button", { name: /reject application/i }));

    expect(await screen.findByText(/no longer awaiting a final decision/i)).toBeTruthy();
  });
});
