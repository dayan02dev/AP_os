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

// Track-moved apps keep their NATIVE display ID (e.g. "TIR-26255" — the
// effective-track prefix collided with real VIP IDs) and show a marker for
// where they were moved: "→ VIP". Empty when not moved.
export function movedMarker(movedToTrack) {
  return movedToTrack ? `→ ${trackLabel(movedToTrack)}` : "";
}

// Display ID + moved marker as plain text: "TIR-26255 → VIP", or with
// { csv: true } "TIR-26255 (→ VIP)". Empty-safe.
export function displayIdText(displayId, movedToTrack, { csv = false } = {}) {
  const id = relabelDisplayId(displayId);
  const mark = movedMarker(movedToTrack);
  if (!id || !mark) return id;
  return csv ? `${id} (${mark})` : `${id} ${mark}`;
}
