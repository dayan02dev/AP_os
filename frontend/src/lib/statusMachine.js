// Client mirror of backend/app/services/state_machine.py — Phase 1 §4.8.
//
// Keep in sync with the Python source; the backend remains the authority on
// every transition. This module's live export is labelFor() — the human
// label for a status id, used by the review/reviewer headers. LEGAL_TRANSITIONS
// is retained as a reference mirror (its old consumer, the leadership
// status-change modal, was removed).

export const LEGAL_TRANSITIONS = {
  submitted:        ["withdrawn"],
  ai_screening:     ["withdrawn"],
  screening_failed: ["withdrawn"],
  under_review:     ["evaluated", "withdrawn"],
  evaluated:        ["shortlisted", "rejected", "waitlisted", "withdrawn"],
  shortlisted:      ["withdrawn"],
  interview:        ["withdrawn"],
  offered:          ["withdrawn"],
  onboarded:        ["withdrawn"],
  rejected:         ["withdrawn"],
  waitlisted:       ["withdrawn"],
  withdrawn:        [],
};

// Mirrors stats.PHASE_1_STATUSES on the backend so the modal renders the
// same human labels the dashboard uses. Adding a status here without
// matching backend/app/services/stats.py will get caught by the round-trip.
export const STATUS_LABELS = {
  draft:            "Draft",
  submitted:        "Submitted",
  ai_screening:     "AI screening",
  screening_failed: "AI screening failed",
  under_review:     "Under review",
  evaluated:        "Evaluated",
  shortlisted:      "Shortlisted",
  interview:        "Interview",
  offered:          "Offered",
  onboarded:        "Onboarded",
  rejected:         "Not selected",
  waitlisted:       "Waitlisted",
  withdrawn:        "Withdrawn",
};

export function legalNextStates(fromStatus) {
  if (!fromStatus) return [];
  return LEGAL_TRANSITIONS[fromStatus] || [];
}

export function labelFor(statusId, fallback) {
  return STATUS_LABELS[statusId] || fallback || statusId || "—";
}
