// IdleLogout — watches for user activity; after IDLE_MS with no input,
// signs the user out and redirects to /apply/signin. Only active when
// a session exists.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";

const IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVITY_EVENTS = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"];

export default function IdleLogout() {
  const { isAuthed, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthed) return undefined;
    let lastActivity = Date.now();
    let timer = null;

    const check = () => {
      if (Date.now() - lastActivity >= IDLE_MS) {
        logout();
        navigate("/apply/signin", { replace: true });
        return;
      }
      timer = setTimeout(check, 60_000);
    };

    const onActivity = () => {
      lastActivity = Date.now();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    timer = setTimeout(check, 60_000);

    return () => {
      if (timer) clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [isAuthed, logout, navigate]);

  return null;
}
