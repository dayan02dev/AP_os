// Supabase client — anon-key only, used for passive helpers like realtime
// or storage signed URLs. All auth flows go through our FastAPI backend
// (via lib/auth.js) so everything benefits from server-side rate limiting,
// audit logging, and uniform error handling.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Keep this as a warning, not a throw — Vitest runs without env vars and
  // we don't want collection to fail. The module still imports fine; any
  // real use against Supabase will surface its own clear error.
  // eslint-disable-next-line no-console
  console.warn("[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set");
}

export const supabase = createClient(url || "http://localhost", anonKey || "anon-key", {
  auth: {
    persistSession: false, // our session.js owns token storage
    autoRefreshToken: false, // our api.js owns the refresh flow
  },
});
