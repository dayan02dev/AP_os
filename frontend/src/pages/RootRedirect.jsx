// RootRedirect — visiting "/" sends the user to the static marketing page.
// Using window.location.replace (not react-router's <Navigate>) because
// the marketing page is a static HTML file outside the SPA's route tree.
// The pretty URL is "/2026"; vercel.json rewrites it to /marketing.html
// so the URL bar stays clean.

import { useEffect } from "react";

export default function RootRedirect() {
  useEffect(() => {
    window.location.replace("/2026");
  }, []);
  return null;
}
