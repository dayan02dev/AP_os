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
import ReviewerInboxStub from "./pages/reviewer/ReviewerInboxStub.jsx";
import LeadershipDashboard from "./pages/leadership/LeadershipDashboard.jsx";
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

      {/* /apply itself is public — unauthed users see the welcome screen */}
      <Route path="/apply" element={<App />} />

      {/* Protected wizard routes */}
      {SECTION_SLUGS.map((slug) => (
        <Route
          key={slug}
          path={`/apply/${slug}`}
          element={
            <ProtectedRoute>
              <App />
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply/profile"
        element={<ProtectedRoute><App /></ProtectedRoute>}
      />
      <Route
        path="/apply/review"
        element={<ProtectedRoute><App /></ProtectedRoute>}
      />
      <Route
        path="/apply/submitted"
        element={<ProtectedRoute><App /></ProtectedRoute>}
      />
      {/* Optional offline-template upload step that sits between section
          01 (basic) and section 02 (problem). PHASES.TEMPLATE_UPLOAD
          serialises to this path via urlForState in App.jsx. */}
      <Route
        path="/apply/template"
        element={<ProtectedRoute><App /></ProtectedRoute>}
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

      {/* Reviewer surface (Phase 1 stub; scoring UI ships in Phase 1.5). */}
      <Route
        path="/reviewer/inbox"
        element={
          <ProtectedRoute>
            <ReviewerInboxStub />
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

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
