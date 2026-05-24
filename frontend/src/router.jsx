// Route tree. BrowserRouter is mounted in main.jsx so hooks like useNavigate
// work in the providers above this component.
//
// Public routes (no auth required):
//   /                      static marketing (via RootRedirect)
//   /apply                 welcome screen; Begin button routes to signin
//   /apply/signin          email + password (existing users)
//   /apply/signup          email-only signup → OTP → set-password
//   /apply/verify          6-digit OTP entry
//   /apply/support         support ticket form (anon-friendly)
//
// Protected (redirect to /apply/signin?next=<path> if unauthed):
//   /apply/basic, /apply/problem, /apply/solution, /apply/execution,
//   /apply/evidence, /apply/declaration   wizard sections
//   /apply/profile          profile settings
//   /apply/review           pre-submission review
//   /apply/submitted        post-submit receipt
//   /apply/set-password     first-time password setup / reset (Phase B)

import { Route, Routes, Navigate } from "react-router-dom";
import App from "./App.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";
import RootRedirect from "./pages/RootRedirect.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import UserListPage from "./pages/admin/UserListPage.jsx";
import UserDetailPage from "./pages/admin/UserDetailPage.jsx";
import AdminAddUser from "./pages/admin/AdminAddUser.jsx";
import ReviewerAppShell from "./pages/reviewer/ReviewerAppShell.jsx";
import ReviewerInboxPage from "./pages/reviewer/ReviewerInboxPage.jsx";
import ReviewerCompletedPage from "./pages/reviewer/ReviewerCompletedPage.jsx";
import ReviewerScoringPage from "./pages/reviewer/ReviewerScoringPage.jsx";
import LeadershipDashboard from "./pages/leadership/LeadershipDashboard.jsx";
import ReviewApplicationPage from "./pages/leadership/ReviewApplicationPage.jsx";
import { useAuth } from "./hooks/useAuth.jsx";
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
// wizard's existing welcome / returning-user flow. Leadership wins over
// admin to match SignInPage's post-signin priority — admins reach /admin
// via the Switch button inside the leadership dashboard.
function ApplyRoleGate({ children }) {
  const { user, isAuthed, loading } = useAuth();
  if (loading || !isAuthed) return children;
  const roles = user?.roles || [];
  if (roles.includes("leadership")) return <Navigate to="/leadership" replace />;
  if (roles.includes("admin")) return <Navigate to="/admin" replace />;
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
      {/* Root → static marketing HTML */}
      <Route path="/" element={<RootRedirect />} />

      {/* Public auth + support pages */}
      <Route path="/apply/signin" element={<SignInPage />} />
      <Route path="/apply/signup" element={<SignUpPage />} />
      <Route path="/apply/verify" element={<VerifyPage />} />
      <Route path="/apply/support" element={<SupportPage />} />

      {/* /apply itself is public — unauthed users see the welcome screen.
          ApplyRoleGate bounces signed-in admin/leadership accounts to their
          own dashboards instead of the applicant wizard. */}
      <Route path="/apply" element={<ApplyRoleGate><App /></ApplyRoleGate>} />

      {/* Protected wizard routes */}
      {SECTION_SLUGS.map((slug) => (
        <Route
          key={slug}
          path={`/apply/${slug}`}
          element={
            <ProtectedRoute>
              <ApplyRoleGate><App /></ApplyRoleGate>
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply/profile"
        element={<ProtectedRoute><ApplyRoleGate><App /></ApplyRoleGate></ProtectedRoute>}
      />
      <Route
        path="/apply/review"
        element={<ProtectedRoute><ApplyRoleGate><App /></ApplyRoleGate></ProtectedRoute>}
      />
      <Route
        path="/apply/submitted"
        element={<ProtectedRoute><ApplyRoleGate><App /></ApplyRoleGate></ProtectedRoute>}
      />
      {/* Optional offline-template upload step that sits between section
          01 (basic) and section 02 (problem). PHASES.TEMPLATE_UPLOAD
          serialises to this path via urlForState in App.jsx. */}
      <Route
        path="/apply/template"
        element={<ProtectedRoute><ApplyRoleGate><App /></ApplyRoleGate></ProtectedRoute>}
      />
      <Route
        path="/apply/set-password"
        element={<ProtectedRoute><SetPasswordPage /></ProtectedRoute>}
      />

      {/* Admin shell (Session 3). Capability-gated to `manage_users`. */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminRoute />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="users" replace />} />
        <Route path="dashboard" element={<Navigate to="../users" replace />} />
        <Route path="users" element={<UserListPage />} />
        <Route path="users/new" element={<AdminAddUser />} />
        <Route path="users/:id" element={<UserDetailPage />} />
      </Route>

      {/* Reviewer surface (Phase 1.5). */}
      <Route
        element={
          <ProtectedRoute>
            <ReviewerAppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/reviewer" element={<Navigate to="/reviewer/inbox" replace />} />
        <Route path="/reviewer/inbox" element={<ReviewerInboxPage />} />
        <Route path="/reviewer/completed" element={<ReviewerCompletedPage />} />
      </Route>
      <Route
        path="/reviewer/:track/:id/score"
        element={
          <ProtectedRoute>
            <ReviewerScoringPage />
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
