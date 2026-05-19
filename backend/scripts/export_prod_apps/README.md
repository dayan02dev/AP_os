# Prod application export

One-shot dump of every submitted application (TIR + SIP) plus every evidence file from Supabase Storage. Output is a single folder you can compress and ship.

## What it pulls

| File | Source | Rows |
|---|---|---|
| `applications_tir.csv` | `public.tir_applications` where `status != 'draft'` | one per app |
| `applications_sip.csv` | `public.sip_applications` where `status != 'draft'` | one per app |
| `ai_screening.csv` | `public.ai_screening` filtered to exported apps | one per scored app |
| `reviews.csv` | `public.reviews` filtered to exported apps | one per submitted review |
| `reviewer_assignments.csv` | `public.reviewer_assignments` filtered to exported apps | one per assignment |
| `profiles.csv` | `public.profiles` for the founders whose apps were exported | one per applicant |
| `resumes.csv` | `public.resume_uploads` + `public.sip_resume_uploads` | one per uploaded CV |
| `manifest.json` | metadata + counts + run time | one |
| `files/<TIR-NNNNN>/...` | downloaded blobs from the 6 storage buckets | many |

Files are organised under `files/{display_id}/` where `display_id` is `TIR-NNNNN` / `SIP-NNNNN` (the same format the leadership dashboard shows in its ID column — see `backend/app/services/stats.py:compose_display_id`).

Subfolders per app:

- **TIR:** `evidence/`, `milestone/`
- **SIP:** `pitch_deck/`, `cap_table/`, `traction/`, `patents/`, `milestone/`

Resumes land under `files/_resumes_tir/<user_id>/` and `files/_resumes_sip/<user_id>/` because a CV is per-user, not per-application.

## How to run

```bash
cd backend
source .venv/bin/activate   # or wherever your supabase-py is installed

export SUPABASE_URL="https://xtmszlpwgbyoumalgbhs.supabase.co"     # PROD URL
export SUPABASE_SERVICE_ROLE_KEY="<the-prod-service-role-key>"     # PROD key
export OUTPUT_DIR="./prod_export_$(date +%Y%m%d)"

python scripts/export_prod_apps/export.py
```

The script reads its config from env vars only. **Double-check you used the prod project's URL, not staging.** The staging project ID is `exqmxvdtcsvpgtftwjml` — if you see that in `SUPABASE_URL`, abort and re-set.

## Properties

- **Idempotent.** Already-downloaded files (non-empty on disk) are skipped, so you can Ctrl-C and re-run to resume.
- **Read-only.** The script never writes back to Supabase. Worst-case it fails to download some files; nothing gets mutated upstream.
- **Best-effort.** Individual file or row failures are logged and the script keeps going. Check `manifest.json` for the failure count.
- **Gitignored.** The output directory (`prod_export*/`, `output*/`) is in this folder's `.gitignore`, so accidentally running inside the repo won't pollute git status.

## Caveats

- **PII.** Every row contains real founder emails, phones, and free-text answers. Every file is the original document the founder uploaded. Treat the output folder accordingly — private channel for sharing, no public storage.
- **Size.** Pitch decks run up to 25 MiB each on SIP, evidence files to 250 MiB on TIR. With a few hundred submitted apps this can be tens of GB. Run it on a machine with disk to spare.
- **Rate limits.** Supabase Storage will rate-limit aggressive downloads. The script downloads sequentially; if you hit limits, drop `PAGE_SIZE` or sleep between calls (one-line edit in `download_file`).
- **JSONB columns.** Stored as JSON-encoded strings inside CSV cells. Use `pandas.read_csv()` + `json.loads` (or `jq -r`) to parse them back.

## After the export

To ship the folder as a single archive:

```bash
cd prod_export_YYYYMMDD/..
tar -czf prod_export_YYYYMMDD.tar.gz prod_export_YYYYMMDD/
shasum -a 256 prod_export_YYYYMMDD.tar.gz   # share the hash so the receiver can verify
```

A 5 GB archive over a private S3 / signed-URL transfer is the safest channel. Avoid email attachments at that size.

## Verifying the output

After the script finishes, `manifest.json` has the per-section row + file counts. Cross-check with a quick Supabase SQL query, e.g.:

```sql
select count(*) from public.tir_applications where status != 'draft';
select count(*) from public.sip_applications where status != 'draft';
select count(*) from public.ai_screening;
```

These should match the numbers in `manifest.json -> counts`.
