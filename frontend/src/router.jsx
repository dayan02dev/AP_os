// Route tree. BrowserRouter is mounted in main.jsx so hooks like useNavigate
// work in the providers above this component.
//
// Public routes (no auth required):
//   /                      Programs landing (React)
//   /sip                   SIP marketing page (React)
//   /tir                   TIR marketing — static (vercel.json rewrite to /marketing.html)
//   /apply                 TIR welcome screen
//   /apply-sip             SIP welcome screen
//   /apply/signin          email + password (existing users)
//   /apply/signup          email-only signup → OTP → set-password (track via ?track=)
//   /apply-sip/signup      ditto, default ?track=sip
//   /apply/verify          6-digit OTP entry
//   /apply/support         support ticket form (anon-friendly)
//
// Protected (redirect to /apply/signin?next=<path> if unauthed):
//   /apply/<section>       TIR wizard sections — open to any authed user
//   /apply-sip/<section>   SIP wizard sections — open to any authed user
//   /apply-sip/fit-check   SIP early-exit screen for pre-incorporation answers
//   /apply-sip/sip-template offline .docx template upload (between section 01 and 02)
//   /apply/profile         profile settings
//   /apply/review          pre-submission review
//   /apply/submitted       post-submit receipt
//   /apply/set-password    first-time password setup / reset

import { Route, Routes, Navigate } from "react-router-dom";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import SipAppRoute from "./pages/SipAppRoute.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import MentorRespondForm from "./pages/MentorRespondForm.jsx";
import JuryRespondForm from "./pages/JuryRespondForm.jsx";
import ProfileCompletionPage from "./pages/ProfileCompletionPage.jsx";
import TirAppGate from "./pages/TirAppGate.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import UserListPage from "./pages/admin/UserListPage.jsx";
import UserDetailPage from "./pages/admin/UserDetailPage.jsx";
import AdminAddUser from "./pages/admin/AdminAddUser.jsx";
import ReviewerPortal from "./pages/reviewer/v2/ReviewerPortal.jsx";
import JuryPortal from "./pages/jury/JuryPortal.jsx";
import FounderPortal from "./pages/founder/FounderPortal.jsx";
import AdminPortal from "./pages/admin/platform/AdminPortal.jsx";
import LeadershipDashboard from "./pages/leadership/LeadershipDashboard.jsx";
import ReviewApplicationPage from "./pages/leadership/ReviewApplicationPage.jsx";
import { useAuth } from "./hooks/useAuth.jsx";
import { isApplyHiddenFor, landingPathFor } from "./lib/landing.js";
import { hasCapability } from "./lib/rbac.js";

// Capability gate for /leadership. ProtectedRoute already enforces auth;
// this layer enforces the `view_stats` capability (leadership role).
function LeadershipRoute() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "view_stats")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — leadership role required</h1>
        <p>
          You need the <code>leadership</code> role to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <LeadershipDashboard />;
}

// Capability gate for the per-application review surface. Same shape as
// LeadershipRoute but checks `view_app_detail` — granted to leadership AND
// admin per backend rbac.ROLE_CAPABILITIES.
function LeadershipReviewRoute() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "view_app_detail")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — leadership or admin role required</h1>
        <p>
          You need the <code>view_app_detail</code> capability to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <ReviewApplicationPage />;
}

// Bounces leadership and admins away from the applicant wizard. Unauthed
// visitors and applicant/reviewer/mentor accounts fall through to the
// wizard's existing welcome / returning-user flow. Priority matches
// landingPathFor() so SignInPage/VerifyPage and the gate stay in sync.
// While auth is still resolving we render a stub instead of <App /> so
// a leadership account never sees the wizard flash before the redirect.
function ApplyRoleGate({ children }) {
  const { user, isAuthed, loading } = useAuth();
  if (loading) {
    return (
      <div className="eir-root">
        <div className="eir-bg" />
        <div className="eir-frame">
          <main className="eir-main">
            <div className="eir-screen">
              <div className="eir-welcome-body">
                <p className="eir-mono eir-dim">checking your session…</p>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }
  if (!isAuthed) return children;
  const roles = user?.roles || [];
  if (isApplyHiddenFor(roles)) {
    return <Navigate to={landingPathFor(roles)} replace />;
  }
  return children;
}

// Capability gate for /admin. ProtectedRoute already enforces auth;
// this layer enforces the `manage_users` capability (admin role).
function AdminRoute() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "manage_users")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — admin role required</h1>
        <p>
          You need the <code>manage_users</code> capability to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <AdminLayout />;
}

// Capability gate for the Admin Platform portal (/admin/*).
// ProtectedRoute enforces auth; this layer enforces an admin platform
// capability. `view_all_apps` is granted to both admin and leadership per
// rbac.ROLE_CAPABILITIES — the per-action backend gates remain authoritative.
// AdminPortal now owns all tab + detail state internally (no tab prop needed).
function AdminPlatformRoute() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "view_all_apps")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — admin role required</h1>
        <p>
          You need the <code>view_all_apps</code> capability to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <AdminPortal />;
}

// Capability gate for /reviewer/*. ProtectedRoute enforces auth; this layer
// enforces `view_assigned_apps` (reviewer role). Mirrors LeadershipRoute.
function ReviewerRoute({ tab }) {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "view_assigned_apps")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — reviewer role required</h1>
        <p>
          You need the <code>reviewer</code> role to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <ReviewerPortal tab={tab} />;
}

// Capability gate for /jury/*. ProtectedRoute enforces auth; this layer
// enforces `view_assigned_jury_apps` (jury role). Mirrors ReviewerRoute.
function JuryRoute({ tab }) {
  const { user } = useAuth();
  const roles = user?.roles || [];
  if (!hasCapability(roles, "view_assigned_jury_apps")) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1>Access denied — jury role required</h1>
        <p>
          You need the <code>jury</code> role to view this page.
        </p>
        <p>
          Your roles: <code>{roles.join(", ") || "(none)"}</code>
        </p>
      </div>
    );
  }
  return <JuryPortal tab={tab} />;
}

// Gate for /founder/*. Auth-only — the server `/founder/me` 403 is the real
// gate, handled inside FounderPortal (shows the "unlocks once selected"
// message rather than a hard access-denied page).
function FounderRoute({ tab }) {
  return (
    <ProtectedRoute>
      <FounderPortal tab={tab} />
    </ProtectedRoute>
  );
}

const SECTION_SLUGS = [
  "basic",
  "problem",
  "solution",
  "execution",
  "evidence",
  "declaration",
];

export default function AppRoutes() {
  return (
    <Routes>
      {/* /, /tir, /sip are served by vercel.json rewrites pointing at
          static HTML — the SPA never sees those paths in production.
          We deliberately don't add SPA routes for them: a previous
          attempt to do that with window.location.replace caused an
          infinite redirect loop against the /programs.html → /
          permanent redirect (browser bounced between the two forever).
          NotFoundPage handles them gracefully in `vite dev`. */}

      {/* Public auth + support pages */}
      <Route path="/apply/signin" element={<SignInPage />} />
      <Route path="/apply/signup" element={<SignUpPage />} />
      <Route path="/apply-sip/signup" element={<SignUpPage />} />
      <Route path="/apply/verify" element={<VerifyPage />} />
      <Route path="/apply/support" element={<SupportPage />} />
      <Route path="/mentors/respond/:token" element={<MentorRespondForm />} />
      <Route path="/jury/respond/:token" element={<JuryRespondForm />} />
      <Route path="/apply/profile-completion/:token" element={<ProfileCompletionPage />} />

      {/* /apply itself is public — unauthed users see the welcome screen.
          ApplyRoleGate bounces signed-in admin/leadership accounts to their
          own dashboards instead of the applicant wizard. */}
      <Route path="/apply" element={<ApplyRoleGate><TirAppGate /></ApplyRoleGate>} />
      <Route path="/apply-sip" element={<ApplyRoleGate><SipAppRoute /></ApplyRoleGate>} />

      {/* Protected TIR wizard routes */}
      {SECTION_SLUGS.map((slug) => (
        <Route
          key={`tir-${slug}`}
          path={`/apply/${slug}`}
          element={
            <ProtectedRoute>
              <ApplyRoleGate><TirAppGate /></ApplyRoleGate>
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply/profile"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><TirAppGate /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/review"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><TirAppGate /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/submitted"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><TirAppGate /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/template"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><TirAppGate /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/set-password"
        element={
          <ProtectedRoute>
            <SetPasswordPage />
          </ProtectedRoute>
        }
      />

      {/* Protected SIP wizard routes */}
      {SECTION_SLUGS.map((slug) => (
        <Route
          key={`sip-${slug}`}
          path={`/apply-sip/${slug}`}
          element={
            <ProtectedRoute>
              <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply-sip/profile"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/review"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/submitted"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/fit-check"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/sip-template"
        element={
          <ProtectedRoute>
            <ApplyRoleGate><SipAppRoute /></ApplyRoleGate>
          </ProtectedRoute>
        }
      />

      {/* Founder Portal (post-onboarding). Auth-gated only — FounderRoute
          wraps ProtectedRoute internally; the server `/founder/me` 403 is the
          real access gate, shown inside FounderPortal. Deep-linkable:
          /founder (application) · mou · approach · org · expense · dashboard. */}
      <Route path="/founder" element={<FounderRoute tab="application" />} />
      <Route path="/founder/mou" element={<FounderRoute tab="mou" />} />
      <Route path="/founder/approach" element={<FounderRoute tab="approach" />} />
      <Route path="/founder/org" element={<FounderRoute tab="org" />} />
      <Route path="/founder/expense" element={<FounderRoute tab="expense" />} />
      <Route path="/founder/dashboard" element={<FounderRoute tab="dashboard" />} />

      {/* Legacy admin user-management shell (Session 3). Gated to `manage_users`.
          Kept intact under /admin/users* so user CRUD is unaffected.
          MUST come before the /admin/* catch-all so it matches first. */}
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <AdminRoute />
          </ProtectedRoute>
        }
      >
        <Route index element={<UserListPage />} />
        <Route path="new" element={<AdminAddUser />} />
        <Route path=":id" element={<UserDetailPage />} />
      </Route>

      {/* Admin Platform portal. Capability-gated to `view_all_apps`.
          AdminPortal owns all tab + detail navigation internally via page-state
          (no longer route-based). A single catch-all `/admin/*` covers the
          dashboard and every sub-page so bookmarked /admin URLs still land here.
          The legacy /admin/users* routes above take priority. */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute>
            <AdminPlatformRoute />
          </ProtectedRoute>
        }
      />

      {/* Reviewer Portal v2 (2026-06-12). Capability-gated to
          `view_assigned_apps`; the eval screen also needs `score_app` (the
          backend enforces both — this layer is the UX gate). Deep-linkable:
          dashboard / queue / eval/:track/:appId / history. */}
      <Route
        path="/reviewer"
        element={
          <ProtectedRoute>
            <ReviewerRoute tab="dashboard" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reviewer/queue"
        element={
          <ProtectedRoute>
            <ReviewerRoute tab="queue" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reviewer/eval/:track/:appId"
        element={
          <ProtectedRoute>
            <ReviewerRoute tab="eval" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reviewer/history"
        element={
          <ProtectedRoute>
            <ReviewerRoute tab="history" />
          </ProtectedRoute>
        }
      />

      {/* Jury Portal v2 (pick-3, read-only). Capability-gated to
          `view_assigned_jury_apps`. Deep-linkable: My Applications
          (/jury, /jury/queue) · My Picks (/jury/picks) · read-only detail
          (/jury/eval/:track/:appId). No scoring surface anywhere. */}
      <Route
        path="/jury"
        element={
          <ProtectedRoute>
            <JuryRoute tab="queue" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jury/queue"
        element={
          <ProtectedRoute>
            <JuryRoute tab="queue" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jury/picks"
        element={
          <ProtectedRoute>
            <JuryRoute tab="picks" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jury/eval/:track/:appId"
        element={
          <ProtectedRoute>
            <JuryRoute tab="eval" />
          </ProtectedRoute>
        }
      />

      {/* Leadership dashboard (Session 5). Capability-gated to `view_stats`. */}
      <Route
        path="/leadership"
        element={
          <ProtectedRoute>
            <LeadershipRoute />
          </ProtectedRoute>
        }
      />

      {/* Per-application review surface — full-page deep dive launched from
          the leadership dashboard's drawer "Review application" button. */}
      <Route
        path="/leadership/applications/:track/:id/review"
        element={
          <ProtectedRoute>
            <LeadershipReviewRoute />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
