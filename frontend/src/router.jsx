// Route tree for the application portal.
//
// We mount <App /> once under /apply/* so its state (phase, answers, user)
// persists across URL changes. App reads useLocation() internally to drive:
//   - URL → phase sync (landing on /apply/profile jumps to the profile screen)
//   - phase → URL push (Next/Prev updates the URL so back/forward works)
//   - protected-path redirects (unauthed users on /apply/profile → /apply/signin?next=…)
//   - unknown /apply/<slug> → 404
//
// The /pages/ directory contains thin per-route component stubs that are wired
// up in later phases (Phase 3 replaces SignInPage with a Supabase OTP flow, etc).
// For Phase 0 they all render <App />, so we keep a single catch-all route here.
//
// See docs/ROUTING.md for the full route table.

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { SECTIONS } from "./questions.jsx";

export const SECTION_SLUGS = SECTIONS.map((s) => s.id);

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/apply" replace />} />
        <Route path="/apply/*" element={<App />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
