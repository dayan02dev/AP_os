// Cached enrichment of an academic-roster professor's own faculty page.
//
//   GET  /admin/platform/academic-profiles?profile_url=…   cached row or null
//   POST /admin/platform/academic-profiles/enrich           fetch + extract + cache
//
// The enrich call fetches the page server-side (the browser can't — cross-origin)
// and LLM-extracts it, so it takes a few seconds and needs the longer timeout.
// Results are cached per URL, so re-opening a professor is free.

import { api } from "./api.js";

const BASE = "/admin/platform/academic-profiles";
const ENRICH_TIMEOUT_MS = 45_000;

export const academicProfilesApi = {
  get: (profileUrl) =>
    api.get(`${BASE}?profile_url=${encodeURIComponent(profileUrl)}`),

  // force=true re-fetches a page we already have, for a stale or thin result.
  enrich: (profileUrl, name, force = false) =>
    api.post(`${BASE}/enrich`, { profile_url: profileUrl, name, force },
      { timeoutMs: ENRICH_TIMEOUT_MS }),
};
