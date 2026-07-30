// Stamp a digital signature into a PDF, in the browser.
//
// Why client-side: the backend Lambda bundle is built on an Amazon Linux 2
// container (glibc 2.26) that already forced a tiktoken pin — adding a Python
// PDF/imaging stack (reportlab + Pillow) there is a real deployment risk.
// pdf-lib is pure JS with no native deps, and the signer is sitting at the
// browser anyway. The *recorded* signer identity and timestamp still come from
// the authenticated session server-side (see routers/ic_documents.py); this
// module only produces the visual artefact.
//
// The stamp goes in the bottom-right of the last page, inside a bordered white
// box so it stays legible over existing content. If the last page is too small
// to hold the box, a dedicated signature page is appended instead.
//
// pdf-lib is imported DYNAMICALLY: it is ~450 kB raw / ~184 kB gzip, and only an
// admin signing an IC form ever needs it. A static import put all of that in the
// main bundle that every applicant downloads; this way Vite emits it as its own
// chunk, fetched on the first signature.

const BOX_W = 240;
const BOX_H = 96;
const MARGIN = 28;
const PAD = 10;
const ACCENT_RGB = [0.196, 0.075, 0.717];   // #3213b7
const INK_RGB = [0.14, 0.14, 0.14];
const DIM_RGB = [0.42, 0.42, 0.46];

/** "30 Jul 2026 14:12 IST" — matches the date voice used across the portals. */
export function formatSignedAt(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return String(iso || "");
  const s = d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return s.replace(",", "") + " IST";
}

/** data:image/png;base64,… → Uint8Array */
function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Trim a string to fit `maxWidth` at `size`, adding an ellipsis if cut. */
function fit(text, font, size, maxWidth) {
  let s = String(text || "");
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

/**
 * @param {ArrayBuffer|Uint8Array} originalBytes  the uploaded IC PDF
 * @param {object} opts
 * @param {string} [opts.signatureDataUrl]  drawn signature as a PNG data URL
 * @param {string} opts.signerName          typed name (also the fallback mark)
 * @param {string} [opts.signerEmail]
 * @param {string} [opts.signedAtIso]
 * @returns {Promise<Blob>} the signed PDF
 */
export async function stampSignature(originalBytes, opts = {}) {
  const { signatureDataUrl, signerName, signerEmail, signedAtIso } = opts;
  const name = (signerName || "").trim();
  if (!name) throw new Error("A signer name is required to sign.");

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const ACCENT = rgb(...ACCENT_RGB);
  const INK = rgb(...INK_RGB);
  const DIM = rgb(...DIM_RGB);

  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const pages = pdf.getPages();
  let page = pages[pages.length - 1];
  let { width, height } = page.getSize();

  // Not enough room for the box → give the signature its own page.
  if (!page || width < BOX_W + MARGIN * 2 || height < BOX_H + MARGIN * 2) {
    page = pdf.addPage();
    ({ width, height } = page.getSize());
  }

  const x = width - BOX_W - MARGIN;
  const y = MARGIN;

  page.drawRectangle({
    x, y, width: BOX_W, height: BOX_H,
    color: rgb(1, 1, 1), opacity: 0.94,
    borderColor: ACCENT, borderWidth: 1,
  });

  page.drawText("DIGITALLY SIGNED", {
    x: x + PAD, y: y + BOX_H - PAD - 7,
    size: 7, font: helvBold, color: ACCENT,
  });

  // The mark itself: the drawn signature if we have one, else the typed name
  // set in italic so it reads as a signature rather than body text.
  const markTop = y + BOX_H - PAD - 16;
  const markH = 34;
  if (signatureDataUrl) {
    try {
      const png = await pdf.embedPng(dataUrlToBytes(signatureDataUrl));
      const maxW = BOX_W - PAD * 2;
      const scale = Math.min(maxW / png.width, markH / png.height);
      page.drawImage(png, {
        x: x + PAD,
        y: markTop - markH + (markH - png.height * scale) / 2,
        width: png.width * scale,
        height: png.height * scale,
      });
    } catch {
      // A corrupt canvas export must not sink the signing flow — fall through
      // to the typed mark below.
      page.drawText(fit(name, italic, 20, BOX_W - PAD * 2), {
        x: x + PAD, y: markTop - 22, size: 20, font: italic, color: INK,
      });
    }
  } else {
    page.drawText(fit(name, italic, 20, BOX_W - PAD * 2), {
      x: x + PAD, y: markTop - 22, size: 20, font: italic, color: INK,
    });
  }

  page.drawLine({
    start: { x: x + PAD, y: y + PAD + 22 },
    end: { x: x + BOX_W - PAD, y: y + PAD + 22 },
    thickness: 0.5, color: DIM,
  });
  page.drawText(fit(name, helvBold, 9, BOX_W - PAD * 2), {
    x: x + PAD, y: y + PAD + 12, size: 9, font: helvBold, color: INK,
  });
  const meta = [signerEmail, formatSignedAt(signedAtIso)].filter(Boolean).join(" · ");
  page.drawText(fit(meta, helv, 7, BOX_W - PAD * 2), {
    x: x + PAD, y: y + PAD + 3, size: 7, font: helv, color: DIM,
  });

  const bytes = await pdf.save();
  return new Blob([bytes], { type: "application/pdf" });
}
