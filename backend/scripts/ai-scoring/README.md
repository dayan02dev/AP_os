# AI scoring pipeline — operator runbook

Implementation of `docs/superpowers/specs/2026-05-20-ai-scoring-langgraph-design.md`.

## Pre-deployment

1. Complete calibration per `calibration/README.md`. Embed worked examples
   into the 5 Pass-2 prompts.
2. Get lead sign-off on the ARTPARK assets list in
   `backend/app/services/ai_scoring/artpark_assets.md`.
3. Verify migration 016 has been applied to staging Supabase
   (column `ai_screening.score_completeness` exists).
4. Set staging env vars (in `backend/.env.staging`):
   ```
   AI_SCORING_ENABLED=true
   AI_SCORING_PROVIDER=google_genai
   AI_SCORING_MODEL=gemini-2.5-flash
   GOOGLE_API_KEY=<your-key>
   ```

## Running

Dry-run a single application first:

```bash
# Get an application_id from the leadership dashboard or query Supabase
APP_ID=<some uuid>

# Make the request (via curl or the admin UI when it exists)
curl -X POST https://<staging-api-url>/admin/ai-screening/run \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d "{\"application_id\": \"$APP_ID\", \"track\": \"tir\"}"
```

Run against the full imported cohort:

```bash
curl -X POST https://<staging-api-url>/admin/ai-screening/run \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"all": true, "track": "tir"}'
```

## Rollback

Set `AI_SCORING_ENABLED=false` in env. The endpoint returns 503;
existing `ai_screening` rows persist. To re-run from scratch:

```sql
delete from public.ai_screening where application_track = 'tir';
```

Then re-enable + re-run.

## Observability

Each run writes a per-application transcript to
`backend/scripts/ai-scoring/runs/<application_id>-<timestamp>.json`
(gitignored). Inspect when debugging odd scores.
