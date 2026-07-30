// Frontend mirror of backend/app/rbac.py ROLE_CAPABILITIES.
//
// HAND-KEEP IN SYNC. If you edit either file, edit both.
// (Phase 2 will add a CI lint that diffs the two.)
//
// The frontend uses this for:
//   - Post-signin redirect (admin shell vs applicant wizard)
//   - Conditional rendering of nav items + role chips
//   - Optimistic capability checks before calling protected APIs
//
// The backend's require_capability() is the authoritative gate;
// this is purely a UX layer.

export const ROLE_CAPABILITIES = Object.freeze({
  applicant: new Set([
    "manage_own_draft",
    "submit_app",
    "view_own_status",
  ]),
  founder: new Set([
    "view_own_milestones",
    "upload_milestone_evidence",
  ]),
  reviewer: new Set([
    "view_assigned_apps",
    "score_app",
    "comment_app",
    "decline_assignment",
  ]),
  jury: new Set(["view_assigned_jury_apps", "submit_jury_picks"]),
  mentor: new Set([
    "view_assigned_founders",
    "comment_founder",
  ]),
  leadership: new Set([
    "view_all_apps",
    "view_app_detail",
    "assign_reviewers",
    "assign_jurors",
    "change_app_status",
    "view_stats",
    "export_data",
    "view_audit_log",
    "decide_application",
    "manage_ic_documents",
  ]),
  admin: new Set([
    "manage_users",
    "grant_role",
    "revoke_role",
    "reset_password",
    "view_all_apps",
    "view_app_detail",
    "assign_reviewers",
    "assign_jurors",
    "manage_jury_roster",
    "change_app_status",
    "view_stats",
    "view_audit_log",
    "manage_support",
    "decide_application",
    "manage_batches",
    "manage_reviewers_roster",
    "manage_ic_documents",
  ]),
});

export function capabilitiesFor(roles) {
  const out = new Set();
  for (const r of roles || []) {
    const set = ROLE_CAPABILITIES[r];
    if (set) for (const c of set) out.add(c);
  }
  return out;
}

export function hasCapability(roles, cap) {
  return capabilitiesFor(roles).has(cap);
}

// Roles that land on the admin shell (i.e. /admin/dashboard) post-signin.
// Reviewers/mentors will be redirected to their own surfaces by SignInPage
// — see Task 8 for the reviewer split.
export const ADMIN_SHELL_ROLES = new Set(["leadership", "admin"]);

export function shouldRouteToAdminShell(roles) {
  return (roles || []).some((r) => ADMIN_SHELL_ROLES.has(r));
}
