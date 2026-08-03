// Admin tab-badge counts derived from /stats. Rejected AND jury-selected apps
// live in their own tabs, so the Applications badge excludes both.
// statusCounts entries are { id, n }. Returns nulls while loading so no
// fabricated number is shown.
//
// The jury stage has one tab per track (TIR Selected / VIP Selected),
// so jury_review is also split using `statusCountsByTrack` ([{id, tir, sip}]).
// If the backend hasn't got that field yet, the per-track badges come back null
// (no badge) while the combined `juryBadge` still works.
export function pipelineBadges(statsData, statsLoading) {
  if (statsLoading || statsData == null) {
    return {
      appsBadge: null, rejectedBadge: null, juryBadge: null,
      juryTirBadge: null, juryVipBadge: null,
    };
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

  const byTrack = (statsData?.statusCountsByTrack || []).find((s) => s.id === "jury_review");
  const juryTirBadge = byTrack ? (byTrack.tir ?? 0) : null;
  const juryVipBadge = byTrack ? (byTrack.sip ?? 0) : null;

  return { appsBadge, rejectedBadge, juryBadge, juryTirBadge, juryVipBadge };
}
