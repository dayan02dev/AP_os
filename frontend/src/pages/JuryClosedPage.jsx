// Static stand-in for every /jury route (and the public /jury/respond/:token
// invite link) while JURY_PORTAL_ENABLED is false — the 2026 round had no
// jury. Deliberately makes NO API calls and never redirects, so a stale jury
// link or a jury-only account can't trigger a 4xx/CORS error or a loop.
import { Link } from "react-router-dom";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function JuryClosedPage() {
  usePageTheme(false);
  return (
    <div className="eir-root">
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen">
            <div className="eir-coord eir-mono">
              <span>ARTPARK / TIR.2026</span>
              <span>jury · closed</span>
            </div>
            <div className="eir-welcome-body">
              <h1 className="eir-welcome-title">The jury portal is closed for this round.</h1>
              <p className="eir-welcome-lede">
                There is no jury review this cycle — shortlisted applications were
                interviewed and decided by the ARTPARK team directly. No action is
                needed from you.
              </p>
              <Link to="/" className="eir-btn eir-btn-primary">
                <span>Back to home</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
