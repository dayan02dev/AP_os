# VIP Investment Memo Pilot

## Scope

Pilot the investment-memo workflow for exactly two VIP/SIP applications. TIR behavior remains unchanged. VIP is the database track value `sip`.

Pilot candidates selected from the production application corpus by complete submissions with the highest existing AI scores:

1. **Voxvertex Solutions** — Ronish Sheoran — application `0117bc80-98c1-4172-bccd-af61327ac580` — AI overall 9.4 — completion 100%.
2. **FLOAID MEDTECH PRIVATE LIMITED** — Shivam Gupta — application `c8e45451-b9eb-4bed-8293-7a6782237168` — AI overall 9.3 — completion 100%.

The reference file is `/Users/apple/Downloads/Hyflex_Mobility_Investment_Memo.docx`; it is used for structure and tone only, not as source evidence for either pilot.

## Memo sections

1. Confidential title block and one-line layman description
2. Deal snapshot
3. What does this company do?
4. Why this solution matters: status quo, competition, barriers, traction/capital efficiency, pivot potential
5. Product and business model
6. Technology edge
7. Competitive landscape by target industry
8. Addressable market by target industry with source and realistic slice
9. Founding team
10. Milestones and timeline
11. Use of funds
12. Key risks and mitigants
13. IC recommendation: approve / conditional approval / request more information
14. IC reviewer notes with ten structured note areas
15. Source attribution and footer

## Evidence mapping

All claims are generated from the full `sip_applications` row, reviewer/AI records, founder profile, résumé metadata, and known SIP attachments:

- Company/founder: `basic_org`, `basic_full_name`, `basic_email`, `basic_phone`, `sip_founders`, profile links, résumé.
- Stage: `sip_incorporated`, `sip_trl`, `sip_traction`, `sip_traction_details`.
- Problem/solution: `problem_describe`, `solution_describe`, `solution_core_tech`, `solution_contrarian_insight`.
- Execution: `execution_milestone`, `execution_infrastructure`, `execution_will_break`, `execution_failure`, `execution_hwsw_integration`, `execution_milestone_files`.
- Evidence: `sip_pitch_deck`, `sip_cap_table_file`, `sip_traction_files`, `sip_patents_files`, `sip_demo_video_url`, résumé.
- Declarations and completeness: declaration fields, `completion_pct`, missing/empty evidence.
- Existing AI/reviewer context: `ai_screening`, submitted `reviews`, reviewer assignments; existing scores are displayed as comparison context, not silently substituted for the memo rubric.

Missing facts must render `[To be confirmed]`; no unsupported TAM, competitor, customer, funding, or IP claim may be presented as application evidence.

## AI design

Use a dedicated structured memo model call rather than the existing five-score screen. The prompt will require strict JSON matching the fifteen-section schema, evidence citations by source/field, confidence per claim, neutral language, and explicit `[To be confirmed]` values. Market-size claims must carry a source and publication year; if live sourcing is unavailable, the memo must mark the market row for confirmation instead of inventing figures.

Scoring will be memo-specific and evidence-bound:

- Problem urgency and defined buyer
- Technical differentiation and validation
- Commercial evidence and capital efficiency
- Team execution readiness
- Market and competitive position
- Risk-adjusted IC confidence

Scores remain separate from existing reviewer scores and are shown side-by-side for pilot review.

## Surfaces and permissions

- Admin: VIP-only memo sections, score comparison, generate/regenerate, DOCX/PDF download.
- Leadership: same memo read/download controls through the leadership detail surface.
- Reviewer: VIP-only memo context on assigned applications; no IC decision controls.
- TIR: current AI sections, scoring, and views remain unchanged.
- Pilot gating: generation and memo controls are limited to the two application IDs above until review is accepted.

## Delivery format

Generate editable `.docx` and preview `.pdf` from the same structured memo object. Store generated artifacts under an application-scoped private storage path and issue short-lived signed download URLs. Include a generated-at timestamp, model identifier, source-material list, and memo version.

## Acceptance checks

- Both pilot memos consume all available wizard answers and evidence metadata.
- Reference structure is followed without copying unsupported Hyflex facts.
- Every market/competitor/traction assertion is sourced or marked `[To be confirmed]`.
- Admin, leadership, and reviewer render the same VIP memo sections with role-appropriate actions.
- TIR routes and output are unchanged.
- DOCX is editable; PDF is readable; both downloads are scoped to authorized users.
