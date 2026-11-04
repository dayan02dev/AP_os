// Swarm-2 repro tests (admin_accepted) — Accepted tab (AdminSelectedApplications)
// at 837ccf0. Each test asserts the CORRECT behaviour; a failure demonstrates a bug.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../hooks/useStickyState.js", async () => {
  const R = await import("react");
  return { useStickyState: (_s, _k, init) => R.useState(init) };
});
vi.mock("../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { full_name: "Admin A", email: "a@artpark.in" } }),
}));
vi.mock("../lib/icDocumentsApi", () => ({
  icDocumentsApi: { list: vi.fn(), upload: vi.fn(), sign: vi.fn(), fileUrl: vi.fn(), remove: vi.fn() },
}));
vi.mock("../lib/pdfSign", () => ({
  stampSignature: vi.fn(),
  formatSignedAt: (iso) => (iso ? "30 Jul 2026" : ""),
}));

import { useAdminData } from "../hooks/useAdminData";
import { icDocumentsApi } from "../lib/icDocumentsApi";
import { AdminSelectedApplications } from "../pages/admin/platform/screens/AdminSelectedApplications";

const mk = (over) => ({
  id: "app-1", track: "sip", nativeTrack: "sip", name: "Helios Robotics",
  applicationId: "SIP-26255", domain: "Robotics", founders: ["Asha"], ai: { overall: 8 },
  ...over,
});

function wire({ shortlisted = [], offered = [], docs = [] } = {}) {
  const listByKey = {};
  const byKey = {};
  for (const d of docs) {
    (listByKey[`${d.track}:${d.application_id}`] ||= []).push(d);
    byKey[`${d.track}:${d.application_id}`] = d;
  }
  useAdminData.mockImplementation((kind, params) => {
    if (kind === "pipeline") {
      const startups = params?.status === "offered" ? offered : shortlisted;
      return { data: { startups }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "icDocuments") {
      return { data: { documents: docs, byKey, listByKey }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Upload Memos size cap vs the API payload limit", () => {
  // The API is API Gateway (HTTP API) -> Lambda. Lambda's synchronous request
  // payload cap is 6 MB and the multipart body is base64-encoded (+33%), so
  // anything over ~4.5 MB is rejected at the gateway before the backend runs
  // (documented in backend/app/routers/sip_evidence_files.py:47-54). The modal
  // advertises and accepts PDFs up to 10 MiB.
  it("rejects a 6 MiB PDF up front instead of letting the upload fail at the gateway", () => {
    wire({ shortlisted: [mk()] });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Upload Memos"));
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "ic-memo-scan.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [big] } });
    // BUG: the file is listed as ready to upload (no error), and the copy says "up to 10 MiB".
    expect(screen.queryByText(/ic-memo-scan\.pdf · 6\.00 MiB/)).toBeNull();
  });
});

describe("empty state with an active search / decision filter", () => {
  it("does not claim there are no selected applications when a search hides them", () => {
    wire({ shortlisted: [mk(), mk({ id: "app-2", name: "Orion Bio", applicationId: "TIR-27001", track: "tir", nativeTrack: "tir" })] });
    render(<AdminSelectedApplications />);
    fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: "zzz-no-match" } });
    // BUG: 2 selected applications exist; the empty state says there are none.
    expect(screen.queryByText("No selected applications yet.")).toBeNull();
  });

  it("does not claim there are none when the Accepted decision chip is active", () => {
    wire({ shortlisted: [mk()] });
    render(<AdminSelectedApplications />);
    const seg = screen.getByLabelText("Filter by decision");
    fireEvent.click(within(seg).getByText(/^Accepted/));
    expect(screen.queryByText("No selected applications yet.")).toBeNull();
  });
});

describe("ID search on the Accepted tab (prefix ignored)", () => {
  it("'VIP-26255' does not also return TIR-26255", () => {
    // Both display-id sequences start at 26001, so TIR and VIP ids collide.
    wire({ shortlisted: [
      mk({ id: "vip-app", name: "Vip Co", applicationId: "SIP-26255" }),
      mk({ id: "tir-app", name: "Tir Co", applicationId: "TIR-26255", track: "tir", nativeTrack: "tir" }),
    ] });
    render(<AdminSelectedApplications />);
    fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: "VIP-26255" } });
    expect(screen.getByTestId("row-vip-app")).toBeTruthy();
    // BUG: the TIR row matches too (only the digits are compared).
    expect(screen.queryByTestId("row-tir-app")).toBeNull();
  });
});


describe("pdf with an empty MIME type (S2-ADM-51)", () => {
  it("is uploaded as application/pdf so the backend does not 415 it", async () => {
    wire({ shortlisted: [mk()] });
    icDocumentsApi.upload.mockResolvedValue({});
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Upload Memos"));
    const f = new File([new Uint8Array(10)], "memo.pdf", { type: "" });
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [f] } });
    fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
    await vi.waitFor(() => expect(icDocumentsApi.upload).toHaveBeenCalled());
    expect(icDocumentsApi.upload.mock.calls[0][2].type).toBe("application/pdf");
  });
});
