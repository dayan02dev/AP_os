// Canonical, human-facing application reference id — used everywhere a
// reference is shown (dashboard, submission view, receipt) so the format is
// consistent. e.g. "TIR-2026-025B" / "VIP-2026-9F3A".
export function formatRefId(id, track = "tir") {
  const prefix = track === "sip" ? "VIP" : "TIR";
  const hash =
    String(id || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 4)
      .toUpperCase() || "0000";
  return `${prefix}-2026-${hash}`;
}
