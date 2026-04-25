// RootRedirect — visiting "/" sends the user to the static programs landing.
// Using window.location.replace (not react-router's <Navigate>) because
// the landing is a static HTML file outside the SPA's route tree.
//
// In production, vercel.json rewrites "/" to "/programs.html" before the
// SPA ever loads, so this component is unreachable. It's kept for the
// local dev case (vite has no rewrite layer): hitting "/" loads the SPA,
// which then bounces here to the static programs.html. That file in turn
// links forward to "/2026" (TIR landing) and "/apply" (the wizard).

import { useEffect } from "react";

export default function RootRedirect() {
  useEffect(() => {
    window.location.replace("/programs.html");
  }, []);
  return null;
}
