import { trackLabel } from "./trackLabel";

const OTHER = { tir: "sip", sip: "tir" };

// Button label: when not moved → "Move to <other>"; when moved → "Move back
// to <home>". `track` is the app's home track code; `movedToTrack` is the
// stored flag (falsy == not moved).
export function moveButtonLabel(track, movedToTrack) {
  if (movedToTrack) return `Move back to ${trackLabel(track)}`;
  return `Move to ${trackLabel(OTHER[track])}`;
}

// Highlight badge text, or null when the app has not been moved.
export function moveBadgeText(track, movedToTrack) {
  if (!movedToTrack) return null;
  return `MOVED · ${trackLabel(track)} → ${trackLabel(movedToTrack)}`;
}
