# AI scoring calibration — Path A (pre-deployment)

Per spec §7.4. Hand-score 10-20 real applications with 2 reviewers
before the AI pipeline ships, so the LLM has worked examples anchored
in real applicant writing.

## Workflow

1. **Pick 10-20 real applications** from the 269 imported into staging.
   Aim for variety: some strong, some weak, some borderline, mix of
   solo vs team, mix of industries.

2. **Each reviewer copies `hand_score_template.json`** into a file
   named `hand-scored-<application_short_id>-<reviewer-initials>.json`
   and fills in the 5 scores + rationales using ONLY the rubrics in
   the Pass 2 prompts at `backend/app/services/ai_scoring/prompts/signals/*.txt`.

   No LLM. No collaboration during scoring. Independent.

3. **Reconcile**: where the two reviewers' scores differ by >1, talk it
   through. The disagreement points to either an unclear rubric (fix
   the prompt) or an inconsistent reviewer (recalibrate). Iterate 2-3
   times until reviewer-to-reviewer agreement is ±1 on ≥80% of scores.

4. **Extract worked examples**. From the converged set, pick 2-3
   applications per signal that clearly anchor different score levels
   (e.g. one ~9, one ~5, one ~2). Fill in the `worked_example_candidates`
   block of those applications' JSON files.

5. **Embed in prompts**. Append a `## Worked examples` block to each
   `prompts/signals/<signal>.txt` containing the chosen excerpts.
   Prompts become v1.0.

6. **Validate on held-out**. Score a fresh 5-10 applications with the
   AI pipeline (`./run.sh` against the staging Supabase). Have a third
   reviewer score the same applications by hand. Compare. If
   agreement is within ±1 on ≥80% of scores, the prompts are deployment-
   ready. Otherwise, iterate.

## Storing reviewer files

Hand-scored files live under `backend/scripts/ai-scoring/calibration/`
and are committed to the repo (no PII — the basic_* fields are
redacted in the AI pipeline anyway, and rationales should reference
application content abstractly).
