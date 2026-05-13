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

import { Route, Routes } from "react-router-dom";
import App from "./App.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";
import RootRedirect from "./pages/RootRedirect.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";
import AdminDashboardStub from "./pages/admin/AdminDashboardStub.jsx";

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

      {/* Admin / leadership shell (Phase 1). Session 5 replaces the
          /admin/dashboard target with the real Leadership Dashboard. */}
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute>
            <AdminDashboardStub />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
