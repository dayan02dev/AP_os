// RootRedirect — visiting "/" sends the user to the static marketing page.
// Using window.location.replace (not react-router's <Navigate>) because
// marketing.html is a static HTML file outside the SPA's route tree.

import { useEffect } from "react";

export default function RootRedirect() {
  useEffect(() => {
    window.location.replace("/marketing.html");
  }, []);
  return null;
}
