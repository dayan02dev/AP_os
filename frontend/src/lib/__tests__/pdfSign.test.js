// pdfSign tests — these run pdf-lib for real (no mock), so they prove the
// stamp actually produces a loadable PDF rather than just that we called a
// library. That matters: the signed copy is the artefact of record.

import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { stampSignature, formatSignedAt } from "../pdfSign";

/** A real one-page PDF with some text on it. */
async function samplePdf({ width = 595, height = 842, pages = 1 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const p = doc.addPage([width, height]);
    p.drawText(`IC minutes page ${i + 1}`, { x: 50, y: height - 60, size: 14, font });
  }
  return doc.save();
}

/** A tiny valid PNG (1×1, transparent) as a data URL. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP" +
  "4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/** jsdom's Blob has no arrayBuffer(), so read it the long way round. */
function blobBytes(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function loadBlob(blob) {
  return PDFDocument.load(await blobBytes(blob));
}

describe("formatSignedAt", () => {
  it("renders an IST timestamp", () => {
    // 2026-07-30T08:42:00Z → 14:12 IST (+05:30)
    expect(formatSignedAt("2026-07-30T08:42:00Z")).toBe("30 Jul 2026 14:12 IST");
  });

  it("passes a garbage value straight back instead of throwing", () => {
    expect(formatSignedAt("not-a-date")).toBe("not-a-date");
  });
});

describe("stampSignature", () => {
  it("returns a loadable PDF blob", async () => {
    const blob = await stampSignature(await samplePdf(), { signerName: "Nirav Sanghavi" });
    expect(blob.type).toBe("application/pdf");
    const out = await loadBlob(blob);
    expect(out.getPageCount()).toBe(1);
  });

  it("stamps onto the existing last page rather than appending one", async () => {
    const blob = await stampSignature(await samplePdf({ pages: 3 }), { signerName: "N" });
    const out = await loadBlob(blob);
    expect(out.getPageCount()).toBe(3);
  });

  it("grows the file — something was actually drawn", async () => {
    const original = await samplePdf();
    const blob = await stampSignature(original, { signerName: "Nirav Sanghavi" });
    expect(blob.size).toBeGreaterThan(original.byteLength);
  });

  it("embeds a drawn signature image when one is supplied", async () => {
    const original = await samplePdf();
    const typedOnly = await stampSignature(original, { signerName: "N" });
    const withImage = await stampSignature(original, {
      signerName: "N", signatureDataUrl: PNG_DATA_URL,
    });
    // The image variant carries an extra embedded XObject.
    expect(withImage.size).toBeGreaterThan(typedOnly.size);
    expect((await loadBlob(withImage)).getPageCount()).toBe(1);
  });

  it("appends a dedicated page when the last page is too small for the box", async () => {
    // 200×200 leaves no room for a 240-wide stamp box plus margins.
    const blob = await stampSignature(await samplePdf({ width: 200, height: 200 }), {
      signerName: "Nirav Sanghavi",
    });
    const out = await loadBlob(blob);
    expect(out.getPageCount()).toBe(2);
  });

  it("requires a signer name", async () => {
    const bytes = await samplePdf();
    await expect(stampSignature(bytes, { signerName: "   " })).rejects.toThrow(/signer name/i);
    await expect(stampSignature(bytes, {})).rejects.toThrow(/signer name/i);
  });

  it("falls back to the typed mark when the signature image is corrupt", async () => {
    const blob = await stampSignature(await samplePdf(), {
      signerName: "Nirav Sanghavi",
      signatureDataUrl: "data:image/png;base64,not-really-a-png",
    });
    // No throw, still a valid single-page PDF.
    expect((await loadBlob(blob)).getPageCount()).toBe(1);
  });

  it("does not mangle a very long signer name", async () => {
    const blob = await stampSignature(await samplePdf(), {
      signerName: "Dr. ".repeat(40) + "Someone With An Extremely Long Name",
      signerEmail: "a-really-long-email-address@some-institute.example.ac.in",
    });
    expect((await loadBlob(blob)).getPageCount()).toBe(1);
  });
});
