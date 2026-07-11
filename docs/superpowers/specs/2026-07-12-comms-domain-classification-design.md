# Communication (Wired & Wireless) domain — design spec

**Date:** 2026-07-12
**Branch:** `feat/comms-domain` (off `origin/release/sip-launch-v1` @ b4f2ae2)
**Status:** design approved

## Problem

The evaluation platform classifies each application into one industry **domain**
(`ai_screening.industry_category_id`, FK → `industry_categories`; 7 seeds today).
The org wants a new domain, **Communication (Wired & Wireless)**, to appear in the
domain filter on every surface (leadership, admin, reviewer), and wants existing
applications that are wired/wireless communication ventures identified and moved
into it.

## Decisions (from brainstorming)

- **Single-domain re-classify:** an identified app's one domain is overwritten to
  `comms`. No multi-domain tagging.
- **Surgical:** only apps confirmed as comms change; every other app is untouched.
- **Hybrid identification:** curated keyword shortlist → per-candidate LLM confirm.
- **Seed category:** `comms` is a permanent seed (canonical taxonomy).
- **Delivery:** a dry-run/apply backfill **script** with a CSV preview gate (not an
  admin-portal button).

## How the domain system works (verified)

- `industry_categories(id, label, is_seed, created_at, created_by_app_id)`;
  `CATEGORY_CAP = 12` (`services/industry_categories.py`). 7 seeds today.
- The AI `ClassifierAgent` reads categories dynamically via
  `industry_categories.fetch_categories()` (`ai_pipeline/pipeline.py:30`), so a new
  seed row is automatically offered to the classifier for **future** submissions.
- Filters are **data-driven, no hardcoded lists**:
  - Leadership → `GET /leadership/industry-categories` = `categories_with_counts()`
    (seeds always returned even at count 0; non-seeds hidden at 0; 12-cap).
  - Admin pipeline → `industryCountsFor(rows, track)` derives options from the loaded
    rows' `s.domain` label.
  - Reviewer queue → `countBy("industry")` derives from rows' `s.industry` label.
  ⇒ Adding the seed + tagging apps makes the domain appear everywhere with **zero
  frontend changes**.

## Section 1 — New category (migration 035)

`035_comms_industry_category.sql` (additive, idempotent, **no deploy-order risk** —
it only INSERTs a category row; existing code keeps working):
```sql
insert into public.industry_categories (id, label, is_seed) values
  ('comms', 'Communication (Wired & Wireless)', true)
on conflict (id) do nothing;
```
Ordering: apply this migration **before** running the backfill (the
`ai_screening.industry_category_id` FK requires the row to exist).

## Section 2 — Identification pipeline (`backend/app/services/comms_classifier.py`)

Testable units, LLM injected so tests never hit the network:

- `KEYWORDS` — curated deep-tech comms terms. Wireless: `wireless, rf, 5g, 6g,
  wifi, wi-fi, bluetooth, zigbee, lora, lorawan, spectrum, antenna, mmwave, sdr,
  transceiver, satellite communication/satcom, iot connectivity, cellular, modem,
  baseband`. Wired: `fiber optic/optical communication, ethernet, networking
  hardware, interconnect, telecom infrastructure, optical transceiver, docsis`.
  (Word-boundary matching to avoid substrings; case-insensitive.)
- `app_text_for(app_row, track, screening)` → reuse
  `ai_pipeline.serialize.build_app_text(app_row, track)` + `screening.summary` +
  `screening.project_name`. PII already omitted by the serializer.
- `shortlist(text) -> matched_terms: list[str]` — pure keyword scan; a candidate is
  any app with ≥1 matched term.
- `confirm_is_comms(text) -> {is_comms: bool, reason: str}` — one gemini-flash call
  via the existing OpenRouter client (`ai_pipeline.base_agent` JSON pattern), prompt:
  *"Is this venture PRIMARILY about wired or wireless communication technology
  (networks, RF, connectivity, telecom, optical/fiber comms)? Answer strict JSON
  {is_comms: bool, reason: <=15 words}. A venture that merely 'communicates with
  users' is NOT comms."* Fail-safe: parse error → `{is_comms: false}`.
- `identify(apps, confirm_fn=confirm_is_comms) -> list[{app_id, track, project_name,
  current_category, matched_terms, reason}]` — shortlist → confirm; returns only
  confirmed matches. `confirm_fn` is injectable (tests pass a stub).

## Section 3 — Backfill driver (`backend/scripts/backfill_comms_domain.py`)

Modeled on `scripts/backfill_industry.py` / `rescore_all_applications.py`.
- Loads all **screened** apps both tracks (`ai_screening` rows joined to
  `tir_applications` / `sip_applications`).
- Runs `comms_classifier.identify(...)`.
- **`--dry-run` (default):** writes `comms-domain-preview.csv`
  (`display_id, track, project_name, current_domain, matched_terms, llm_reason`).
  Writes nothing to the DB. This is the human review gate.
- **`--apply`:** first writes a backup file `comms-domain-backup.json`
  (`[{app_id, track, old_category_id}]`), then sets
  `ai_screening.industry_category_id = 'comms'` for each confirmed app (idempotent;
  skips ones already `comms`). Prints a summary (n matched, n changed).
- Reuses `get_admin_client()`; category row must exist (mig 035) or the FK update
  fails — the script asserts the `comms` category exists first and exits with a
  clear message otherwise.

## Section 4 — Filters & future classification

No frontend changes. The leadership seed shows immediately; admin/reviewer show it
once apps carry the label. Future submissions can be auto-classified `comms` because
the classifier already reads `industry_categories` dynamically (no code change).

## Section 5 — Tests

`backend/tests/test_comms_classifier.py` (fake Supabase where needed; `confirm_fn`
stubbed):
- shortlist: a 5G/antenna app matches; a pure fintech app does not; word-boundary
  (e.g. "communicate with users" alone does not trip a keyword falsely — validate
  the term list is specific enough, or rely on LLM confirm to reject it).
- identify: shortlisted + confirm=yes → included; shortlisted + confirm=no → excluded;
  non-shortlisted → never confirmed (no LLM call).
- apply logic: `industry_category_id` set to `comms` only for confirmed apps; a
  backup entry recorded per change; idempotent re-run makes no further changes.
- migration 035 idempotency (insert twice → one row).

## Rollout

1. Apply mig 035 in prod (Supabase SQL editor) — additive, safe any time.
2. Deploy backend (SAM) so `comms_classifier` + script ship. (Filters need no deploy;
   the category row + tags drive them. Backend deploy is only needed to run the
   script from the deployed code / for the classifier to know the category — the
   script can also be run locally against prod with the service-role key.)
3. Run `python -m scripts.backfill_comms_domain --dry-run` → review
   `comms-domain-preview.csv`.
4. On approval: `--apply`. Verify the domain + count appear on leadership, admin,
   reviewer (both tracks).
5. Vercel promote is unnecessary (no FE change), but a refresh will show the new pill.

## Out of scope (YAGNI)

Multi-domain tagging; admin-portal trigger UI; re-running the full classifier on all
apps; any change to the other 7 domains.
