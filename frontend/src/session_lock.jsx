// Single-editor session lock for team applications
// Only one person at a time can edit the shared application.
// Uses localStorage + the 'storage' event so multiple tabs/users coordinate.

import { useState as useSL, useEffect as useSLE, useRef as useSLR } from "react";

const ACTIVE_KEY = "tir:activeSession";
const HEARTBEAT_MS = 8000;
const STALE_AFTER_MS = 25000; // if no heartbeat in 25s, session considered abandoned
const SHARED_APP_OWNER_KEY = "tir:sharedAppOwner"; // which email "owns" the shared application

function generateSessionId() {
  return "s_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
}

function readActiveSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.ts) return null;
    // Treat stale sessions as inactive
    if (Date.now() - s.ts > STALE_AFTER_MS) return null;
    return s;
  } catch { return null; }
}

function writeActiveSession(session) {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...session, ts: Date.now() }));
  } catch {}
}

function clearActiveSession(sessionId) {
  // Only clear if we own it
  const cur = readActiveSession();
  if (cur && cur.sessionId === sessionId) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

/*
  useSessionLock:
    - sharedAppEmails: array of emails that all share the same application (the founder + teammates)
    - currentUser: { email, name }
    - active: whether we should be attempting to hold the lock (true while user is in the form)

  Returns:
    - state: "idle" | "pending-takeover" | "active" | "kicked"
    - activeSession: the currently-live session info (if another user has the lock)
    - takeLock(): claim the lock for us (boots anyone else)
    - releaseLock(): give it up
*/
function useSessionLock({ sharedAppEmails, currentUser, active }) {
  const [state, setState] = useSL("idle");
  const [activeSession, setActiveSession] = useSL(null);
  const sessionIdRef = useSLR(null);
  const heartbeatRef = useSLR(null);

  if (!sessionIdRef.current) sessionIdRef.current = generateSessionId();
  const sessionId = sessionIdRef.current;

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      // Only continue heartbeat if we still own the lock
      const cur = readActiveSession();
      if (cur && cur.sessionId !== sessionId) {
        stopHeartbeat();
        setState("kicked");
        setActiveSession(cur);
        return;
      }
      writeActiveSession({
        sessionId,
        email: currentUser?.email,
        name: currentUser?.name || (currentUser?.email || "").split("@")[0],
      });
    }, HEARTBEAT_MS);
  };

  const takeLock = () => {
    writeActiveSession({
      sessionId,
      email: currentUser?.email,
      name: currentUser?.name || (currentUser?.email || "").split("@")[0],
    });
    startHeartbeat();
    setState("active");
    setActiveSession(null);
  };

  const releaseLock = () => {
    stopHeartbeat();
    clearActiveSession(sessionId);
    setState("idle");
  };

  // Check for existing lock when activating
  useSLE(() => {
    if (!active || !currentUser?.email) {
      stopHeartbeat();
      return;
    }
    const existing = readActiveSession();
    if (!existing) {
      takeLock();
      return;
    }
    // We already own it?
    if (existing.sessionId === sessionId) {
      startHeartbeat();
      setState("active");
      return;
    }
    // Someone else has it — but is it one of our shared-app team?
    const shared = Array.isArray(sharedAppEmails) ? sharedAppEmails : [];
    if (shared.includes(existing.email) || existing.email === currentUser.email) {
      setActiveSession(existing);
      setState("pending-takeover");
      return;
    }
    // Not a teammate — just take it (shouldn't happen in our demo, but safe)
    takeLock();
  }, [active, currentUser?.email]);

  // Listen for storage events (another tab/user changed the active session)
  useSLE(() => {
    const onStorage = (e) => {
      if (e.key !== ACTIVE_KEY) return;
      const next = readActiveSession();
      if (!next) {
        // Someone released the lock
        if (state === "pending-takeover") setActiveSession(null);
        return;
      }
      if (next.sessionId !== sessionId) {
        // Another session took over — we get kicked if we were active
        if (state === "active") {
          stopHeartbeat();
          setActiveSession(next);
          setState("kicked");
        } else if (state === "pending-takeover") {
          setActiveSession(next);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [state, sessionId]);

  // Release on unmount
  useSLE(() => {
    return () => {
      stopHeartbeat();
      clearActiveSession(sessionId);
    };
  }, []);

  return { state, activeSession, takeLock, releaseLock, sessionId };
}

// ===== Presentation components =====

function TakeoverPrompt({ activeSession, currentUser, onTakeOver, onWait }) {
  if (!activeSession) return null;
  const whoName = activeSession.name || (activeSession.email || "").split("@")[0];
  const whoEmail = activeSession.email || "unknown";
  const secondsAgo = Math.max(1, Math.round((Date.now() - (activeSession.ts || Date.now())) / 1000));
  const isSelf = activeSession.email === currentUser?.email;

  return (
    <div className="eir-takeover-backdrop">
      <div className="eir-takeover-modal">
        <div className="eir-takeover-eyebrow">
          {isSelf ? "⦿ another device is active" : "⦿ a teammate is editing"}
        </div>
        <h2 className="eir-takeover-title">
          {isSelf
            ? "You're already signed in somewhere else."
            : `${whoName} is working on the application right now.`}
        </h2>
        <div className="eir-takeover-body">
          {isSelf
            ? "To keep your progress safe, only one session can edit at a time. Taking over will sign out your other session."
            : "To prevent conflicting edits, only one teammate can edit at a time. You can wait for them to finish, or take over — this will sign them out."}
        </div>
        <div className="eir-takeover-who">
          <div>↳ active: <strong>{whoEmail}</strong></div>
          <div>↳ last heartbeat: {secondsAgo}s ago</div>
        </div>
        <div className="eir-takeover-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onWait}>
            <span>Wait &amp; watch</span>
          </button>
          <button className="eir-btn eir-btn-primary" onClick={onTakeOver}>
            <span>Take over editing</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function KickedScreen({ kickedBy, onSignOut, onReclaim }) {
  const whoName = kickedBy?.name || (kickedBy?.email || "a teammate");
  const whoEmail = kickedBy?.email || "";
  return (
    <div className="eir-screen">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>session · ended</span>
      </div>
      <div className="eir-lock-screen">
        <div className="eir-lock-icon eir-mono">◉ → ◯</div>
        <h1 className="eir-lock-title">
          <em>{whoName}</em> took over editing.
        </h1>
        <p className="eir-lock-lede">
          Only one teammate can edit the application at a time. Your session was signed out so
          their edits don't conflict with yours. All progress has been saved.
        </p>
        <div className="eir-lock-meta eir-mono">
          {whoEmail && <div>↳ active editor: {whoEmail}</div>}
          <div>↳ your work up to this point is saved</div>
        </div>
        <div className="eir-lock-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onSignOut}>
            <span>Sign out</span>
          </button>
          <button className="eir-btn eir-btn-primary" onClick={onReclaim}>
            <span>Reclaim editing</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionLockBanner({ currentUser, sharedAppEmails }) {
  if (!sharedAppEmails || sharedAppEmails.length < 2) return null;
  const whoName = currentUser?.name || (currentUser?.email || "").split("@")[0];
  return (
    <div className="eir-lock-banner">
      <div className="eir-lock-banner-left">
        <span className="eir-lock-banner-dot" />
        <span className="eir-lock-banner-text">
          <strong>{whoName}</strong> has editing access · shared with {sharedAppEmails.length - 1} teammate{sharedAppEmails.length > 2 ? "s" : ""}
        </span>
      </div>
      <div className="eir-lock-banner-meta">single-editor lock · active</div>
    </div>
  );
}

// Debug helper — simulate another user taking over (for demos)
function simulateTeammateTakeover(teammateEmail, teammateName) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({
    sessionId: generateSessionId(),
    email: teammateEmail || "teammate@example.com",
    name: teammateName || "Teammate",
    ts: Date.now(),
  }));
  // Dispatch synthetic storage event so the hook picks it up
  window.dispatchEvent(new StorageEvent("storage", {
    key: ACTIVE_KEY,
    newValue: localStorage.getItem(ACTIVE_KEY),
  }));
}

export {
  useSessionLock,
  TakeoverPrompt,
  KickedScreen,
  SessionLockBanner,
  simulateTeammateTakeover,
};
