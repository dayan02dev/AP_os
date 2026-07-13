// Admin tab-badge counts derived from /stats. Rejected AND jury-selected apps
// live in their own tabs, so the Applications badge excludes both.
// statusCounts entries are { id, n }. Returns nulls while loading so no
// fabricated number is shown.
export function pipelineBadges(statsData, statsLoading) {
  if (statsLoading || statsData == null) {
    return { appsBadge: null, rejectedBadge: null, juryBadge: null };
  }
  const statusCounts = statsData?.statusCounts || [];
  const countFor = (id) => {
    const e = statusCounts.find((s) => s.id === id);
    return e ? (e.n ?? 0) : 0;
  };
  const rejectedBadge = countFor("rejected");
  const juryBadge = countFor("jury_review");
  const submitted = statsData?.totals?.apps_submitted;
  const appsBadge = submitted == null ? null : Math.max(0, submitted - rejectedBadge - juryBadge);
  return { appsBadge, rejectedBadge, juryBadge };
}
