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
    expect(screen.getByRole("button", { name: /^Upload/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Replace/ })).not.toBeInTheDocument();

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
    expect(screen.getByRole("button", { name: /^Replace/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Upload/ })).not.toBeInTheDocument();
  });

  // F10: on the real Evidence step there are six levers each with a
  // required slot plus backfill slots, so "Upload" / "Replace" / "Download"
  // / "Delete" alone are not unique accessible names. Proven with two
  // EvidenceRows on screen at once, the way the wizard actually renders
  // them — a single row in isolation (every other test in this file) can't
  // expose the collision.
  it("F10: upload and download controls name their lever so multiple rows on screen don't collide", () => {
    const rowA = { id: "ev-a", filename: "a.pdf", size_bytes: 100, uploaded_at: null, air_level: 6 };
    const rowB = { id: "ev-b", filename: "b.pdf", size_bytes: 100, uploaded_at: null, air_level: 6 };
    render(
      <>
        <EvidenceRow
          lever={lever({ claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [rowA] })}
          documents={DOCUMENTS}
          onUpload={noop}
          onDelete={noop}
          onDownload={noop}
        />
        <EvidenceRow
          lever={lever({
            lever: "user_needs", name: "User Needs & Requirements",
            claimed_level: 6, required_document: "Sourcing Plan & TCO Model", evidence: [rowB],
          })}
          documents={DOCUMENTS}
          onUpload={noop}
          onDelete={noop}
          onDownload={noop}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: /Replace.*Supply Chain Readiness/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Replace.*User Needs & Requirements/ })).toBeInTheDocument();

    const downloads = screen.getAllByRole("button", { name: /download/i });
    expect(downloads).toHaveLength(2);
    expect(downloads[0].getAttribute("aria-label")).not.toBe(downloads[1].getAttribute("aria-label"));
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
    expect(screen.getByRole("button", { name: /^Replace/ })).toBeDisabled();
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

  // F1: `required_document` names the document at the CLAIMED level, but the
  // catalog's fallback means the document actually asked for lives at a
  // lower level (claiming 5 resolves to the level-4 doc). The slot itself —
  // its `level` prop, its upload target, its accessible name — must follow
  // the resolved level, not the claimed one, or the founder's upload gets
  // filed under a level the framework defines no document for.
  it("F1: a gap-level claim resolves the required slot to the fallback level, not the claimed one", () => {
    const onUpload = vi.fn();
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 5, required_document: "DFMA Report" })}
        documents={DOCUMENTS}
        onUpload={onUpload}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    // Accessible name of the required slot's input names AIR 4, not AIR 5:
    const input = screen.getByLabelText("Upload AIR 4 evidence");
    expect(screen.queryByLabelText("Upload AIR 5 evidence")).not.toBeInTheDocument();

    const f = file("dfma.pdf");
    fireEvent.change(input, { target: { files: [f] } });
    expect(onUpload).toHaveBeenCalledWith(4, f);
    expect(onUpload).not.toHaveBeenCalledWith(5, f);
  });

  it("F1: a stored row at the resolved (fallback) level appears in the required slot", () => {
    const row = { id: "ev-1", filename: "dfma.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 4 };
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 5, required_document: "DFMA Report", evidence: [row] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    // Visible without opening backfill — it's the required slot, not a
    // backfill slot:
    expect(screen.getByText("dfma.pdf")).toBeInTheDocument();
  });

  // F2: a row can end up at a level that is neither the required slot nor
  // any backfill slot — either because it was uploaded at a gap level
  // before F1's fix, or because the founder answered differently after
  // uploading and the claim moved. Either way the row still occupies
  // storage and still reaches the verifier, so it must render SOMEWHERE.
  it("F2: a row at a level neither required nor backfill renders in a catch-all section, and is downloadable/deletable", () => {
    const orphan = { id: "ev-orphan", filename: "old-claim.pdf", size_bytes: 2048, uploaded_at: "2026-06-01T00:00:00Z", air_level: 5 };
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 3, required_document: "Draft BOM", evidence: [orphan] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={onDelete}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText("old-claim.pdf")).toBeInTheDocument();
    expect(screen.getByText(/AIR 5/)).toBeInTheDocument();

    const downloadBtn = screen.getByRole("button", { name: /download/i });
    fireEvent.click(downloadBtn);
    expect(onDownload).toHaveBeenCalledWith("ev-orphan");

    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith("ev-orphan");
  });

  it("F2: the catch-all section is absent when every row is already shown by a required or backfill slot", () => {
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
    expect(document.querySelector(".fj-evidence-orphaned")).toBeNull();
  });

  it("F2: downgrading a claim (5 -> 3) with a level-5 row already on file surfaces the row rather than dropping it", () => {
    const staleRow = { id: "ev-stale", filename: "dfma.pdf", size_bytes: 1024, uploaded_at: "2026-05-01T00:00:00Z", air_level: 5 };
    render(
      <EvidenceRow
        lever={lever({ claimed_level: 3, required_document: "Draft BOM", evidence: [staleRow] })}
        documents={DOCUMENTS}
        onUpload={noop}
        onDelete={noop}
        onDownload={noop}
      />,
    );
    expect(screen.getByText("dfma.pdf")).toBeInTheDocument();
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
