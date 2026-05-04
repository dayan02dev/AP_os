// Question-ID ↔ DB-column mapping for SIP applications.
//
// Mirrors lib/fieldMap.js but for the sip_applications table. Most basic +
// declaration columns are shared with TIR; SIP adds a handful of sip_*
// columns and drops several TIR-only ones. See backend/app/models/sip_application.py
// for the authoritative column list.

export const QUESTION_TO_COLUMN_SIP = Object.freeze({
  // ── Section · Basic Information (shared with TIR) ──
  fullName: "basic_full_name",
  phone: "basic_phone",
  email: "basic_email",
  org: "basic_org",
  degree: "basic_degree",
  incubatorAssociation: "basic_incubator_association",
  incubatorDetails: "basic_incubator_details",
  hearAbout: "basic_hear_about",

  // ── Section · Basic · SIP-specific gates ──
  sipIncorporated: "sip_incorporated",
  sipTRL: "sip_trl",
  sipFounders: "sip_founders",

  // ── Section · Problem (shared) ──
  problemDescribe: "problem_describe",

  // ── Section · Solution (shared with TIR) ──
  solutionDescribe: "solution_describe",
  coreTech: "solution_core_tech",
  contrarianInsight: "solution_contrarian_insight",

  // ── Section · Solution · SIP-specific traction ──
  sipTraction: "sip_traction",
  sipTractionDetails: "sip_traction_details",
  sipTractionFiles: "sip_traction_files",

  // ── Section · Execution (shared) ──
  willBreak: "execution_will_break",
  milestone: "execution_milestone",
  milestoneFiles: "execution_milestone_files",
  infrastructure: "execution_infrastructure",
  failure: "execution_failure",
  hwSwIntegration: "execution_hwsw_integration",

  // ── Section · Evidence (SIP-specific) ──
  sipPitchDeck: "sip_pitch_deck",
  sipCapTableFile: "sip_cap_table_file",
  sipDemoVideo: "sip_demo_video_url",
  sipPatents: "sip_patents_files",
});

export const COLUMN_TO_QUESTION_SIP = Object.freeze(
  Object.fromEntries(
    Object.entries(QUESTION_TO_COLUMN_SIP).map(([q, c]) => [c, q]),
  ),
);

const DECLARATION_KEYS = ["truthful", "refChecks", "terms", "newsletter"];
const DECLARATION_KEY_TO_COLUMN = Object.freeze({
  truthful: "declaration_truthful",
  refChecks: "declaration_ref_checks",
  terms: "declaration_terms",
  newsletter: "declaration_newsletter",
});

export function expandForPatchSip(updates) {
  const patch = {};
  for (const [qid, value] of Object.entries(updates)) {
    if (qid === "declarations") {
      const obj = value || {};
      for (const key of DECLARATION_KEYS) {
        patch[DECLARATION_KEY_TO_COLUMN[key]] = !!obj[key];
      }
      continue;
    }
    const col = QUESTION_TO_COLUMN_SIP[qid];
    if (!col) continue;
    patch[col] = value;
  }
  return patch;
}

export function collapseFromRowSip(row) {
  const answers = {};
  if (!row) return answers;
  for (const [col, qid] of Object.entries(COLUMN_TO_QUESTION_SIP)) {
    if (row[col] !== undefined && row[col] !== null) {
      answers[qid] = row[col];
    }
  }
  const d = {};
  for (const key of DECLARATION_KEYS) {
    const col = DECLARATION_KEY_TO_COLUMN[key];
    if (row[col] !== undefined && row[col] !== null) d[key] = !!row[col];
  }
  if (Object.keys(d).length > 0) answers.declarations = d;
  return answers;
}

export const SECTION_ORDER_SIP = [
  "basic",
  "problem",
  "solution",
  "execution",
  "evidence",
  "declaration",
];
