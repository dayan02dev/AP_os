// Post-signin / post-verify landing helper. One place owns the priority
// so SignInPage, VerifyPage, SetPasswordPage, and the /apply gate can't
// drift apart and leave a leadership/admin account briefly parked on the
// applicant wizard.
//
// Priority (highest first):
//   leadership → /leadership      (the day-to-day dashboard)
//   admin      → /admin           (reached via the Switch button on /leadership)
//   reviewer   → /reviewer       (Reviewer Portal v2 dashboard)
//   mentor / applicant / none → /apply

export function landingPathFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  if (r.includes("leadership")) return "/leadership";
  if (r.includes("admin")) return "/admin";
  if (r.includes("reviewer")) return "/reviewer";
  return "/apply";
}

// True when /apply should be hidden from this account (admin or leadership).
// Used by ApplyRoleGate and by UI affordances that link into the wizard.
export function isApplyHiddenFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  return r.includes("leadership") || r.includes("admin");
}
