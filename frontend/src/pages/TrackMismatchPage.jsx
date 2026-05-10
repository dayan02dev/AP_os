// TrackMismatchPage — shown when an authed user navigates to a track
// they aren't enrolled in (e.g. a SIP user opening /apply, or a TIR
// user opening /apply-sip).
//
// Standalone page (no wizard chrome), per the locked spec.

import { Link } from "react-router-dom";
import { usePageTheme } from "../hooks/usePageTheme.jsx";

export default function TrackMismatchPage({ enrolledTrack, attemptedTrack }) {
  usePageTheme(enrolledTrack === "sip");
  const enrolledLabel = enrolledTrack === "sip" ? "SIP" : "TIR";
  const attemptedLabel = attemptedTrack === "sip" ? "SIP" : "TIR";
  const otherHref = enrolledTrack === "sip" ? "/apply-sip" : "/apply";
  const otherCta =
    enrolledTrack === "sip"
      ? "Back to your SIP application"
      : "Back to your TIR application";
  const accentClass = enrolledTrack === "sip" ? "track-sip" : "";

  return (
    <div className={`eir-root ${accentClass}`}>
      <div className="eir-bg" />
      <div className="eir-frame">
        <main className="eir-main">
          <div className="eir-screen">
            <div className="eir-coord eir-mono">
              <span>ARTPARK · {enrolledLabel}.2026</span>
              <span>track mismatch</span>
            </div>
            <div className="eir-welcome-body">
              <h1
                className="eir-welcome-title"
                style={{ maxWidth: "26ch" }}
              >
                You're enrolled in the {enrolledLabel} program.
              </h1>
              <p className="eir-welcome-lede" style={{ maxWidth: "58ch" }}>
                This page is for {attemptedLabel} applicants. Each ARTPARK
                account is locked to a single track — to switch programs,
                please contact support at{" "}
                <a
                  href="mailto:connect@artpark.in"
                  style={{ color: "var(--accent)" }}
                >
                  connect@artpark.in
                </a>
                .
              </p>
              <div className="eir-q-actions" style={{ flexWrap: "wrap" }}>
                <Link
                  to={otherHref}
                  className="eir-btn eir-btn-primary"
                  style={{ textDecoration: "none" }}
                >
                  <span>{otherCta}</span>
                </Link>
                <Link
                  to="/"
                  className="eir-btn eir-btn-ghost"
                  style={{ textDecoration: "none" }}
                >
                  <span>← Back to programs</span>
                </Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
