// AdminSelectedApplications tests — the single "Selected Applications" tab:
// BOTH tracks in one list + the two actions (Memo Upload, Approve). There is
// deliberately no jury round on this screen, so it must never surface
// picks/jurors/Final-Gate affordances.
//
// Seams mocked: hooks/useAdminData (data), lib/icDocumentsApi (network),
// lib/pdfSign (the pdf-lib stamp — exercised on its own elsewhere),
// hooks/useAuth (session identity). osAtoms + ui.jsx render for real.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { full_name: "Nirav Sanghavi", email: "nirav@artpark.in" } }),
}));

vi.mock("../../../../../lib/icDocumentsApi", () => ({
  icDocumentsApi: {
    list: vi.fn(),
    upload: vi.fn(),
    sign: vi.fn(),
    fileUrl: vi.fn(),
  },
}));

vi.mock("../../../../../lib/pdfSign", () => ({
  stampSignature: vi.fn(),
  formatSignedAt: (iso) => (iso ? "30 Jul 2026 14:12 IST" : ""),
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { icDocumentsApi } from "../../../../../lib/icDocumentsApi";
import { stampSignature } from "../../../../../lib/pdfSign";
import { AdminSelectedApplications } from "../AdminSelectedApplications";

// ── Fixtures ────────────────────────────────────────────────────────────────

const VIP_A = {
  id: "app-1", track: "sip", nativeTrack: "sip", name: "Helios Robotics",
  applicationId: "SIP-101", domain: "Robotics & Automation", founders: ["Asha Rao"],
  ai: { overall: 8.4 }, chip: "JURY REVIEW",
};
const VIP_B = {
  id: "app-2", track: "sip", nativeTrack: "sip", name: "Kavach Health",
  applicationId: "SIP-102", domain: "Healthcare / MedTech", founders: ["Vikram N"],
  ai: { overall: 7.1 }, chip: "JURY REVIEW",
};
// A natively-TIR application moved to VIP: it belongs on THIS screen (effective
// track = sip) but its IC document is keyed by the native track (tir).
const MOVED_TO_VIP = {
  id: "app-3", track: "sip", nativeTrack: "tir", movedToTrack: "sip",
  name: "Prithvi Aero", applicationId: "TIR-207", domain: "Defense & Aerospace",
  founders: ["Meera S"], ai: { overall: 9.0 }, chip: "JURY REVIEW",
};
// A natively-VIP application moved to TIR: it belongs here too, shown as TIR.
const MOVED_TO_TIR = {
  id: "app-4", track: "tir", nativeTrack: "sip", movedToTrack: "tir",
  name: "Sindhu Marine", applicationId: "SIP-140", domain: "Other / Frontier",
  founders: ["Ravi K"], ai: { overall: 6.2 }, chip: "JURY REVIEW",
};

// A native TIR application in jury review — before the merge these had their
// own tab with no memo column.
const TIR_A = {
  id: "app-5", track: "tir", nativeTrack: "tir",
  name: "Anvaya Motors", applicationId: "TIR-26501", domain: "EV Mobility & Services",
  founders: ["Asha P"], ai: { overall: 8.1 }, chip: "JURY REVIEW",
};

const DOC_UNSIGNED = {
  id: "d1", application_id: "app-1", track: "sip", file_name: "IC-helios.pdf",
  size_bytes: 20480, uploaded_at: "2026-07-29T10:00:00Z", signed: false,
};
const DOC_SIGNED = {
  ...DOC_UNSIGNED, signed: true, signed_at: "2026-07-30T08:42:00Z",
  signer_name: "Nirav Sanghavi", signer_email: "nirav@artpark.in",
};

const reloadPipeline = vi.fn();
const reloadDocs = vi.fn();

function wire({ startups = [VIP_A, VIP_B], docs = [], pipelineState = {}, docsState = {} } = {}) {
  const byKey = {};
  for (const d of docs) byKey[`${d.track}:${d.application_id}`] = d;
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline") {
      return {
        data: { startups }, loading: false, error: null, reload: reloadPipeline,
        ...pipelineState,
      };
    }
    if (kind === "icDocuments") {
      return {
        data: { documents: docs, byKey }, loading: false, error: null, reload: reloadDocs,
        ...docsState,
      };
    }
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  reloadPipeline.mockClear();
  reloadDocs.mockClear();
  icDocumentsApi.upload.mockResolvedValue({ document: DOC_UNSIGNED });
  icDocumentsApi.sign.mockResolvedValue({ document: DOC_SIGNED });
  icDocumentsApi.fileUrl.mockResolvedValue({ url: "https://signed.example/ic.pdf" });
  stampSignature.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
});

const pdf = (name = "ic.pdf") =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });

// ── The list ────────────────────────────────────────────────────────────────

describe("AdminSelectedApplications — application list", () => {
  it("lists the applications in jury review", () => {
    wire();
    render(<AdminSelectedApplications />);
    expect(screen.getByText("Helios Robotics")).toBeTruthy();
    expect(screen.getByText("Kavach Health")).toBeTruthy();
  });

  it("fetches jury_review across BOTH tracks and splits on the effective track", () => {
    wire();
    render(<AdminSelectedApplications />);
    // No server-side `track` param: that filter keys off the NATIVE track and
    // would drop moved apps (see the overlay tests below).
    expect(useAdminData).toHaveBeenCalledWith("pipeline", { status: "jury_review" });
  });

  it("shows the two IC actions and NO jury-round affordances", () => {
    wire();
    render(<AdminSelectedApplications />);
    expect(screen.getAllByText("Memo Upload").length).toBe(2);
    expect(screen.getAllByText("Approve").length).toBe(2);
    // No pick / juror / final-gate surface on this screen.
    expect(screen.queryByText(/pick/i)).toBeNull();
    expect(screen.queryByText(/juror/i)).toBeNull();
    expect(screen.queryByText(/final gate/i)).toBeNull();
  });

  it("disables Sign until a document exists, and enables it once uploaded", () => {
    wire({ docs: [DOC_UNSIGNED] });
    render(<AdminSelectedApplications />);
    const signButtons = screen.getAllByText("Approve");
    // app-1 has a doc → enabled; app-2 has none → disabled.
    expect(signButtons[0].disabled).toBe(false);
    expect(signButtons[1].disabled).toBe(true);
    expect(signButtons[1].getAttribute("title")).toMatch(/upload the memo first/i);
  });

  it("shows the signed chip with signer and timestamp", () => {
    wire({ docs: [DOC_SIGNED] });
    render(<AdminSelectedApplications />);
    expect(screen.getByText("✓ APPROVED")).toBeTruthy();
    expect(screen.getByText(/Nirav Sanghavi · 30 Jul 2026 14:12 IST/)).toBeTruthy();
    expect(screen.getByText("Re-approve")).toBeTruthy();
    expect(screen.getByText("Replace Memo")).toBeTruthy();
  });

  it("labels an undocumented application as Not uploaded", () => {
    wire({ docs: [] });
    render(<AdminSelectedApplications />);
    expect(screen.getAllByText("Not uploaded").length).toBe(2);
  });

  it("filters by search across project, founder and industry", () => {
    wire();
    render(<AdminSelectedApplications />);
    fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: "kavach" } });
    expect(screen.queryByText("Helios Robotics")).toBeNull();
    expect(screen.getByText("Kavach Health")).toBeTruthy();
  });

  it("renders an empty state when nothing is selected yet", () => {
    wire({ startups: [] });
    render(<AdminSelectedApplications />);
    expect(screen.getByText("No selected applications yet.")).toBeTruthy();
  });

  // ── Merged tab: both tracks in one list ───────────────────────────────────

  it("lists TIR and VIP together, each labelled by track", () => {
    // This is the whole point of the merge: one tab, one list, a chip per row.
    wire({ startups: [VIP_A, TIR_A] });
    render(<AdminSelectedApplications />);

    const vipRow = screen.getByText("Helios Robotics").closest("tr");
    const tirRow = screen.getByText("Anvaya Motors").closest("tr");
    expect(within(vipRow).getByText("VIP")).toBeTruthy();
    expect(within(tirRow).getByText("TIR")).toBeTruthy();
  });

  it("carries the memo actions for TIR rows too, not just VIP", () => {
    // TIR used to have no memo column at all — it rendered as a read-only
    // AdminPipeline list.
    wire({ startups: [TIR_A] });
    render(<AdminSelectedApplications />);
    const row = screen.getByText("Anvaya Motors").closest("tr");
    expect(within(row).getByText("Memo Upload")).toBeTruthy();
    expect(within(row).getByText("Approve")).toBeTruthy();
  });

  it("uploads a TIR memo against the TIR track", async () => {
    wire({ startups: [TIR_A] });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Memo Upload"));
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByText("Upload"));
    await waitFor(() =>
      expect(icDocumentsApi.upload).toHaveBeenCalledWith("tir", "app-5", expect.any(File)));
  });

  it("narrows to one track with the track switcher", () => {
    wire({ startups: [VIP_A, TIR_A] });
    render(<AdminSelectedApplications />);
    expect(screen.getByText("Anvaya Motors")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(screen.queryByText("Anvaya Motors")).toBeNull();
    expect(screen.getByText("Helios Robotics")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.getByText("Anvaya Motors")).toBeTruthy();
    expect(screen.queryByText("Helios Robotics")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All tracks" }));
    expect(screen.getByText("Anvaya Motors")).toBeTruthy();
    expect(screen.getByText("Helios Robotics")).toBeTruthy();
  });

  it("opens the application detail from the project name", () => {
    // The trimmed columns are fine because the full record is one click away.
    const goDetail = vi.fn();
    wire({ startups: [TIR_A] });
    render(<AdminSelectedApplications goDetail={goDetail} />);
    fireEvent.click(screen.getByText("Anvaya Motors"));
    expect(goDetail).toHaveBeenCalledWith("app-5", "tir", "jury_selected",
      [{ id: "app-5", track: "tir" }]);
  });

  // ── Track-move overlay ────────────────────────────────────────────────────

  it("includes a TIR application that was moved to VIP", () => {
    wire({ startups: [VIP_A, MOVED_TO_VIP] });
    render(<AdminSelectedApplications />);
    expect(screen.getByText("Prithvi Aero")).toBeTruthy();
  });

  it("includes a VIP application that was moved to TIR, shown as TIR", () => {
    // Both tracks share this tab now, so a moved app is never dropped — but it
    // must be labelled by its EFFECTIVE track, which is what it claims to be.
    wire({ startups: [VIP_A, MOVED_TO_TIR] });
    render(<AdminSelectedApplications />);
    expect(screen.getByText("Sindhu Marine")).toBeTruthy();
    expect(screen.getByText("Helios Robotics")).toBeTruthy();
    // Chip inside the row, not the track-filter button of the same name.
    const row = screen.getByText("Sindhu Marine").closest("tr");
    expect(within(row).getByText("TIR")).toBeTruthy();
  });

  it("matches a moved app's IC document on its NATIVE track key", () => {
    // Stored under tir:app-3 because that is where the application row lives.
    wire({
      startups: [MOVED_TO_VIP],
      docs: [{ ...DOC_SIGNED, id: "d9", application_id: "app-3", track: "tir" }],
    });
    render(<AdminSelectedApplications />);
    // Resolved (not "Not uploaded"), so the native-track key was used.
    expect(screen.getByText("✓ APPROVED")).toBeTruthy();
    expect(screen.queryByText("Not uploaded")).toBeNull();
  });

  it("surfaces a pipeline load error with a retry", () => {
    wire({ pipelineState: { data: null, error: new Error("boom"), loading: false } });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Retry"));
    expect(reloadPipeline).toHaveBeenCalled();
  });
});

// ── Memo Upload ───────────────────────────────────────────────────────────────

describe("AdminSelectedApplications — Memo Upload", () => {
  it("uploads a PDF for the chosen application and reloads", async () => {
    wire();
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getAllByText("Memo Upload")[0]);

    fireEvent.change(screen.getByLabelText("Memo PDF"), {
      target: { files: [pdf("minutes.pdf")] },
    });
    fireEvent.click(screen.getByText("Upload"));

    await waitFor(() => expect(icDocumentsApi.upload).toHaveBeenCalled());
    const [track, appId, file] = icDocumentsApi.upload.mock.calls[0];
    expect(track).toBe("sip");
    expect(appId).toBe("app-1");
    expect(file.name).toBe("minutes.pdf");
    await waitFor(() => expect(reloadDocs).toHaveBeenCalled());
  });

  it("refuses a non-PDF before any network call", () => {
    wire();
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getAllByText("Memo Upload")[0]);
    fireEvent.change(screen.getByLabelText("Memo PDF"), {
      target: { files: [new File(["x"], "notes.docx", { type: "application/msword" })] },
    });
    expect(screen.getByText("Only PDF files are accepted.")).toBeTruthy();
    expect(screen.getByText("Upload").disabled).toBe(true);
    expect(icDocumentsApi.upload).not.toHaveBeenCalled();
  });

  it("refuses a file over the 10 MiB cap before any network call", () => {
    wire();
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getAllByText("Memo Upload")[0]);
    const big = new File([new Uint8Array(2)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [big] } });
    expect(screen.getByText(/the limit is 10 MiB/)).toBeTruthy();
    expect(icDocumentsApi.upload).not.toHaveBeenCalled();
  });

  it("warns that replacing archives the existing document", () => {
    wire({ docs: [DOC_SIGNED] });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Replace Memo"));
    expect(screen.getByText(/its signature will be archived with it/)).toBeTruthy();
  });

  it("uploads a moved app's IC document against its NATIVE track", async () => {
    wire({ startups: [MOVED_TO_VIP] });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Memo Upload"));
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByText("Upload"));

    await waitFor(() => expect(icDocumentsApi.upload).toHaveBeenCalled());
    // "tir", not the effective "sip" — the app row lives in tir_applications.
    expect(icDocumentsApi.upload.mock.calls[0][0]).toBe("tir");
    expect(icDocumentsApi.upload.mock.calls[0][1]).toBe("app-3");
  });

  it("shows a server error message instead of closing", async () => {
    wire();
    icDocumentsApi.upload.mockRejectedValue({ details: { message: "Storage upload failed. Try again." } });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getAllByText("Memo Upload")[0]);
    fireEvent.change(screen.getByLabelText("Memo PDF"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByText("Upload"));
    await waitFor(() =>
      expect(screen.getByText("Storage upload failed. Try again.")).toBeTruthy());
  });
});

// ── Signing ─────────────────────────────────────────────────────────────────

describe("AdminSelectedApplications — Approve", () => {
  const openSign = () => {
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getAllByText("Approve")[0]);
  };

  it("prefills the signer name from the session and requires confirmation", () => {
    wire({ docs: [DOC_UNSIGNED] });
    openSign();
    expect(screen.getByLabelText("Signer name").value).toBe("Nirav Sanghavi");
    // Not confirmed yet → cannot sign.
    expect(screen.getByText("Approve & save").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    expect(screen.getByText("Approve & save").disabled).toBe(false);
  });

  it("blocks signing with an empty name even when confirmed", () => {
    wire({ docs: [DOC_UNSIGNED] });
    openSign();
    fireEvent.change(screen.getByLabelText("Signer name"), { target: { value: "  " } });
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    expect(screen.getByText("Approve & save").disabled).toBe(true);
  });

  it("stamps the downloaded PDF and uploads the signed copy", async () => {
    wire({ docs: [DOC_UNSIGNED] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, arrayBuffer: async () => new ArrayBuffer(8),
    });
    openSign();
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    fireEvent.click(screen.getByText("Approve & save"));

    await waitFor(() => expect(icDocumentsApi.sign).toHaveBeenCalled());
    // Original pulled through a signed URL, then stamped, then stored.
    expect(icDocumentsApi.fileUrl).toHaveBeenCalledWith("sip", "app-1", "original");
    expect(stampSignature).toHaveBeenCalled();
    const [track, appId, blob, signerName, fileName] = icDocumentsApi.sign.mock.calls[0];
    expect([track, appId, signerName]).toEqual(["sip", "app-1", "Nirav Sanghavi"]);
    expect(blob).toBeInstanceOf(Blob);
    expect(fileName).toBe("IC-helios-signed.pdf");
  });

  it("passes the typed name through as the stamp mark when nothing is drawn", async () => {
    wire({ docs: [DOC_UNSIGNED] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, arrayBuffer: async () => new ArrayBuffer(8),
    });
    openSign();
    fireEvent.change(screen.getByLabelText("Signer name"), { target: { value: "Udita U" } });
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    fireEvent.click(screen.getByText("Approve & save"));

    await waitFor(() => expect(stampSignature).toHaveBeenCalled());
    const opts = stampSignature.mock.calls[0][1];
    expect(opts.signerName).toBe("Udita U");
    expect(opts.signatureDataUrl).toBeNull();
    expect(opts.signerEmail).toBe("nirav@artpark.in");
  });

  it("tells the signer when re-approving replaces an existing signature", () => {
    wire({ docs: [DOC_SIGNED] });
    render(<AdminSelectedApplications />);
    fireEvent.click(screen.getByText("Re-approve"));
    expect(screen.getByText(/Approving again replaces that signature/)).toBeTruthy();
  });

  it("reports a download failure without uploading anything", async () => {
    wire({ docs: [DOC_UNSIGNED] });
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    openSign();
    fireEvent.click(screen.getByLabelText("Confirm signature"));
    fireEvent.click(screen.getByText("Approve & save"));

    await waitFor(() =>
      expect(screen.getByText("Couldn't download the IC document to sign.")).toBeTruthy());
    expect(icDocumentsApi.sign).not.toHaveBeenCalled();
  });
});
