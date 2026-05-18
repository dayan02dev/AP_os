# prod → staging data import

One-shot, repeatable script that copies real applicant data from the prod
Supabase project into the staging Supabase project. Full runbook below.

See: `docs/superpowers/specs/2026-05-18-prod-to-staging-data-import-design.md`

## Quick start

```bash
cp .env.import.example .env.import
# Edit .env.import — paste the prod + staging service-role keys
./run.sh --dry-run   # safe — performs no writes
./run.sh             # actually copies data into staging
```

Full runbook: see Task 13 of the plan (and below) for verification + rollback.
