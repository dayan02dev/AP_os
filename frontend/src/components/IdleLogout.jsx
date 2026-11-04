// IdleLogout — watches for user activity; after IDLE_MS with no input,
// signs the user out and redirects to /apply/signin. Only active when
// a session exists.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";

const IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVITY_EVENTS = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"];

// Shared across tabs so an idle background tab does not sign out a user who is
// active in another tab (the session lives in shared localStorage).
const HEARTBEAT_KEY = "apos.lastActivity";
const HEARTBEAT_THROTTLE_MS = 15_000;

function readHeartbeat() {
  try {
    return Number(localStorage.getItem(HEARTBEAT_KEY)) || 0;
  } catch {
    return 0;
  }
}

export default function IdleLogout() {
  const { isAuthed, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthed) return undefined;
    let lastActivity = Date.now();
    let timer = null;
    let lastBeat = 0;

    const check = () => {
      if (Date.now() - Math.max(lastActivity, readHeartbeat()) >= IDLE_MS) {
        logout();
        navigate("/apply/signin", { replace: true });
        return;
      }
      timer = setTimeout(check, 60_000);
    };

    const onActivity = () => {
      lastActivity = Date.now();
      if (lastActivity - lastBeat >= HEARTBEAT_THROTTLE_MS) {
        lastBeat = lastActivity;
        try {
          localStorage.setItem(HEARTBEAT_KEY, String(lastActivity));
        } catch {
          /* noop */
        }
      }
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
