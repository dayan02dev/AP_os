// Post-signin / post-verify landing helper. One place owns the priority
// so SignInPage, VerifyPage, SetPasswordPage, and the /apply gate can't
// drift apart and leave a leadership/admin account briefly parked on the
// applicant wizard.
//
// Priority (highest first):
//   leadership → /leadership      (the day-to-day dashboard)
//   admin      → /admin           (reached via the Switch button on /leadership)
//   reviewer   → /reviewer       (Reviewer Portal v2 dashboard)
//   jury       → /jury           (ONLY while JURY_PORTAL_ENABLED)
//   mentor / applicant / none → /apply

// The Jury Portal is switched off for the 2026 round — there was no jury;
// admins interviewed the shortlist and decided on the Accepted tab. While
// false: every /jury route renders a static "closed" page (router.jsx), the
// PortalSwitcher hides the Jury entry, and a jury-only account falls through
// to /apply here (never /jury, so no redirect loop). Flip to true to
// re-enable next round — the pages, juryApi and backend routes are intact.
export const JURY_PORTAL_ENABLED = false;

export function landingPathFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  if (r.includes("leadership")) return "/leadership";
  if (r.includes("admin")) return "/admin";
  if (r.includes("reviewer")) return "/reviewer";
  if (JURY_PORTAL_ENABLED && r.includes("jury")) return "/jury";
  return "/apply";
}

// True when /apply should be hidden from this account (admin or leadership).
// Used by ApplyRoleGate and by UI affordances that link into the wizard.
export function isApplyHiddenFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  return r.includes("leadership") || r.includes("admin");
}
