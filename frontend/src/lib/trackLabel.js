// Brand label: the public "VIP" track is the `sip` track in code/data.
// DISPLAY ONLY — never use these for API params, routes, or comparisons.
export function trackLabel(track) {
  const t = (track || "").toLowerCase();
  if (t === "tir") return "TIR";
  if (t === "sip") return "VIP";
  return (track || "").toUpperCase();
}

// Relabel a backend-sent display id ("SIP-26710" → "VIP-26710") for display.
// Leaves "TIR-…" and anything else untouched. Empty-safe.
export function relabelDisplayId(displayId) {
  return (displayId || "").replace(/^SIP-/i, "VIP-");
}
