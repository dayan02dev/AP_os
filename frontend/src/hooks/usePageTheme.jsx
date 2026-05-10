// Shared theme initialization for standalone pages (sign-in, sign-up, verify, etc.)
// that render outside App/AppSip and need to apply the correct theme.

import { useEffect } from "react";
import { THEMES } from "../themes.jsx";

const SIP_ACCENT_VARS = {
  "--accent": "#6B5CFF",
  "--accent-deep": "#4a3dd6",
  "--accent-soft": "#ece9ff",
};

export function usePageTheme(isSip = false) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = THEMES.minimal;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    if (isSip) {
      Object.entries(SIP_ACCENT_VARS).forEach(([k, v]) => root.style.setProperty(k, v));
    }
    root.setAttribute("data-bg", theme.bg || "none");
    root.setAttribute("data-theme", theme.key);
    return () => {
      Object.keys(theme.vars).forEach((k) => root.style.removeProperty(k));
      if (isSip) {
        Object.keys(SIP_ACCENT_VARS).forEach((k) => root.style.removeProperty(k));
      }
    };
  }, [isSip]);
}
