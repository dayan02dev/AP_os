// Applicant dashboard progress mapping — pure, framework-free so it is
// unit-testable without importing the wizard shells (App.jsx / auth_upload.jsx).
//
// The backend stores progression in the application `status` column (see
// backend/app/services/state_machine.py). The dashboard's pipeline UI uses a
// 6-stage applicant-facing model. Map one to the other so a leadership/admin
// status flip (e.g. an admin Gate-1 decision) drives the dashboard
// automatically — no extra column needed.
//
// status → milestone key (pipeline stage). Non-terminal statuses only;
// terminal outcomes (rejected) are surfaced via progressFromRow's outcome.
export const STATUS_TO_MILESTONE = {
  submitted:        "submitted",     // Stage 01 Application
  ai_screening:     "submitted",
  screening_failed: "submitted",
  under_review:     "under_review",  // Stage 02 Under review
  evaluated:        "under_review",
  shortlisted:      "profile",       // Stage 03 Profile building
  jury_review:      "jury",          // Stage 04 Jury review — admin Approve advances here
  interview:        "interview",     // Stage 05 Interviews
  offered:          "onboarding",    // Stage 06 Onboarding
  onboarded:        "onboarding",
  // rejected is handled as a terminal outcome by progressFromRow; this entry
  // is only a safe fallback and is never used for the rejected render path.
  rejected:         "under_review",
  waitlisted:       "under_review",
  withdrawn:        "submitted",
};

// Application row → dashboard `sub` progress fields.
// Returns { currentMilestone, outcome, lastReached }:
//   - outcome/lastReached are null for the normal linear pipeline.
//   - rejected is terminal: we always strike "Under review" (stage 02),
//     regardless of the exact from-status the admin rejected from.
export function progressFromRow(row) {
  const status = row && row.status;
  if (status === "rejected") {
    return {
      currentMilestone: "under_review",
      outcome: "rejected",
      lastReached: "under_review",
    };
  }
  return {
    currentMilestone:
      (row && row.current_milestone) || STATUS_TO_MILESTONE[status] || "submitted",
    outcome: null,
    lastReached: null,
  };
}
