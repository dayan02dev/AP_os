// useAuth — React context for the authenticated user.
//
// On mount, if a session exists in localStorage, rehydrates by calling
// GET /auth/me. Listens for 'auth:expired' events (fired by session.clear
// or a failed refresh in api.js) and resets user → null.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as auth from "../lib/auth.js";
import { loadSession } from "../lib/session.js";
import { clearStickyState } from "./useStickyState.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Rehydrate on mount if we have a token.
  useEffect(() => {
    let cancelled = false;
    async function rehydrate() {
      if (!loadSession()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await auth.getMe();
        if (!cancelled) setUser(me);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for session expiry → wipe user.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const requestOtp = useCallback(async (email, track) => {
    setError(null);
    return auth.requestOtp(email, track);
  }, []);

  // After token save, immediately fetch /auth/me so the user state holds the
  // full UserMe shape (roles + active_role + profile fields). The basic
  // {id, email} from the token response is enough for "signed in?" but not
  // for role-aware redirects — SignInPage reads roles off the resolved
  // user to decide where to navigate.
  const verifyOtp = useCallback(async (email, token) => {
    setError(null);
    await auth.verifyOtp(email, token);
    const me = await auth.getMe();
    setUser(me);
    return me;
  }, []);

  const signInWithPassword = useCallback(async (email, password) => {
    setError(null);
    await auth.signInWithPassword(email, password);
    const me = await auth.getMe();
    setUser(me);
    return me;
  }, []);

  const setPassword = useCallback(async (password) => {
    setError(null);
    await auth.setPassword(password);
    // Refresh /me so the password_set flag updates immediately — callers
    // that route based on it (e.g. SetPasswordPage redirecting to /apply)
    // shouldn't see a stale `false` for the rest of the session.
    try {
      const me = await auth.getMe();
      setUser(me);
    } catch (err) {
      setError(err);
    }
  }, []);

  const signOut = useCallback(async () => {
    await auth.logout();
    // Portal filters persist per browser tab; staff share machines, so the next
    // person to sign in here must not inherit the previous user's filtered view.
    clearStickyState();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthed: !!user,
    requestOtp,
    verifyOtp,
    signInWithPassword,
    setPassword,
    logout: signOut,
    refreshMe: async () => {
      try {
        const me = await auth.getMe();
        setUser(me);
        return me;
      } catch (err) {
        setError(err);
        return null;
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
