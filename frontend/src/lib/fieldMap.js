// Question-ID ↔ DB-column mapping.
//
// questions.jsx uses short question ids (e.g. "fullName", "hasTeam") while
// the backend persists section-prefixed columns (e.g. "basic_full_name",
// "basic_has_team"). This module is the single translation layer.
//
// `declarations` is special: the question holds a dict {truthful, refChecks,
// terms, newsletter}, and the backend stores four separate booleans.
// `expandForPatch` / `collapseFromRow` handle that split.

export const QUESTION_TO_COLUMN = Object.freeze({
  // Section 02 — basic
  hasTeam: "basic_has_team",
  teammates: "basic_teammates",
  fullName: "basic_full_name",
  phone: "basic_phone",
  email: "basic_email",
  org: "basic_org",
  degree: "basic_degree",
  incubators: "basic_incubators", // legacy — kept so old draft rows still load
  // Bucket 3: replaces `incubators` with a Yes/No + conditional details pair.
  incubatorAssociation: "basic_incubator_association",
  incubatorDetails: "basic_incubator_details",
  hearAbout: "basic_hear_about",

  // Section 03 — problem
  problemDefined: "problem_defined",
  problemDescribe: "problem_describe",
  problemImportance: "problem_importance", // legacy

  // Section 04 — solution
  stage: "solution_stage",
  solutionDescribe: "solution_describe",
  coreTech: "solution_core_tech",
  tenX: "solution_ten_x",                   // legacy
  hurdles: "solution_hurdles",              // legacy
  moat: "solution_moat",                    // legacy
  nationalScale: "solution_national_scale", // legacy
  customers: "solution_customers",          // legacy
  // Bucket 3: contrarian-insight question, optional.
  contrarianInsight: "solution_contrarian_insight",

  // Section 05 — execution
  willBreak: "execution_will_break",
  milestone: "execution_milestone",
  budget: "execution_budget",  // legacy — replaced by `infrastructure`
  failure: "execution_failure",
  // Bucket 3: infrastructure replaces budget; hwSwIntegration is new optional;
  // milestoneFiles is the JSONB array of attached files (managed by the
  // /applications/me/milestone-files endpoints, not by PATCH /me).
  infrastructure: "execution_infrastructure",
  hwSwIntegration: "execution_hwsw_integration",
  milestoneFiles: "execution_milestone_files",

  // Section 06 — evidence
  evidenceFiles: "evidence_files",
  video: "evidence_video_url",
  deck: "evidence_deck", // legacy — pitch-deck question removed in new spec

  // Section 07 — declaration: handled by the declaration helpers below.
});

export const COLUMN_TO_QUESTION = Object.freeze(
  Object.fromEntries(Object.entries(QUESTION_TO_COLUMN).map(([q, c]) => [c, q])),
);

const DECLARATION_KEYS = ["truthful", "refChecks", "terms", "newsletter"];
const DECLARATION_KEY_TO_COLUMN = Object.freeze({
  truthful: "declaration_truthful",
  refChecks: "declaration_ref_checks",
  terms: "declaration_terms",
  newsletter: "declaration_newsletter",
});

/**
 * Convert {questionId: value} updates into a {dbColumn: value} patch body.
 * `declarations` is expanded into four booleans.
 *
 * Note on `milestoneFiles`: the JSONB column is normally written by the
 * dedicated /applications/me/milestone-files endpoints (multipart upload).
 * Including it here means the regular PATCH echoes the latest array back
 * during the optimistic local update — keeping the wizard in sync without
 * a refetch. The trade-off: if two tabs are open and one uploads a file,
 * the other can clobber the JSONB with its stale list on the next save.
 * Acceptable for the applicant flow (single tab is typical); evaluators
 * use the service-role client and won't hit this path.
 */
export function expandForPatch(updates) {
  const patch = {};
  for (const [qid, value] of Object.entries(updates)) {
    if (qid === "declarations") {
      const obj = value || {};
      for (const key of DECLARATION_KEYS) {
        patch[DECLARATION_KEY_TO_COLUMN[key]] = !!obj[key];
      }
      continue;
    }
    const col = QUESTION_TO_COLUMN[qid];
    if (!col) continue; // non-question fields (e.g. current_section) handled separately
    patch[col] = value;
  }
  return patch;
}

/**
 * Convert a full application row (DB column keys) back into an answers
 * dict keyed by question ids — the shape the existing wizard components
 * expect.
 */
export function collapseFromRow(row) {
  const answers = {};
  if (!row) return answers;
  for (const [col, qid] of Object.entries(COLUMN_TO_QUESTION)) {
    if (row[col] !== undefined && row[col] !== null) {
      answers[qid] = row[col];
    }
  }
  // Collapse 4 declaration booleans back into one dict.
  const d = {};
  for (const key of DECLARATION_KEYS) {
    const col = DECLARATION_KEY_TO_COLUMN[key];
    if (row[col] !== undefined && row[col] !== null) d[key] = !!row[col];
  }
  if (Object.keys(d).length > 0) answers.declarations = d;
  return answers;
}

/**
 * Section-id slugs from questions.jsx, in wizard order.
 */
export const SECTION_ORDER = [
  "basic",
  "problem",
  "solution",
  "execution",
  "evidence",
  "declaration",
];
