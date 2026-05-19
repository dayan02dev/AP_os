// Maps an assignment row to one of the inbox bucket states.

export const INBOX_STATES = {
  TO_REVIEW: "to_review",
  EDITABLE: "editable",
};

export function bucketForAssignment(assignment, now = new Date()) {
  const r = assignment?.my_review;
  if (!r || !r.submitted_at) return INBOX_STATES.TO_REVIEW;
  if (!r.locked_at) return INBOX_STATES.EDITABLE;  // defensive — post-submit should always have locked_at
  const lockedAt = new Date(r.locked_at);
  if (lockedAt > now) return INBOX_STATES.EDITABLE;
  return null;  // locked — should have been filtered server-side; defensive null
}
