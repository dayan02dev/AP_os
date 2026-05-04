// RootRedirect — visiting "/" renders the ARTPARK Programs landing page
// as a React component. Replaces the previous static programs.html
// rewrite. The static file remains in /public for now as a fallback for
// any external links that hit it directly, but vercel.json routes "/" to
// the SPA so this component is the canonical landing.

import ProgramsPage from "./ProgramsPage.jsx";

export default function RootRedirect() {
  return <ProgramsPage />;
}
