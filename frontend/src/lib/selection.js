// "Selected startup" — the single definition shared by the admin Accepted tab
// badge and the leadership "Selected startups" filter.
//
// This round had no jury: admins shortlisted (status `jury_review`), the
// startups were interviewed, and the admin approved the IC memo on the
// Accepted tab. An application is SELECTED when:
//   - its status is `jury_review` (a Final-round reject moves it to `rejected`), and
//   - its current IC memo is approved (signed).
//
// IC documents are keyed by the NATIVE track (where the row lives), never the
// effective/display track — pass the native one.

export const selectionKey = (nativeTrack, id) => `${nativeTrack}:${id}`;

// `documents` is the raw list from GET /admin/platform/ic-documents.
export function signedDocKeys(documents) {
  const out = new Set();
  for (const d of documents || []) {
    if (d && d.application_id && d.signed) out.add(selectionKey(d.track, d.application_id));
  }
  return out;
}

export function isSelected({ status, nativeTrack, id, gate2Decision } = {}, signedKeys) {
  if (!id || !nativeTrack || !signedKeys) return false;
  if ((gate2Decision || "") === "rejected") return false;
  if (status && status !== "jury_review") return false;
  return signedKeys.has(selectionKey(nativeTrack, id));
}
