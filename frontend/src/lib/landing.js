// Post-signin / post-verify landing helper. One place owns the priority
// so SignInPage, VerifyPage, SetPasswordPage, and the /apply gate can't
// drift apart and leave a leadership/admin account briefly parked on the
// applicant wizard.
//
// Priority (highest first):
//   leadership → /leadership      (the day-to-day dashboard)
//   admin      → /admin           (reached via the Switch button on /leadership)
//   reviewer   → /reviewer-v2/inbox  (allowlisted) | /reviewer/inbox  (everyone else)
//   mentor / applicant / none → /apply

// Reviewer V2 allowlist — these three accounts land on the new UI
// (work/reviewer-integration). All other reviewers land on the
// existing /reviewer/* surface. Remove this allowlist after manager
// signs off on cutting everyone over to V2.
const REVIEWER_V2_ALLOWLIST = new Set([
  "udayan.pawar@artpark.in",
  "sanjay.haritwal@artpark.in",
  "dev@artpark.in",
]);

function isReviewerV2(email) {
  return Boolean(email) && REVIEWER_V2_ALLOWLIST.has(email.toLowerCase());
}

// roles  — string[] from user.roles
// email  — user.email (optional; omit for contexts where email isn't available)
export function landingPathFor(roles, email) {
  const r = Array.isArray(roles) ? roles : [];
  if (r.includes("leadership")) return "/leadership";
  if (r.includes("admin")) return "/admin";
  if (r.includes("reviewer")) {
    return isReviewerV2(email) ? "/reviewer-v2/inbox" : "/reviewer/inbox";
  }
  return "/apply";
}

// True when /apply should be hidden from this account (admin or leadership).
// Used by ApplyRoleGate and by UI affordances that link into the wizard.
export function isApplyHiddenFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  return r.includes("leadership") || r.includes("admin");
}
