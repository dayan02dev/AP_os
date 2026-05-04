// RootRedirect — fallback for /, /tir, /sip when the SPA is reached
// directly (e.g. local dev where Vite has no rewrite layer). In prod,
// vercel.json rewrites these paths to the corresponding static HTML
// before the SPA ever loads, so this component is unreachable.
//
// We can't use react-router's <Navigate> because the targets are static
// HTML files outside the SPA's route tree — `window.location.replace`
// triggers a real navigation that picks up the static file.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const STATIC_TARGET = {
  "/": "/programs.html",
  "/tir": "/marketing.html",
  "/sip": "/sip-marketing.html",
};

export default function RootRedirect() {
  const { pathname } = useLocation();
  useEffect(() => {
    const target = STATIC_TARGET[pathname] || "/programs.html";
    window.location.replace(target);
  }, [pathname]);
  return null;
}
