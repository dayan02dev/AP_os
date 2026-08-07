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
  if (r.includes("jury")) return "/jury";
  return "/apply";
}

// True when /apply should be hidden from this account (admin or leadership).
// Used by ApplyRoleGate and by UI affordances that link into the wizard.
export function isApplyHiddenFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  return r.includes("leadership") || r.includes("admin");
}

// True when this account must choose its own password before it can use a
// staff portal.
//
// Reviewers and jury members are onboarded with a system-generated temporary
// password emailed to them (admin_users.create_user / jury_invites accept), so
// the credential they first sign in with is one an admin can read. The backend
// stamps `app_metadata.password_set = true` only in POST /auth/set-password,
// and surfaces it as `password_set` on /auth/me — so a false here means
// "still on the issued temp password".
//
// Deliberately checks for an explicit `false`: an older/degraded /auth/me
// payload that omits the field must NOT lock anybody out of their portal.
export function needsPasswordSetup(user) {
  return user?.password_set === false;
}
