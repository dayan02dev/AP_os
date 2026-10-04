// "Selected startup" — the single definition shared by the admin Accepted tab
// badge and the leadership "Selected startups" filter.
//
// This round had no jury: admins shortlisted (status `jury_review`), the
// startups were interviewed, and the admin approved the IC memo on the
// Accepted tab. An application is SELECTED when:
//   - its status is `jury_review` (a Final-round reject moves it to `rejected`), and
//   - it has >=1 current IC document and EVERY current one is approved (signed)
//     — the same multi-memo rule as AdminSelectedApplications.decisionStateOf.
//
// IC documents are keyed by the NATIVE track (where the row lives), never the
// effective/display track — pass the native one.

export const selectionKey = (nativeTrack, id) => `${nativeTrack}:${id}`;

// `documents` is the raw list from GET /admin/platform/ic-documents (current
// docs only; a superseded row that slips through is ignored). A key is in the
// set only when every current document for that app is signed.
export function signedDocKeys(documents) {
  const allSigned = new Map();
  for (const d of documents || []) {
    if (!d || !d.application_id || d.superseded_at) continue;
    const k = selectionKey(d.track, d.application_id);
    allSigned.set(k, (allSigned.has(k) ? allSigned.get(k) : true) && !!d.signed);
  }
  const out = new Set();
  for (const [k, ok] of allSigned) if (ok) out.add(k);
  return out;
}

export function isSelected({ status, nativeTrack, id, gate2Decision } = {}, signedKeys) {
  if (!id || !nativeTrack || !signedKeys) return false;
  if ((gate2Decision || "") === "rejected") return false;
  if (status && status !== "jury_review") return false;
  return signedKeys.has(selectionKey(nativeTrack, id));
}
