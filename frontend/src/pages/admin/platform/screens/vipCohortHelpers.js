// Shared, pure helpers for the "VIP cohort" admin tab (spec §7): the AIR
// verification queue/detail and the MIS submissions matrix/period screens.
//
// vipErrorInfo() exists because of a sharp edge in this codebase: the
// backend raises every admin_vip.py error as `HTTPException(detail={"code":
// ...})` with NO `message` field (see admin_vip_query.py), and lib/api.js's
// ApiError falls back to the bare string "Request failed" whenever a
// structured `detail` carries no `message`. Left unmapped, every one of
// these errors would render the same useless banner. Each code below gets
// its own real copy — including reusing extra fields the backend already
// sends (`status`, `claimed_level`, `period_key`/`label`) rather than
// re-deriving them.

// ── error copy ──────────────────────────────────────────────────────────

const CODE_MESSAGES = {
  assessment_not_found: () =>
    "This AIR assessment could not be found — it may have been removed.",
  lever_not_found: () => "That lever isn't part of this assessment.",
  unknown_lever: () => "That isn't a recognised AIR lever.",
  air_not_open_for_verification: (d) =>
    d.status === "verified"
      ? "This round is already fully verified — there's nothing left to confirm."
      : "This round hasn't been submitted yet, so there's nothing to verify.",
  lever_not_claimed: () =>
    "The founder hasn't answered this lever yet, so there's no claimed level to confirm.",
  verified_level_out_of_range: (d) =>
    `You can confirm at the claimed level (AIR ${d.claimed_level}) or downgrade below it — not raise it.`,
  air_incomplete: () =>
    "This assessment is missing one or more lever rows. Contact engineering before confirming all.",
  not_found: () => "That MIS period could not be found.",
  mis_not_submitted: () => "This period is already a draft — there's nothing to reopen.",
  mis_later_period_submitted: (d) =>
    `Can't reopen this period — ${d.label || d.period_key} was submitted after it and depends on it. Reopen that period first.`,
};

/**
 * @param {{code?:string, message?:string, details?:object}} err an ApiError
 *   (or anything shaped like one — tests pass plain objects).
 * @returns {{message:string, blockerPeriodKey:string|null, blockerLabel:string|null}}
 */
export function vipErrorInfo(err) {
  const code = err?.code;
  const details = err?.details || {};
  const build = code && CODE_MESSAGES[code];
  const message = build
    ? build(details)
    : err?.message && err.message !== "Request failed"
      ? err.message
      : "Something went wrong. Try again.";
  return {
    message,
    blockerPeriodKey: code === "mis_later_period_submitted" ? details.period_key ?? null : null,
    blockerLabel: code === "mis_later_period_submitted" ? details.label ?? null : null,
  };
}

// ── formatting ──────────────────────────────────────────────────────────

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function levelText(level) {
  return level == null ? "—" : `AIR ${level}`;
}

// ── entries-grid field rendering ───────────────────────────────────────

export function fieldValueText(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (field?.type === "bool") return value ? "Yes" : "No";
  if (field?.type === "choice" && Array.isArray(field.option_labels)) {
    const hit = field.option_labels.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return String(value);
}

export function humanize(key) {
  return String(key || "")
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ── entries-catalog grouping ───────────────────────────────────────────

/**
 * Finds every "extra" entries table riding under a real section (spec §5.4:
 * quarterly's next_milestones is §9.2, hanging off planned_vs_actual's own
 * §9.1) — purely from `catalog.entry_fields` key order, with no hardcoded
 * mirror of the backend's SECTION_EXTRA_ENTRIES map to drift out of sync.
 * FastAPI/JSON preserve dict insertion order, and mis_query.py builds
 * entry_fields by appending each real section's id immediately followed by
 * its own extras (mis_catalog.SECTION_EXTRA_ENTRIES), so any key that is
 * NOT itself a `catalog.sections` id belongs to the most recently seen key
 * that IS one.
 *
 * @returns {{[sectionId: string]: string[]}}
 */
export function groupExtraEntries(catalog) {
  const sectionIds = new Set((catalog?.sections || []).map((s) => s.id));
  const keys = Object.keys(catalog?.entry_fields || {});
  const extras = {};
  let owner = null;
  for (const key of keys) {
    if (sectionIds.has(key)) {
      owner = key;
      continue;
    }
    if (owner) {
      (extras[owner] = extras[owner] || []).push(key);
    }
  }
  return extras;
}
