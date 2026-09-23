// Admin tab-badge counts. Rejected AND shortlisted (`jury_review`) apps live in
// their own tabs, so the Applications badge excludes both.
// statusCounts entries are { id, n }. Returns nulls while loading so no
// fabricated number is shown.
import { isSelected, signedDocKeys } from "./selection";

// `juryReviewCount` — optional exact number of raw-status `jury_review` apps
// (the rows the Applications list drops via exclude_status). Prefer it: /stats
// runs overlay_admin_decisions, which moves every `jury_review` app carrying a
// shortlist decision out of the `jury_review` bucket and into `accepted`, so
// the `jury_review` bucket alone reads ~0. Without it we fall back to
// `jury_review + accepted`, which is the same set as far as /stats can tell.
//
// `juryBadge` is that shortlisted count (both tracks). The Accepted tab no
// longer badges it — see selectedCount below.
export function pipelineBadges(statsData, statsLoading, juryReviewCount = null) {
  if (statsLoading || statsData == null) {
    return { appsBadge: null, rejectedBadge: null, juryBadge: null };
  }
  const statusCounts = statsData?.statusCounts || [];
  const countFor = (id) => {
    const e = statusCounts.find((s) => s.id === id);
    return e ? (e.n ?? 0) : 0;
  };
  const rejectedBadge = countFor("rejected");
  const juryBadge = typeof juryReviewCount === "number"
    ? juryReviewCount
    : countFor("jury_review") + countFor("accepted");
  const submitted = statsData?.totals?.apps_submitted;
  const appsBadge = submitted == null ? null : Math.max(0, submitted - rejectedBadge - juryBadge);

  return { appsBadge, rejectedBadge, juryBadge };
}

// Accepted tab badge: how many applications are SELECTED (green) — status
// `jury_review` with a signed current IC memo and no final-round reject.
// `startups` are adapted pipeline rows fetched with status=jury_review (the
// adapter carries no raw `status`, so the fetch filter is what scopes them),
// `documents` the raw IC-document list.
// Either input missing (loading / failed) → null, never a guessed number.
export function selectedCount(startups, documents) {
  if (!Array.isArray(startups) || !Array.isArray(documents)) return null;
  const signed = signedDocKeys(documents);
  return startups.filter((s) => isSelected({
    status: s.status,
    nativeTrack: s.nativeTrack || s.track,
    id: s.id,
    gate2Decision: s.gate2_decision,
  }, signed)).length;
}
