import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EvidenceRow from "../components/EvidenceRow.jsx";

// supply_chain-shaped fixture: the real catalog (air_catalog.DOCUMENTS) has
// no document defined at supply_chain levels 1, 3, 5 or 7 — deliberate gaps
// per air_catalog.required_document's fallback rule. Reusing that exact
// shape here (rather than an invented gapless one) is what makes the
// "skips gaps" test mean something.
const DOCUMENTS = {
  2: "Draft BOM",
  4: "DFMA Report",
  6: "Sourcing Plan & TCO Model",
  8: "Pilot Run Report",
  9: "Production Dashboard",
};

const lever = (over = {}) => ({
  lever: "supply_chain",
  name: "Supply Chain Readiness",
  family: "commercial",
  claimed_level: null,
  required_document: null,
  evidence: [],
  ...over,
});

function file(name = "evidence.pdf", type = "application/pdf") {
  return new File(["x"], name, { type });
}

function noop() {}

describe("EvidenceRow", () => {
  // supply_chain defines documents only at 2/4/6/8/9 while AIR 1 and 5 are
  // both reachable claims, so the catalog's gaps are not hypothetical.
  it("catalog gap: a claimed level with no document at or below it says so, rather than claiming the questions are unanswered", () => {
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 1, required_document: null })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByText(/No qualifying document is defined at or below AIR 1/))
      .toBeInTheDocument();
    expect(screen.queryByText(/once this lever's questions are answered/))
      .not.toBeInTheDocument();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("catalog gap: the fallback document required at a gap level is not also offered as backfill", () => {
    // Claiming 5 resolves to the level-4 document (DFMA Report). Listing
    // level 4 as optional backfill would show that same document twice and
    // let it be uploaded against two different levels.
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 5, required_document: "DFMA Report" })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    fireEvent.click(screen.getByText(/Optional backfill documents/));
    expect(screen.getByText("Draft BOM")).toBeInTheDocument();
    expect(screen.queryByText("AIR 4")).not.toBeInTheDocument();
    expect(screen.getAllByText("DFMA Report")).toHaveLength(1);
  });

  it("null required_document: no claimed level yet renders no file input anywhere, and explains why", () => {
    render(<EvidenceRow lever={lever()} documents={DOCUMENTS} onUpload={noop} onDelete={noop} onDownload={noop} />);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(screen.getByText(/named once/i)).toBeInTheDocument();
  });

  it("still shows the lever name in the null-required_document empty state", () => {
    render(<EvidenceRow lever={lever()} documents={DOCUMENTS} onUpload={noop} onDelete={noop} onDownload={noop} />);
    expect(screen.getByText("Supply Chain Readiness")).toBeInTheDocument();
  });

  it("existing evidence row shows filename, size, uploaded date, and a working download", () => {
    const onDownload = vi.fn();
    const row = {
      id: "ev-1", filename: "sourcing-plan.pdf", size_bytes: 20480,
      uploaded_at: "2026-08-01T00:00:00Z", air_level: 6,
    };
    const expectedDate = new Date(row.uploaded_at).toLocaleDateString();
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [row] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={onDownload}
      />,
    );
    const fileRow = screen.getByText("sourcing-plan.pdf").closest(".fj-evidence-file");
    expect(fileRow.textContent).toContain("20 KB");
    expect(fileRow.textContent).toContain(expectedDate);

    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(onDownload).toHaveBeenCalledWith("ev-1");
  });

  it("upload control reads as Upload when the slot is empty, and Replace once a row exists", () => {
    const { rerender } = render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();

    const row = { id: "ev-1", filename: "sourcing-plan.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 6 };
    rerender(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [row] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("disabled locks upload and delete but leaves download enabled — founders must reach their own docs after submit", () => {
    const row = { id: "ev-1", filename: "sourcing-plan.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 6 };
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [row] })}
        documents={DOCUMENTS}
        disabled
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /download/i })).not.toBeDisabled();
  });

  it("disabled also hides the required slot's file input (not just the trigger button)", () => {
    const row = { id: "ev-1", filename: "sourcing-plan.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 6 };
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [row] })}
        documents={DOCUMENTS}
        disabled
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByLabelText("Upload AIR 6 evidence")).toBeDisabled();
  });

  it("optional backfill, collapsed by default: nothing from it renders until the toggle is opened", () => {
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model" })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.queryByText("Draft BOM")).not.toBeInTheDocument();
    expect(screen.queryByText("DFMA Report")).not.toBeInTheDocument();
  });

  it("optional backfill offers exactly the catalog's below-claimed levels, skipping the gaps at 1/3/5", () => {
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model" })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /optional backfill/i }));

    // The two below-claimed levels the catalog actually defines:
    expect(screen.getByText("Draft BOM")).toBeInTheDocument();
    expect(screen.getByText("AIR 2")).toBeInTheDocument();
    expect(screen.getByText("DFMA Report")).toBeInTheDocument();
    expect(screen.getByText("AIR 4")).toBeInTheDocument();

    // Gaps the catalog leaves undefined below the claimed level — no row:
    expect(screen.queryByText("AIR 1")).not.toBeInTheDocument();
    expect(screen.queryByText("AIR 3")).not.toBeInTheDocument();
    expect(screen.queryByText("AIR 5")).not.toBeInTheDocument();

    // The claimed level itself and anything above it is not "backfill":
    expect(screen.queryByText("AIR 6")).not.toBeInTheDocument();
    expect(screen.queryByText("AIR 8")).not.toBeInTheDocument();
    expect(screen.queryByText("AIR 9")).not.toBeInTheDocument();
  });

  it("marks each backfill row as optional", () => {
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model" })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /optional backfill/i }));
    expect(screen.getAllByText(/optional/i).length).toBeGreaterThanOrEqual(2);
  });

  it("no claimed level yet (null claimed_level) means no backfill section at all", () => {
    render(<EvidenceRow lever={lever()} documents={DOCUMENTS} onUpload={noop} onDelete={noop} onDownload={noop} />);
    expect(screen.queryByRole("button", { name: /optional backfill/i })).not.toBeInTheDocument();
  });

  it("onUpload receives the level it was invoked from, proved on a backfill level rather than the required one", () => {
    const onUpload = vi.fn();
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model" })}
        documents={DOCUMENTS}
        onUpload={onUpload}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /optional backfill/i }));

    const backfillInput = screen.getByLabelText("Upload AIR 2 evidence");
    const f = file("draft-bom.pdf");
    fireEvent.change(backfillInput, { target: { files: [f] } });

    expect(onUpload).toHaveBeenCalledWith(2, f);
    expect(onUpload).not.toHaveBeenCalledWith(6, f);
  });

  it("existing backfill evidence files under its own level, not against the required slot", () => {
    const requiredRow = { id: "ev-req", filename: "sourcing-plan.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 6 };
    const backfillRow = { id: "ev-back", filename: "draft-bom.pdf", size_bytes: 512, uploaded_at: "2026-07-01T00:00:00Z", air_level: 2 };
    render(
      <EvidenceRow
        lever={lever({
          claimed_level: 6,
          required_document: "Sourcing Plan & TCO Model",
          evidence: [requiredRow, backfillRow],
        })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    // Required-slot filename is visible without opening backfill:
    expect(screen.getByText("sourcing-plan.pdf")).toBeInTheDocument();
    expect(screen.queryByText("draft-bom.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /optional backfill/i }));
    expect(screen.getByText("draft-bom.pdf")).toBeInTheDocument();
    // And the AIR-2 slot now reads Replace, not Upload, because it already
    // has a row on file:
    const air2Item = screen.getByText("AIR 2").closest(".fj-evidence-backfill-item");
    expect(air2Item.textContent).toContain("Replace");
  });
});
