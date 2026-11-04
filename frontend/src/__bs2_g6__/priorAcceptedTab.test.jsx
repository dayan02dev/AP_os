// Swarm repro tests (admin_accepted) — Accepted tab (AdminSelectedApplications).
// Each test asserts the CORRECT behaviour; a failure demonstrates the bug.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
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
import { stampSignature } from "../lib/pdfSign";
import { AdminSelectedApplications } from "../pages/admin/platform/screens/AdminSelectedApplications";

const APP = {
  id: "app-1", track: "sip", nativeTrack: "sip", name: "Helios Robotics",
  applicationId: "SIP-101", domain: "Robotics", founders: ["Asha"], ai: { overall: 8 },
};
const D1 = { id: "d1", application_id: "app-1", track: "sip", file_name: "a.pdf", uploaded_at: "2026-07-01", signed: false };
const D2 = { id: "d2", application_id: "app-1", track: "sip", file_name: "b.pdf", uploaded_at: "2026-07-02", signed: false };

const reloadPipeline = vi.fn();
const reloadDocs = vi.fn();

function wire({ startups = [APP], docs = [], docsState = {} } = {}) {
  const listByKey = {};
  const byKey = {};
  for (const d of docs) {
    (listByKey[`${d.track}:${d.application_id}`] ||= []).push(d);
    byKey[`${d.track}:${d.application_id}`] = d;
  }
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline") return { data: { startups }, loading: false, error: null, reload: reloadPipeline };
    if (kind === "icDocuments") {
      return { data: { documents: docs, byKey, listByKey }, loading: false, error: null, reload: reloadDocs, ...docsState };
    }
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  icDocumentsApi.fileUrl.mockResolvedValue({ url: "https://signed.example/x.pdf" });
  stampSignature.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
});

describe("IC documents load failure", () => {
  it("surfaces an error instead of showing every memo as 'Not uploaded'", () => {
    // GET /ic-documents failed (timeout / 5xx): data null, error set.
    wire({ docsState: { data: null, error: new Error("timeout"), loading: false } });
    render(<AdminSelectedApplications />);
    // BUG: no error is rendered; the row claims no memo exists and Approve is disabled.
    expect(screen.queryByText("Not uploaded")).toBeNull();
  });
});

describe("Manage Memos — partial remove failure", () => {
  it("a retry does not re-remove a document that was already removed", async () => {
    wire({ docs: [D1, D2] });
    const removed = new Set();
    icDocumentsApi.remove.mockImplementation(async (_t, _a, id) => {
      if (removed.has(id)) {
        const e = new Error("gone"); e.details = { code: "document_not_found", message: "That document is no longer current. Refresh and try again." };
        throw e;
      }
      if (id === "d2" && !removed.has("d2-failed-once")) {
        removed.add("d2-failed-once");
        const e = new Error("net"); e.details = { message: "Couldn't remove the document. Try again." };
        throw e;
      }
      removed.add(id);
      return { removed: id };
    });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Manage Memos"));
    fireEvent.click(screen.getByLabelText("Remove a.pdf"));
    fireEvent.click(screen.getByLabelText("Remove b.pdf"));
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText(/Couldn't remove the document/);
    // Retry
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(icDocumentsApi.remove).toHaveBeenCalledTimes(3));
    const calls = icDocumentsApi.remove.mock.calls.map((c) => c[2]);
    // BUG: retry calls remove('d1') again -> 404 "no longer current" -> stuck.
    expect(calls).toEqual(["d1", "d2", "d2"]);
  });
});

describe("Approve — partial sign failure", () => {
  it("refreshes the row when some documents were signed before a failure", async () => {
    wire({ docs: [D1, D2] });
    icDocumentsApi.sign
      .mockResolvedValueOnce({ document: { ...D1, signed: true } })
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { details: { message: "Storage upload failed. Try again." } }));
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    fireEvent.click(screen.getByText("Approve & save"));
    await screen.findByText(/Storage upload failed/);
    fireEvent.click(screen.getByText("Cancel"));
    // d1 IS signed server-side; the list must reload or it keeps saying "Not approved".
    expect(reloadDocs).toHaveBeenCalled(); // BUG: never called
  });
});

