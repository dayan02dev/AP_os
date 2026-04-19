// useAuth — React context for the authenticated user.
//
// On mount, if a session exists in localStorage, rehydrates by calling
// GET /auth/me. Listens for 'auth:expired' events (fired by session.clear
// or a failed refresh in api.js) and resets user → null.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as auth from "../lib/auth.js";
import { loadSession } from "../lib/session.js";

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

  const requestOtp = useCallback(async (email) => {
    setError(null);
    return auth.requestOtp(email);
  }, []);

  const verifyOtp = useCallback(async (email, token) => {
    setError(null);
    const newUser = await auth.verifyOtp(email, token);
    setUser(newUser);
    return newUser;
  }, []);

  const signOut = useCallback(async () => {
    await auth.logout();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    error,
    isAuthed: !!user,
    requestOtp,
    verifyOtp,
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
