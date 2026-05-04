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
//   /apply/<section>       TIR wizard sections (gated; SIP-enrolled users see TrackMismatchPage)
//   /apply-sip/<section>   SIP wizard sections (gated; TIR-enrolled users see TrackMismatchPage)
//   /apply/profile         profile settings
//   /apply/review          pre-submission review
//   /apply/submitted       post-submit receipt
//   /apply/set-password    first-time password setup / reset

import { Route, Routes } from "react-router-dom";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";
import SetPasswordPage from "./pages/SetPasswordPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import SipAppRoute from "./pages/SipAppRoute.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import TirAppGate from "./pages/TirAppGate.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";

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

      {/* /apply itself is public — unauthed users see the welcome screen */}
      <Route path="/apply" element={<TirAppGate />} />
      <Route path="/apply-sip" element={<SipAppRoute />} />

      {/* Protected TIR wizard routes */}
      {SECTION_SLUGS.map((slug) => (
        <Route
          key={`tir-${slug}`}
          path={`/apply/${slug}`}
          element={
            <ProtectedRoute>
              <TirAppGate />
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply/profile"
        element={
          <ProtectedRoute>
            <TirAppGate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/review"
        element={
          <ProtectedRoute>
            <TirAppGate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/submitted"
        element={
          <ProtectedRoute>
            <TirAppGate />
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply/template"
        element={
          <ProtectedRoute>
            <TirAppGate />
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
              <SipAppRoute />
            </ProtectedRoute>
          }
        />
      ))}
      <Route
        path="/apply-sip/profile"
        element={
          <ProtectedRoute>
            <SipAppRoute />
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/review"
        element={
          <ProtectedRoute>
            <SipAppRoute />
          </ProtectedRoute>
        }
      />
      <Route
        path="/apply-sip/submitted"
        element={
          <ProtectedRoute>
            <SipAppRoute />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
