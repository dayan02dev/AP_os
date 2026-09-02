# Art Infra Phase 2 carryover

**Date:** 2026-09-02
**Branch this was written from:** `feat/art-infra-admin` (Phase 1 UI sample)
**Sources:** `docs/superpowers/specs/2026-09-02-art-infra-admin-portal-design.md` (binding
spec), `docs/superpowers/plans/2026-09-02-art-infra-admin-phase1-ui.md` (Phase 1 plan),
`.superpowers/sdd/2026-09-02-art-infra-admin-phase1-ui/progress.md` (execution ledger)

## Purpose

Phase 1 shipped six admin screens and the reworked founder Art Infra page, all
rendering off an in-memory mock (`frontend/src/lib/artInfraMock.js`). No database,
no backend router, no RBAC role. This document is the single place that
collects everything Phase 2 needs to pick up: the scope the spec always
deferred, the places the mock made something free that a real API will not,
the features cut on purpose, and the sample data that must never leak into a
real seed. Read this before writing `046_art_infra_catalog.sql` or the
`/admin/art-infra` router.

Nothing here should be news to someone who read the design spec — this
document exists so it survives the gap between "UI approved" and "Phase 2
kicks off," when the spec's prose is easy to skim past and the ledger's
line-item findings are easy to lose.

---

## A. Phase 2 scope proper

This is the work the spec always said comes after UI sign-off. None of it is
new; it is restated here so it is not rediscovered from scratch.

### A.1 Migration `046_art_infra_catalog.sql`

Five tables, defined in full in the design spec's "Target data model" section:

| Table | Purpose |
|---|---|
| `art_infra_vendors` | vendor identity + contact block (`contact_name`, `contact_email`, `contact_phone`, `artpark_ref`, `notes`) |
| `art_infra_categories` | slug-keyed, `label`, `sort` |
| `art_infra_products` | the catalog row: vendor/category FKs, type, pricing, price, lead-time columns, `specs jsonb`, lifecycle `status`, `sort`, `visible_tracks text[]` |
| `art_infra_datasheets` | one row per file/link, `product_id` cascade-deletes, `storage_path` or `external_url` (checked, not both null) |
| `art_infra_reviews` | founder reviews, `pending`/`approved`/`hidden`, unique on `(product_id, application_id)` |

Seed with the real catalog: **12 products, 11 vendors, 8 categories**, all
inserted as `status='published'`. The Phase 1 fixture generator
(`backend/scripts/gen_art_infra_fixture.py`, produces
`frontend/src/lib/__fixtures__/artInfraSeed.json`) already transcribed this
catalog from `backend/app/services/founder_catalog.py` mechanically — reuse
its slugging and lead-time-splitting logic for the migration's seed rather
than hand-typing the 12 rows a second time. That generator was written
specifically to avoid the "hand-transcribing 12 products is how typos enter"
risk; a hand-written SQL seed reintroduces exactly that risk.

Two schema decisions the spec already made, restated because they are easy to
second-guess in isolation:

- **`lead_time_weeks` becomes real `int` columns** (`lead_time_weeks_min`,
  `lead_time_weeks_max`), not a `specs` string. Today it lives as free text
  ("Lead time: 3–4 weeks") inside the specs list, which cannot be filtered or
  sorted. `specs` itself stays `jsonb` — it is genuinely display-only and
  varies per product, so a fixed schema there buys nothing.
- **`founder_cart_items.product_id` migrates from `text` (`'c1'`) to a `uuid`
  FK.** This table has zero rows in production today. That makes the FK
  conversion free now; it will not stay free once founders start shortlisting
  real products; do this migration before that changes.

`founder_resource_requests` keeps its `quote` enum value even though nothing
will write it after Phase 2 ships (`POST /founder/store/quote-request` is
removed — see A.3). Do not drop the enum value: the table is shared with
`intro`/`partner` request kinds from other Founders Resources tabs, and
removing a constraint value gains nothing while risking those rows.

### A.2 Migration-numbering hazard

**046 is not permanently reserved.** `feat/vip-onboarding` has already claimed
043–045 (staging only — production is at 042, confirmed against
`backend/migrations/` in this worktree, which tops out at `042_founder_journey.sql`).
046 is free only for as long as that branch keeps those numbers. Before
writing `046_art_infra_catalog.sql`, check `feat/vip-onboarding`'s current
migration numbering and re-check at merge time, not just at branch-creation
time.

This exact collision already happened once, on 037/038/039 during the Founder
Portal build — two branches picked the same free-looking number and one had
to be renumbered after the fact. Treat "the number I picked is free" as a
claim that expires, not a fact you check once.

### A.3 Backend and API work

- New router at `/admin/art-infra`, six screens' worth of endpoints behind
  `manage_art_infra` (see the six-screen table in the design spec).
- Rewire `GET /founder/store` to be DB-backed: return only `published`
  products whose `visible_tracks` contains the founder's track, with the
  resolved vendor/category/datasheets/rating/`in_shortlist_qty`/`can_review`/
  `my_review` shape the founder components already expect (see the shapes the
  Phase 1 mock's `founderView` produces — that is the contract, not an
  implementation detail to redesign).
- Add `POST /founder/store/{slug}/review` `{rating, body}` — creates a
  `pending` review, permitted only when the product is in the founder's
  shortlist (Decision 8 in the spec: reviews require shortlisting first, as a
  weak-but-honest engagement proxy).
- **Remove** `POST /founder/store/quote-request`. The quote-request path is
  replaced entirely by "Show contact," which ships the vendor contact block
  inside the `GET /founder/store` payload (authenticated founders only) so
  the button becomes a UI disclosure with no network call, no request row, and
  no permanently-stuck "Quote requested ✓" state.
- New narrow role `infra_manager`, holding `manage_art_infra` and
  `moderate_art_infra_reviews`, added to **both** `backend/app/rbac.py` and
  `frontend/src/lib/rbac.js`. `admin` gets both capabilities too —
  `infra_manager` gets nothing else (no applications, no decisions, no user
  management). These two files are hand-synced today and have drifted before;
  ship a mirror test in the style of `tests/test_status_machine_mirror.py`
  that parses the JS literal and diffs it against the Python map per role,
  failing on drift. Do not ship the role without that test — it is the whole
  reason the spec calls it out as a required companion, not a nice-to-have.
- A Supabase storage bucket for datasheet files, with signed-URL reads (the
  same pattern as other private-bucket reads in this codebase — resolve
  `storage_path` to a signed URL at read time, do not serve `storage_path`
  directly).

---

## B. Mock-only couplings that will break on a real API

Phase 1's mock (`artInfraMock.js`) is synchronous, in-memory, and cannot
reject in ways a real network client will. Several screens were built in a
way that only works because of that. Fix these while wiring Phase 2 — do not
carry the shape forward and discover the breakage in staging.

### B.1 The product editor round-trips the READ model as the WRITE payload

The editor loads a product via `getProduct`, which returns the **admin read
model** — it carries resolved `vendor`/`category` objects (not just ids),
`rating`, `pending_reviews`, and `datasheet_count`. The editor puts that
entire object into form state and calls `saveProduct(form)` on save. This
works in Phase 1 only because the mock's write path is
`Object.assign(existing, patch)` — extra fields are silently absorbed and
overwritten fields just win.

A real `PATCH /admin/art-infra/products/{id}` will not behave this way: it
will either 422 on unexpected fields (`vendor`, `category`, `rating`,
`pending_reviews`, `datasheet_count` are not writable columns) or, worse,
silently accept and persist junk into columns that don't exist as write
targets. **Fix:** separate the read shape from the write shape before wiring
the real endpoint. Build the PATCH payload explicitly from the editable
fields (`name`, `slug`, `blurb`, `description`, `vendor_id`, `category_id`,
`type`, `pricing`, `price`, `lead_time_weeks_min/max`, `specs`, `status`,
`sort`, `visible_tracks`) rather than spreading the loaded object.

### B.2 No out-of-order async guards on five loaders

None of the following guard against a slow earlier request resolving after a
faster later one: the catalog list, the product editor's two loaders (product
+ reference data), the vendors screen, the categories screen, the reviews
screen, and the insights screen. This is free against the mock because every
mock call resolves synchronously (wrapped in `Promise.resolve`), so requests
always resolve in the order they were issued.

The catalog list is the worst of the five: it re-fires on every keystroke
(see B.3), so under real network latency a slow response to an early
keystroke can land after — and overwrite — the fast response to a later one,
leaving the screen showing results for a filter the user already changed away
from. Fix with a request-id or `AbortController` guard on state commits
before wiring these against a real client.

### B.3 The catalog issues two `listProducts` calls per keystroke, undebounced

The catalog list fetches once with the active filters (for the visible rows)
and once unfiltered (to compute the total count), on every keystroke, with no
debounce. Confirmed correct in code review — the unfiltered call really is
unfiltered, so the "N of 12" count is honest — but it is also genuinely two
full list calls per keystroke. Free against a synchronous in-memory mock;
against a real API this doubles every list request the catalog screen makes.
Debounce the search input and/or fetch the total once (or only when a
non-search filter changes) when wiring Phase 2.

### B.4 Unguarded mutation calls the mock cannot reject

The mock can reject (`saveVendor`/`saveCategory`/`deleteVendor` etc. do throw
on validation failures, and the UI does handle those specific cases — see the
"still used by a product" refusal message on vendor/category delete). But
several call sites assume success and have no generic rejection handling
beyond that one hard-coded case: vendor save, category add, category move,
the founder's `setQty`, and the founder's `submitReview`. A real network call
can fail for reasons the mock never can — timeout, 500, session expiry, 409
from a concurrent edit — and none of these call sites currently have a
generic error path. Add one before wiring the real client; do not rely on the
one specific refusal string the mock happens to produce today.

### B.5 `setShortlistQty`'s internal `this` reference

`artInfraMock.setShortlistQty` implements the qty-drops-to-zero case by
calling `this.removeFromShortlist(productId)` internally. That only works
when the method is invoked through the store object (`store.setShortlistQty(...)`)
— which every Phase 1 call site does, deliberately, per the ledger's mitigation
note. It breaks the moment a caller destructures the store
(`const { setShortlistQty } = store`) or passes the method as a bare callback
(`onChange={store.setShortlistQty}`), because `this` is then `undefined`. The
real Phase 2 client must not reproduce this shape — implement
`setShortlistQty`'s zero-qty path as a plain function call
(`removeFromShortlist(productId)`, not `this.removeFromShortlist(...)`), or
as a standalone module function, so it survives destructuring.

---

## C. Deliberately deferred features

Cut from Phase 1 on purpose. Each was cut for a specific reason — do not
re-add any of these to a "Phase 1 was incomplete" bug list.

| Feature | Why deferred |
|---|---|
| **Bulk publish/retire** on the catalog list | The spec calls for it, and Phase 1 shipped per-row publish/retire instead. This is a genuine feature (multi-select state, a batch action, a confirmation step) — not a wiring gap that Phase 2 endpoint work incidentally closes. Budget it explicitly. |
| **CSV import/export** | Meaningless against an in-memory mock that resets on every reload — there is nothing durable to export and no persisted destination to import into. Also unjudgeable in a UI-only review: a non-engineer looking at a preview cannot tell a working CSV pipeline from a fake one. Needs the real database. |
| **Audit writes** (`write_audit` → `audit_log_v2`) | Same reason as CSV: an audit trail over a store that discards all state on reload proves nothing and cannot be reviewed by looking at the screen. Needs the real database and the real `write_audit` call, wired alongside every admin mutation in Phase 2. |
| **Datasheet upload** in the product editor | There is no storage bucket in Phase 1 — nothing to upload *to*. The editor has no datasheet manager at all. The founder-facing modal renders two sample datasheets (see Section D) purely so the reviewer can judge how that section of the modal looks; the admin side that would create real datasheet rows does not exist yet. Needs the Phase 2 storage bucket (A.3) before it can be built. |
| **Capability gate on the Art Infra tab** | Every admin currently sees the Art Infra tab regardless of role, because the `infra_manager` role does not exist yet — there is nothing to gate against. The gate arrives together with the role and its mirror test in Phase 2, not before. |
| **Status, sort, and `visible_tracks` controls in the editor** | The editor has fields for everything else, but not these three. `status` is instead driven by the catalog list's per-row publish/retire action; `sort` and `visible_tracks` have no UI control anywhere yet. All three exist as real columns in the Phase 2 schema (A.1) — add the controls when the editor is wired to the real API, since a mock-only sort/visibility control has nothing meaningful to demonstrate. |

---

## D. Mock-only sample data — do not seed this into Phase 2

**This is the single easiest thing for a future implementer to get wrong.**
State it once, plainly: the Phase 1 mock contains fictional sample data whose
only purpose is to keep certain admin screens from looking empty during UI
review. None of it is real, none of it should survive into the Phase 2
migration seed, and the design spec is explicit that the seed must NOT
include it.

What the mock contains and why:

- **Sample reviews** (`SAMPLE_REVIEWS` in `artInfraMock.js`) — four
  fabricated reviews (two approved on product `c1`, one pending on `c3`, one
  pending on `c2`) attributed to fake founders (Rhea Nair/AuralDx, Ishan
  Gupta/BreatheAI, Meera Rao/GridSense, Arjun Shetty/CardiaLoop) who do not
  exist in the system. They exist so the review moderation queue has rows to
  show and so the founder card/modal rating line has something to render in
  the preview.
- **Sample datasheets** (`SAMPLE_DATASHEETS`) — three fake datasheet entries
  on products `c1` and `c2`, pointing at `https://example.org/...` URLs that
  do not resolve to real files. They exist purely so the modal's "Datasheets
  & docs" section renders and can be judged visually.
- **Seeded shortlist lines** — added during the final fix wave so the
  insights screen (topShortlisted / neverShortlisted) is not trivially empty
  in the preview.

**The migration deliberately seeds none of this**, per the design spec's
"Seeding" section:

- **No reviews are seeded.** They were fiction to begin with, and seeding
  fictional reviews defeats the entire point of Decision 3 (real,
  founder-written, admin-moderated reviews). A migration that seeds fake
  reviews would ship the exact problem — "Reviews are fabricated" — that this
  project exists to fix.
- **No datasheets are seeded.** The current production entries are `{kind,
  name}` pairs with no file behind them — the original dead end this project
  replaces. Seeding them (even without files) preserves that dead end instead
  of closing it. The datasheet section is designed to hide itself when a
  product has zero datasheets, precisely so an admin uploading a real file is
  what makes the section appear, rather than a placeholder that looks real
  but isn't.

If a future implementer copies `SAMPLE_REVIEWS` or `SAMPLE_DATASHEETS` into
the migration's seed data "to match what the preview showed," that is a
regression, not a completion of the work.

---

## E. Known small items still open

Two minor findings from the Phase 1 execution ledger, deliberately left
unfixed because they are cosmetic/coverage gaps rather than behavioral bugs.
Worth a glance when Phase 2 next touches these files, but not worth a
dedicated fix pass on their own.

| Item | Location | Detail |
|---|---|---|
| Misleadingly named test | `AdminTabBar.test.jsx` | A pre-existing test titled "renders the seven tabs in order" filters by an explicit 7-label regex rather than counting tabs, so it stayed green after Art Infra added the 8th tab. It is not wrong, just misnamed — rename (and consider switching to a count-based assertion) next time this file is touched. |
| Untested "Publish" branch | Catalog list row action | All 12 fixture products start `published`, so the row action's "Publish" branch (the inverse of "Retire") is logically present and reviewed as correct, but no test in Phase 1 ever exercises it — every test that touches status starts from a published row and retires it. Add a draft-status fixture row (or a test-local override) to cover the Publish path when this screen is next modified.

---

## Cross-reference: where each item came from

- Section A: design spec's "Target data model," "Admin surface," "Founder-side
  changes," "Access control," and "Delivery sequence" (Phase 2) sections.
- Section B: ledger findings on Task 2 (`saveProduct`/`setShortlistQty`), Task
  6 (catalog double-fetch, phase-2 note), Task 7 (out-of-order async, deferred
  minor).
- Section C: design spec's "Admin surface" (four operational features) and
  "Out of scope," cross-checked against the final whole-branch review's
  recorded spec deviation (no bulk action shipped).
- Section D: design spec's "Seeding" section and the Phase 1 plan's Global
  Constraints ("Mock ≠ seed").
- Section E: ledger entries for Task 5 (AdminTabBar) and Task 6 (Publish
  branch coverage).
