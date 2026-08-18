// `misEmptyReason`/`misEmptyCopy` — relocated from
// `frontend/src/pages/founder/vipDashboardRollup.js` (which now re-exports
// from here) so both the founder-facing MIS page (`FounderMis.jsx`) and the
// admin MIS charts surface (`AdminVipMisCharts.jsx`) can import them
// without an admin->founder-page cross-import — no precedent for that in
// this codebase; `frontend/src/lib/` is the established cross-cutting home
// (`rbac.js`/`api.js`/`adminVipApi.js`/`founderApi.js` all live here).
//
// `periodRows` is one kind's array (e.g. `mis.monthly`), never the combined
// `{monthly, quarterly}` index — see `vipDashboardRollup.js`'s
// `reportingCompliance`/`nextDue` for the functions that DO take the whole
// index (those stay in the rollup module; they are not relocated here).
//
// This pair is the sharpest instance of this build's own failure mode: a
// null with two distinct causes rendered with one message true for only one
// of them. Both are composed purely from `status`/`overdue`, never from a
// frontend `due_date <= today` comparison. `misEmptyCopy` lived in three
// files as three byte-identical copies until it was first consolidated into
// the rollup module — three verbatim copies of the same sentence is
// precisely how the two causes drift back into one message. This build has
// already paid for that mistake five times, and this codebase has a longer
// history of hand-synced pairs silently diverging (rbac.py/rbac.js,
// state_machine.py/statusMachine.js — the latter drifted badly enough to
// need a mirror test). One definition, one place to fix.

// Shared by `misEmptyReason` below and by `vipDashboardRollup.js`'s own
// `nextDue` (which imports this back from here rather than keeping a second
// copy) — exported for that reason, not just for this module's own use.
export function sortByDueDateAsc(rows) {
  return [...rows].sort((a, b) => {
    if (a.due_date < b.due_date) return -1;
    if (a.due_date > b.due_date) return 1;
    return 0;
  });
}

export function misEmptyCopy(reason) {
  if (!reason) return null;
  if (reason.cause === "overdue_backlog") {
    return `No monthly update filed yet — ${reason.count} period(s) are overdue, starting with ${reason.oldest_label} (due ${reason.oldest_due}).`;
  }
  return `No monthly update filed yet — your first one is due ${reason.due_date}.`;
}

export function misEmptyReason(periodRows) {
  const rows = periodRows || [];
  if (rows.some((r) => r.status === "submitted")) return null; // not empty

  const overdue = rows.filter((r) => r.overdue);
  if (overdue.length > 0) {
    const oldest = sortByDueDateAsc(overdue)[0];
    return {
      cause: "overdue_backlog",
      count: overdue.length,
      oldest_label: oldest.label,
      oldest_due: oldest.due_date,
    };
  }

  if (rows.length === 0) return null; // nothing generated yet — not reachable for an onboarded founder
  const soonest = sortByDueDateAsc(rows)[0];
  return { cause: "not_due_yet", due_date: soonest.due_date, due_label: soonest.label };
}
