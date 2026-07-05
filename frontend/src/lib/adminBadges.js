// Admin tab-badge counts derived from /stats. Rejected apps live in their own
// tab, so the Applications badge excludes them. statusCounts entries are
// { id, n }. Returns nulls while loading so no fabricated number is shown.
export function pipelineBadges(statsData, statsLoading) {
  if (statsLoading || statsData == null) return { appsBadge: null, rejectedBadge: null };
  const statusCounts = statsData?.statusCounts || [];
  const rejectedEntry = statusCounts.find(s => s.id === "rejected");
  const rejectedBadge = rejectedEntry ? (rejectedEntry.n ?? 0) : 0;
  const submitted = statsData?.totals?.apps_submitted;
  const appsBadge = submitted == null ? null : Math.max(0, submitted - rejectedBadge);
  return { appsBadge, rejectedBadge };
}
