# Art Infra admin portal — design

**Date:** 2026-09-02
**Branch:** `feat/art-infra-admin` (off `release/sip-launch-v1` @ `a8c00f2`)
**Status:** approved in brainstorm; UI sample first, schema and endpoints after sign-off

## Problem

The Founder Portal's five Founders Resources tabs render from hardcoded Python
constants in `backend/app/services/founder_catalog.py` (386 lines), transcribed
verbatim from the original design mockup. The database stores only the
per-founder overlay — cart rows, requests, bookings, tickets.

Art Infra is the richest of the five: 12 products, 11 vendors, 8 categories,
plus specs, datasheets and reviews. Nobody at ARTPARK can add a vendor, correct
a price or retire a discontinued part without a backend deploy.

The founder-facing UI also promises things nothing delivers:

1. **Datasheets have no file.** `{kind, name}` only — the "Datasheets & docs"
   section lists names that cannot be opened.
2. **Quote requests go nowhere.** `POST /founder/store/quote-request` writes a
   `founder_resource_requests` row no admin surface reads. The button then reads
   "Quote requested ✓" permanently.
3. **Reviews are fabricated.** Static testimonials from people who do not exist
   in the system, driving a star rating on every card.
4. **The catalog cannot change without a deploy.** The reason for this project.

A fifth apparent gap is not one: `push-to-procurement` writes
`founder_procurement_items` with `quote: 0, lead_weeks: 0`, but that table is the
founder's *own* Expense-management tracker, editable by them via
`PATCH /founder/procurement/{id}`. It is correct as built.

## Operating model

**Art Infra is a curated directory, not a procurement service.** ARTPARK curates
trusted vendors and negotiated pricing; founders transact with vendors directly.
There is no fulfilment queue and no inbound request queue. This decision governs
everything below.

## Decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | Curated directory only | Admin surface is a CMS, not a fulfilment queue |
| 2 | "Request quote" → "Show contact" | Drop the quote request path; add vendor contact fields |
| 3 | Real founder reviews, admin-moderated | New reviews table, founder write path, moderation queue |
| 4 | New narrow `infra_manager` role | Least privilege; RBAC mirror test required |
| 5 | Vercel preview + mock data for the sample | No DB or backend work before UI sign-off |
| 6 | Approach C — purpose-built, reusable machinery | `art_infra_*` tables; shared lifecycle/sort/audit/upload/preview modules |
| 7 | "Cart" → "Shortlist" | Copy-only change; `push-to-procurement` button text unchanged |
| 8 | Reviews require the product to be shortlisted | Weak-but-honest engagement proxy |
| 9 | No database changes until the UI is approved | Spec sequences UI sample first |

### Why not a generic Founders Resources CMS

ArtConnect, ArtPartners and Art Assets share the same hardcoded-constant problem,
which makes a single `resource_items` table with a `kind` discriminator tempting.
Rejected: Art Infra is the only tab with vendors, specs, downloadable datasheets
and reviews. A schema loose enough to hold investors, partners, assets and
products holds none of them well, and every consumer would need to know which
fields are meaningful for which kind.

Instead the parts that are genuinely common — publish lifecycle, sort ordering,
audit writes, file attachments, preview-as-founder — are built as shared modules
from day one. The remaining three tabs each get a small purpose-shaped table and
reuse all of that machinery.

## Current surface (what we are replacing)

### Product datapoints, 12 rows, ids `c1`–`c12`

| Field | Type | Values |
|---|---|---|
| `id` `name` `vendor` | str | 11 distinct vendors |
| `cat` | enum | Sensors, Boards, Compute, Prototyping, Fabrication, Components, Power, Software |
| `type` | enum | Hardware (8) / Software (4) |
| `pricing` | enum | fixed (8) / quote (4) |
| `price` | int rupees | ₹1,800 – ₹60,000 |
| `blurb` / `desc` | str | card line / modal paragraph |
| `specs[]` | list | `{k, v}` — exactly 4 per product |
| `datasheets[]` | list | `{kind, name}` — 1–2 per product, no file |
| `reviews[]` | list | `{name, company, rating, text}` — 1–2 per product |

Derived per founder on read: `in_cart_qty`, `quote_requested`.

### Endpoints, all behind `require_founder_access`, scoped to `application_id`

- `GET /founder/store` → `{catalog[], cart[], cart_subtotal}`
- `POST /founder/store/cart` `{product_id, qty≥1}` — upsert, adds to existing qty
- `PATCH /founder/store/cart/{product_id}` `{qty≥0}` — qty 0 deletes the line
- `DELETE /founder/store/cart/{product_id}`
- `POST /founder/store/quote-request` `{product_id}` — idempotent
- `POST /founder/store/push-to-procurement` — drains cart into `founder_procurement_items`

### Tables

`founder_cart_items` · `founder_resource_requests` (kind: quote/intro/partner) ·
`founder_procurement_items` (category: BOM/Equipment/Other/Service).

## Target data model

Migration `046_art_infra_catalog.sql`.

**Numbering caveat:** 043–045 are claimed by `feat/vip-onboarding` (staging only;
production is at 042). 046 is free only while that branch keeps its numbers. This
is how 037/038/039 collided during the Founder Portal build — re-check at merge.

```sql
art_infra_vendors
  id uuid pk, name text unique not null,
  contact_name, contact_email, contact_phone, artpark_ref text,
  notes text, created_at, updated_at

art_infra_categories
  id text pk (slug), label text not null, sort int default 0

art_infra_products
  id uuid pk, slug text unique,
  name, blurb, description,
  vendor_id   -> art_infra_vendors,
  category_id -> art_infra_categories,
  type    check ('Hardware','Software'),
  pricing check ('fixed','quote'),
  price int,                          -- integer rupees, null when pricing='quote'
  lead_time_weeks_min int, lead_time_weeks_max int,
  specs jsonb default '[]',           -- [{k,v}], display-only, variable length
  status check ('draft','published','retired') default 'draft',
  sort int default 0,
  visible_tracks text[] default '{tir}',
  created_by, created_at, updated_at

art_infra_datasheets
  id uuid pk, product_id -> art_infra_products on delete cascade,
  kind, name, storage_path, external_url, sort, created_at,
  check (storage_path is not null or external_url is not null)

art_infra_reviews
  id uuid pk, product_id -> art_infra_products on delete cascade,
  application_id uuid, rating int check (rating between 1 and 5), body text,
  status check ('pending','approved','hidden') default 'pending',
  moderated_by uuid, moderated_at timestamptz, created_at,
  unique (product_id, application_id)
```

Three deliberate calls:

- **`lead_time_weeks` becomes real columns.** Today it lives inside `specs` as the
  free-text string `"Lead time: 3–4 weeks"`, so it cannot be filtered or sorted.
  `specs` stays jsonb because it is genuinely display-only and varies per product.
- **`founder_cart_items.product_id` migrates from text (`'c1'`) to a uuid FK.**
  The table has zero rows in production, so a proper foreign key is free now and
  expensive later.
- **`founder_resource_requests` keeps its `quote` enum value.** We stop writing it.
  Removing a check-constraint value gains nothing and risks the intro/partner rows
  that share the table.

### Seeding

The 12 products, 11 vendors and 8 categories migrate over as `status='published'`.

**Reviews are not seeded** — they were fiction, and seeding them defeats the point
of collecting real ones. **Datasheets are not seeded** — the current entries are
names with no file behind them; seeding would preserve the dead end. The
datasheets section hides itself when a product has none, until an admin uploads
real files.

## Admin surface

Six screens behind `manage_art_infra`, at router prefix `/admin/art-infra`.

| Screen | Contents |
|---|---|
| **Catalog list** | Products table: name, vendor, category, price, status, pending-review count. Filter by status/category/type/vendor, search, bulk publish/retire. Uses the shared `ListToolbar` from `a8c00f2` so it matches every other list screen. |
| **Product editor** | All fields, specs repeater, datasheet upload, vendor picker, and a live preview-as-founder pane rendering the real founder card and modal from draft data. |
| **Vendors** | CRUD including the contact block that "Show contact" reveals. |
| **Categories** | CRUD plus sort order. |
| **Review moderation** | Pending queue — product, founder name and venture, rating, body → Approve / Hide / Delete. |
| **Insights** | Shortlist counts per product, most- and never-shortlisted, mean approved rating. Aggregated over `founder_cart_items`. |

Four operational features that are not screens:

- **Draft / published / retired lifecycle** so nothing half-written reaches founders.
- **Sort ordering** to control grid position.
- **CSV import/export** for bulk price updates — negotiated prices change more
  often than the product list does.
- **Audit writes** through the existing `write_audit` into `audit_log_v2`, making
  every price change attributable.

**Preview-as-founder is the highest-value feature.** It is the only thing that
stops admins editing blind, and it is cheap because it mounts the founder
components directly against draft data.

## Founder-side changes

`GET /founder/store` becomes DB-backed, returning only `published` products whose
`visible_tracks` contains the founder's track.

- **"Request quote" → "Show contact".** The vendor contact block ships inside the
  store payload (authenticated founders only), so the button is a UI disclosure,
  not a network call. No new endpoint, no request row, no stuck "Quote requested ✓".
  `POST /founder/store/quote-request` is removed.
- **Reviews become writable.** `POST /founder/store/{slug}/review` `{rating, body}`
  creates a `pending` review, permitted only when the product is in the founder's
  shortlist. The author always sees their own review while pending; everyone else
  sees only `approved` ones.
- **Star ratings become honest.** Card rating is the mean of approved reviews. With
  none, the rating line hides rather than rendering `★ 0.0 · 0 reviews`.
- **Datasheets hide when empty.**
- **"Cart" → "Shortlist"** throughout. The `push-to-procurement` button keeps its
  wording, because it genuinely pushes rows into the procurement tracker.

`push-to-procurement` behaviour is otherwise unchanged.

## Access control

New role `infra_manager` holding `manage_art_infra` and
`moderate_art_infra_reviews`. `admin` receives both as well — an admin should not
be locked out of a surface they are accountable for. `infra_manager` gets nothing
else: no applications, no decisions, no user management.

`rbac.py` and `frontend/src/lib/rbac.js` are hand-synced and have drifted badly
before. This ships with a mirror test in the style of
`test_status_machine_mirror.py`: parse the JS literal, diff per role, fail on drift.

## Delivery sequence

The database is untouched until the UI is signed off.

**Phase 1 — UI sample (this phase only, then stop).**
Branch `feat/art-infra-admin` builds a Vercel preview. All six admin screens plus
the reworked founder Art Infra page, rendering from a mock fixture seeded with the
real 12 products, 11 vendors and 8 categories. State held in React. No backend, no
migration, no staging deploy, no row written anywhere.

**Phase 2 — schema and endpoints (only after approval).**
Migration 046, admin router, founder endpoint rewire, RBAC role and mirror test,
storage bucket for datasheets, then staging.

## Testing

- Pure merge/derivation helpers unit-tested directly, following the existing
  `founder_resources_query.py` pattern.
- RBAC mirror test for `infra_manager` across `rbac.py` ↔ `rbac.js`.
- Frontend component tests for the six admin screens against the mock fixture.
- Review eligibility (shortlisted-only) and moderation visibility tested explicitly:
  author sees own pending review, others do not.
- Known baseline: roughly 20–22 pre-existing backend test failures unrelated to any
  change. Verify against untouched `release/sip-launch-v1` before attributing.

## Out of scope

- ArtConnect, ArtPartners, Art Assets and Art Support content management. They
  reuse this machinery in later projects.
- Any fulfilment, ordering or payment flow.
- VIP track exposure. `visible_tracks` exists so enabling it later is a data
  change, but VIP is not wired here.
