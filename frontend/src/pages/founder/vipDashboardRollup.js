// Every value the VIP process dashboard (spec §6) renders, derived as pure
// functions from the AIR bundle (`founderApi.getAir()`) and MIS bundles
// (`founderApi.getMis()` / `founderApi.getMisPeriod(kind, key)`) — no
// fetching, no React, no `Date.now()` inside a function whose caller can
// fix "today" as a parameter. `VipDashboard.jsx` (Task 7) is the only place
// that fetches; every component (Tasks 2-6) receives these functions'
// output as plain props.
//
// The plan this file implements (docs/superpowers/plans/2026-08-17-vip-
// phase6-dashboard.md) names six "Open questions" — gaps where the spec
// gives a tile/panel but not the formula behind it, or asks for data no
// founder-facing endpoint can produce today. Each is resolved here with the
// plan's own conservative default, never an invented formula. Numbered to
// match the plan's own "Open questions" section:
//
//   1. AIR rounds carry no due date -> `nextDue` only ever surfaces an MIS
//      period; there is no AIR branch to omit-vs-invent here at all.
//   2. No founder-facing endpoint returns any AIR round but the current
//      quarter's -> `airTile`'s `delta.available` is unconditionally
//      `false`; `activityFeed` can only ever see the current round.
//   3. "Reporting compliance" -> `reportingCompliance` counts
//      `status === "submitted" || overdue` as "due" and reports
//      `submitted / due`, composed only from fields the backend already
//      derived (never a frontend `due_date <= today` comparison) — no
//      on-time claim.
//   4. "Cash & runway" -> `cashRunway` reads `runway_months`'s `actual`
//      verbatim. It does NOT compute `cash_in_bank / net_burn_month` — see
//      the mutation-check test guarding exactly that invented formula.
//   5. Tile 1's delta, which rollup -> moot while Open Question 2 is
//      unresolved; `airTile.delta.available` stays `false` regardless.
//   6. "Milestone status flips" as a feed event -> `activityFeed` never
//      emits one; it only ever reads real stored timestamps (AIR
//      `submitted_at`/`verified_at`, MIS period `submitted_at`/
//      `reopened_at`).

// ── date helpers (pure — never read the system clock) ──────────────────

function toUtcMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Whole days from `fromIso` to `toIso` ("YYYY-MM-DD" each), positive when
// `toIso` is in the future relative to `fromIso`. Used only for the
// cosmetic "days remaining" count on Tile 4 (see `nextDue`) — never for a
// compliance/overdue determination, which always comes from the backend's
// own `overdue` flag (Global Constraints: "never recompute a date the
// backend already derived").
function daysBetween(fromIso, toIso) {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / 86400000);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function sortByDueDateAsc(rows) {
  return [...rows].sort((a, b) => {
    if (a.due_date < b.due_date) return -1;
    if (a.due_date > b.due_date) return 1;
    return 0;
  });
}

// ── misEmptyReason ───────────────────────────────────────────────────────

// `periodRows` is one kind's array (e.g. `mis.monthly`), never the combined
// `{monthly, quarterly}` index — see `reportingCompliance`/`nextDue` for the
// functions that DO take the whole index.
//
// States 6 and 7 (the table in the plan) are the sharpest instance of this
// build's own failure mode: a null with two distinct causes rendered with
// one message true for only one of them. Both are composed purely from
// `status`/`overdue`, never from a frontend `due_date <= today` comparison.
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

// ── reportingCompliance ──────────────────────────────────────────────────

// `mis` is the whole `getMis()` response (`{catalog, monthly, quarterly}`).
// "Due" = submitted OR overdue (Open Question 3's shipped default) —
// composed only from fields the backend already derived; never reads
// `due_date` directly (see the mutation-check test guarding exactly that).
export function reportingCompliance(mis) {
  const rows = [...(mis?.monthly || []), ...(mis?.quarterly || [])];
  const due = rows.filter((r) => r.status === "submitted" || r.overdue);
  const submitted = rows.filter((r) => r.status === "submitted");
  const total_due = due.length;
  const pct = total_due === 0 ? null : Math.round((submitted.length / total_due) * 100);
  return { total_due, submitted: submitted.length, pct };
}

// ── nextDue ───────────────────────────────────────────────────────────────

// Same `mis` shape as `reportingCompliance`. `todayIso` is caller-supplied
// (`VipDashboard.jsx`'s `todayISO()`, Task 7) — this function never reads
// the system clock itself. Picks the earliest-due draft period across BOTH
// calendars (Open Question 1: an AIR round has no due date, so there is no
// third candidate to compare against — this only ever compares MIS
// periods). `days_remaining` is signed, not clamped at zero, so an overdue
// period reports a real negative count.
export function nextDue(mis, todayIso) {
  const tagged = [
    ...(mis?.monthly || []).map((r) => ({ ...r, kind: "monthly" })),
    ...(mis?.quarterly || []).map((r) => ({ ...r, kind: "quarterly" })),
  ];
  const drafts = tagged.filter((r) => r.status !== "submitted");
  if (drafts.length === 0) return null; // state 11 — all caught up

  const next = sortByDueDateAsc(drafts)[0];
  return {
    period_key: next.period_key,
    label: next.label,
    kind: next.kind,
    due_date: next.due_date,
    days_remaining: daysBetween(todayIso, next.due_date),
  };
}

// ── cashRunway ────────────────────────────────────────────────────────────

function metricActual(bundle, key) {
  const row = (bundle.metrics || []).find((m) => m.metric_key === key);
  return row ? row.actual ?? null : null;
}

// `monthlyBundles` is an array of `getMisPeriod("monthly", key)` responses,
// any order. Reads the LATEST submitted period's `runway_months` verbatim
// (Open Question 4's shipped default) — deliberately NEVER
// `cash_in_bank / net_burn_month`, which is a different, uninvited formula
// this dashboard must not invent (see the mutation-check test).
export function cashRunway(monthlyBundles) {
  const submitted = (monthlyBundles || []).filter((b) => b.period?.status === "submitted");
  if (submitted.length === 0) return null;

  const latest = [...submitted].sort((a, b) => {
    if (a.period.period_key < b.period.period_key) return 1;
    if (a.period.period_key > b.period.period_key) return -1;
    return 0;
  })[0];

  return {
    period_key: latest.period.period_key,
    period_label: latest.period.label,
    cash_in_bank: metricActual(latest, "cash_in_bank"),
    net_burn_month: metricActual(latest, "net_burn_month"),
    runway_months: metricActual(latest, "runway_months"),
  };
}

// ── metricTrend ───────────────────────────────────────────────────────────

// Exactly these six keys, in exactly this order — the small multiples Task
// 5 renders. Sourced from each bundle's `metrics[].actual` by `metric_key`,
// never hardcoded per-metric elsewhere.
const TREND_METRIC_KEYS = [
  "revenue_month",
  "cash_in_bank",
  "runway_months",
  "headcount_eom",
  "deployments_field",
  "trl_level",
];

// Same `monthlyBundles` shape as `cashRunway`. Filters to `submitted`
// internally and sorts ascending by `period.period_key`.
export function metricTrend(monthlyBundles) {
  const submitted = (monthlyBundles || [])
    .filter((b) => b.period?.status === "submitted")
    .sort((a, b) => {
      if (a.period.period_key < b.period.period_key) return -1;
      if (a.period.period_key > b.period.period_key) return 1;
      return 0;
    });

  const periods = submitted.map((b) => b.period.period_key);
  const series = {};
  for (const key of TREND_METRIC_KEYS) {
    series[key] = submitted.map((b) => ({
      period_key: b.period.period_key,
      label: b.period.label,
      value: metricActual(b, key),
    }));
  }
  return { periods, series };
}

// ── milestonesAndRisks ────────────────────────────────────────────────────

const MILESTONE_STATUSES = ["On Track", "At Risk", "Blocked"];

// Takes ONE bundle (the latest monthly period, draft or submitted — see
// Task 7's `monthlyBundles.at(-1)`), not an array. `"Done"` milestones are
// excluded from every status group here (state 3's "open milestones"
// reading) — a milestone is never lost, it simply stops being an OPEN one.
// Every risk row is returned unfiltered: `risks`' own `CARRY_FORWARD` rule
// is `"none"` (mis_catalog.py) and the `risks` entry schema has no
// non-"open" severity state at all — `severity` is `red`/`amber` only —
// so there is nothing in the shape of a risk row that would ever mean
// "closed"; filtering here would silently drop real, current risks.
export function milestonesAndRisks(latestMonthlyBundle) {
  if (!latestMonthlyBundle) return null;

  const milestoneRows = latestMonthlyBundle.entries?.milestones || [];
  const milestones_by_status = {};
  for (const status of MILESTONE_STATUSES) {
    milestones_by_status[status] = milestoneRows.filter((r) => (r.data || {}).status === status);
  }

  return {
    period_label: latestMonthlyBundle.period?.label,
    milestones_by_status,
    risks: latestMonthlyBundle.entries?.risks || [],
  };
}

// ── airTile ────────────────────────────────────────────────────────────────

// `airBundle` is the whole `getAir()` response. `delta.available` is
// unconditionally `false` — Open Questions 2 and 5: no founder-facing
// endpoint returns any AIR round but the current quarter's, so there is no
// prior round to diff against, and no code path here ever sets this `true`.
export function airTile(airBundle) {
  const claimed = airBundle?.rollups?.claimed || {};
  const verified = airBundle?.rollups?.verified || {};
  return {
    overall_claimed: claimed.overall ?? null,
    overall_verified: verified.overall ?? null,
    tech_claimed: claimed.technology ?? null,
    comm_claimed: claimed.commercial ?? null,
    delta: { available: false, reason: "no_endpoint_for_prior_rounds" },
  };
}

// ── activityFeed ───────────────────────────────────────────────────────────

const MIS_KIND_NOUN = { monthly: "Monthly update", quarterly: "Quarterly review" };

function pushIf(events, at, color, text) {
  if (!at) return;
  events.push({ at, color, text, meta: fmtDate(at) });
}

// Takes the whole AIR bundle plus both period-bundle arrays (monthly and
// quarterly) so it can surface submit/reopen events from either calendar.
// Only ever built from a real stored timestamp (Open Question 6) — AIR
// round `submitted_at`/`verified_at`, MIS period `submitted_at`/
// `reopened_at`. Never attempts to detect a "milestone status flip" between
// two periods' entries; there is no reachable signal for that (see the
// header comment and the plan's Open Question 6).
export function activityFeed(airBundle, monthlyBundles, quarterlyBundles) {
  const events = [];

  const round = airBundle?.round;
  if (round) {
    pushIf(events, round.submitted_at, "blue", `AIR ${round.round_label} submitted`);
    pushIf(events, round.verified_at, "green", `AIR ${round.round_label} verified by ARTPARK`);
  }

  for (const bundles of [monthlyBundles, quarterlyBundles]) {
    for (const b of bundles || []) {
      const p = b?.period;
      if (!p) continue;
      const noun = MIS_KIND_NOUN[p.kind] || "Report";
      pushIf(events, p.submitted_at, "green", `${noun} ${p.label} submitted`);
      pushIf(events, p.reopened_at, "amber", `${noun} ${p.label} reopened`);
    }
  }

  events.sort((a, b) => {
    if (a.at < b.at) return 1;
    if (a.at > b.at) return -1;
    return 0;
  });
  return events.slice(0, 8);
}
