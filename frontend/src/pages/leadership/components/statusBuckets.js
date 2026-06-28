// Maps a backend status id → coarse bucket id used for the .lp-status-{bucket}
// dot color in StatusGrid + StatusChip. Adjust here only — every consumer reads
// this. Keep in sync with backend stats.PHASE_1_STATUSES.
export const STATUS_BUCKET = {
  submitted:    "open",
  ai_screening: "review",
  under_review: "review",
  evaluated:    "review",
  shortlisted:  "advance",
  jury_review:  "advance",
  interview:    "advance",
  offered:      "decision",
  onboarded:    "decision",
  rejected:     "decision",
  waitlisted:   "decision",
  withdrawn:    "decision",
};

export function bucketFor(statusId) {
  return STATUS_BUCKET[statusId] || "open";
}
