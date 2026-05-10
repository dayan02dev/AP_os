import { Link, useLocation } from "react-router-dom";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function NotFoundPage() {
  const location = useLocation();
  const isSip = location.pathname.startsWith("/apply-sip");
  usePageTheme(isSip);
  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / TIR.2026</span>
              <span>404 · not found</span>
            </div>
            <div className="eir-welcome-body">
              <h1 className="eir-welcome-title">Nothing here.</h1>
              <p className="eir-welcome-lede">
                That URL doesn't point anywhere on the application portal. If you followed a link to get here, it may be stale.
              </p>
              <Link to="/apply" className="eir-btn eir-btn-primary">
                <span>Back to application</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
