// Swarm repro (admin_accepted): Approve stamps the signer name with a WinAnsi
// standard font; any name outside WinAnsi (Devanagari, or Latin letters such as
// "ā" common in transliterated Indian names) makes pdf-lib throw, so Approve fails.
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { stampSignature } from "../lib/pdfSign";

async function blankPdf() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return d.save();
}

describe("stampSignature with non-WinAnsi names", () => {
  for (const name of ["Ākash Rao", "नीरव संघवी", "Nirav Sanghavi"]) {
    it(`signs for "${name}"`, async () => {
      const blob = await stampSignature(await blankPdf(), {
        signerName: name, signerEmail: "a@artpark.in", signedAtIso: "2026-07-30T08:42:00Z",
      });
      expect(blob.size).toBeGreaterThan(0);
    });
  }
});
