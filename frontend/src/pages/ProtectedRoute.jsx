// ProtectedRoute — gate for authed-only pages. Redirects to /apply/signin
// with a ?next= that preserves the intended destination.

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function ProtectedRoute({ children }) {
  const { isAuthed, loading } = useAuth();
  const location = useLocation();
  usePageTheme(location.pathname.startsWith("/apply-sip"));

  if (loading) {
    // Plain passthrough while rehydrating — a flash of loading UI is ok.
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

  if (!isAuthed) {
    const next = location.pathname + (location.search || "");
    return <Navigate to={`/apply/signin?next=${encodeURIComponent(next)}`} replace />;
  }

  return children;
}
