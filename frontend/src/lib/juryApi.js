// Juror portal API (v2) — thin wrappers over lib/api.js.
//
// v2 is pick-based, not scoring-based: a juror reads their assigned queue,
// opens read-only application content, and submits a set of 1-3 picks
// (with optional notes). There is no score/comment/decline surface here —
// see rbac.js: the `jury` role only carries view_assigned_jury_apps +
// submit_jury_picks.
//
//   GET /jury/queue                                        → assigned apps
//   GET /jury/applications/{track}/{id}/content             → read-only detail
//   GET /jury/applications/{track}/{id}/files/signed-url     → resume/file download
//   GET /jury/selections/mine                                → this juror's current picks
//   PUT /jury/selections                                     → replace picks (1-3)

import { api } from "./api.js";

export const juryApi = {
  getQueue: () => api.get("/jury/queue"),

  getContent: (track, id) => api.get(`/jury/applications/${track}/${id}/content`),

  fileSignedUrl: (track, id, storagePath) =>
    api.get(
      `/jury/applications/${track}/${id}/files/signed-url` +
        `?storage_path=${encodeURIComponent(storagePath)}`,
    ),

  getMySelections: () => api.get("/jury/selections/mine"),

  // selections: [{application_id, application_track, note}] — 1 to 3 of them.
  // Set-replace semantics: the backend deletes this juror's prior picks and
  // inserts the new set atomically.
  putSelections: (selections) => api.put("/jury/selections", { selections }),
};
