# Vendor portal + three-portal Art Infra — design

**Date:** 2026-09-04
**Branch:** `feat/art-infra-admin` (off `release/sip-launch-v1` @ `a8c00f2`)
**Status:** approved in brainstorm; UI + API contract this phase, schema and backend after sign-off

## Problem

Art Infra Phase 1 shipped six admin screens and a reworked founder page, all
rendering off an in-memory mock. It was designed as a **curated directory**:
ARTPARK admins author the catalog, founders see vendor contacts on demand, and
nobody transacts through the platform.

Three things that model does not do:

1. **Vendors cannot maintain their own listings.** An admin retypes every
   product, price and spec. The vendor — the only party who actually knows the
   lead time and the tolerance — has no way in.
2. **Every product has the same four spec fields.** `specs` is a free-text
   `[{k,v}]` array, so a sensor and a CNC service are described with the same
   shapeless list. Nothing can be filtered, validated, or required.
3. **Contact disclosure is ungoverned.** "Show contact" reveals a vendor to any
   founder who clicks it. ARTPARK has no record of who asked for what, and no
   say in it.

## What this supersedes

This design **reverses two binding decisions** in
`2026-09-02-art-infra-admin-portal-design.md`. Recorded explicitly so the change
is deliberate rather than forgotten:

| Superseded | Was | Now |
|---|---|---|
| Operating model | "There is no fulfilment queue and **no inbound request queue**. This decision governs everything below." | There *is* an inbound request queue: founder requests, admin approves |
| Decision 2 | "Request quote" → "Show contact"; `POST /founder/store/quote-request` removed | "Show contact" → **"Request contact"**; an admin-approved request is what discloses |

The operating model moves from *curated directory* to **brokered introduction**.
ARTPARK still never transacts — no payment, no invoice, no fulfilment — but it
now mediates who is introduced to whom.

The original Phase 2 (migration `046`, admin router) was **never built**. There
is no database, no router, no `art_infra_*` table anywhere. That is fortunate:
the schema it specified assumed admin-authored products with a fixed `specs`
blob and no vendor identity, all of which change here. Nothing has to be undone;
the schema simply gets written once, later, with vendors in it.

## Scope of this phase

**UI and API contract only.** Three portals, one shared mock, every route
defined and none implemented. No migration, no router, no RBAC change, no
storage bucket, no deploy beyond the existing Vercel preview.

The data model in §5 exists to keep the API shapes honest. It is **not** built
in this phase and its DDL is indicative, not final.

## Decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | Requester is the **founder** population, unchanged | No new audience; the founder portal's Art Infra page is the surface |
| 2 | Vendors are **invited by an admin**, never open signup | Reuses the reviewer-invite flow; keeps the public attack surface closed |
| 3 | Vendor-authored products **require admin approval** to publish | Admin catalog screen becomes a moderation surface |
| 4 | A request is **per product**; approval unlocks **that vendor** | Specific enough for admin to judge, coarse enough to avoid re-approving every SKU |
| 5 | The vendor is **passive** — never notified, never sees the founder | No vendor inbox; no founder identity leaves ARTPARK |
| 6 | Reviews are **vendor-level**, earned by an approved request | Card ratings become vendor ratings across all their listings |
| 7 | The shortlist **stays as built**; Request is a separate per-row action | Push-to-procurement and the expense-tracker handoff are untouched |
| 8 | Spec fields are **data, not code** — a registry drives forms and validation | Adding a field is a data change, never a deploy |
| 9 | Vendor↔user link is **one-to-many** from day one | A company is not a person; two people at one vendor must not share a login |
| 10 | Legacy vendors start **unclaimed** (nullable user link) | The 11 seeded vendors keep working; "invite to claim" hands over authorship |

### Why not open vendor signup

Tempting for reach, rejected on risk. `dayan02dev/AP_os` is a public
repository, and on 2026-08-19 a throwaway-inbox actor fuzzed 246 routes and
attempted to self-grant admin — the reason `/auth/request-otp` now blocks
disposable domains. A public vendor registration route reopens that surface and
buys a spam-vetting queue nobody has agreed to staff. An admin who invites a
vendor has already done the vetting that open signup would need a process for.

## Actors, roles and portal boundaries

> **Target state, not this phase's work.** This section defines the identity
> model the UI is designed against. None of it is built here — see Scope. The
> mock's view-as-vendor switch stands in for all of it. It is specified now
> because the screens and the API contract are meaningless without knowing who
> may call what.

**One new role: `vendor`**, holding vendor-scoped capabilities only — manage its
own profile, manage its own products. No applications, no founders, no other
vendors' rows.

Vendors are the first genuinely **external commercial party** in this system.
Reviewers, jury and mentors are outsiders, but they are ARTPARK-adjacent people
looking at ARTPARK data. A vendor is a company with a commercial interest; if
the boundary leaks, founder identities and pipeline data reach a supplier. The
boundary is therefore enforced twice: capability checks in `rbac.py`, and RLS
scoping every `art_infra_*` row a vendor can reach to its own `vendor_id`.

**Admin capabilities.** The originally-specified `infra_manager` role gains two
more alongside `manage_art_infra` and `moderate_art_infra_reviews`:
`approve_art_infra_vendors` and `approve_art_infra_requests`. `admin` holds all
four.

**The RBAC mirror test is mandatory, not optional.** `rbac.py` and
`frontend/src/lib/rbac.js` are hand-synced and have drifted badly before. With a
role gating an external party, drift is a security bug rather than a UI
annoyance. Ship the mirror test with the role, in the style of
`tests/test_status_machine_mirror.py`.

**Routing.** New `/vendor` route. Vendors do not appear in `PortalSwitcher` —
it lists *staff* portals an account can reach and already hides itself below two
options, so it needs no change.

## Vendor registration fields

The governing constraint is that **ARTPARK never transacts**. That single fact
removes most of what a marketplace onboarding form collects. The test applied to
every field: *does this change what a founder or an admin can actually do?*

### Required

| Field | Justification |
|---|---|
| `legal_name` | Appears on the contract the founder eventually signs |
| `display_name` | Trade name on cards — "Knowles", not the holding-company name |
| `website` | Highest-signal credibility check an admin has |
| `contact_name`, `contact_email`, `contact_phone` | This *is* the deliverable — what approval discloses |
| `city`, `state`, `country` | Drives shipping reality and lead time |
| `capabilities` | What they do, in their words; admin triage and founder context |
| `categories_served` | Which of the 8 categories they supply; scopes their product forms |

### Optional, prompted, never blocking

`gstin` · `udyam_number` · `cin` · `certifications` (repeating list)

**GSTIN** earns its place because a founder buying equipment needs a GST invoice
to claim input tax credit — a vendor without one is materially different to buy
from. It stays optional because small proprietorships below the registration
threshold legitimately will not have one.

**Certifications are a list, not booleans.** ISO 13485 is the medical-device
QMS standard, and several ARTPARK founders build medical devices; for them it is
a gating question. Booleans would force a schema change per standard.

### Deliberately excluded

| Field | Why not |
|---|---|
| Bank account / IFSC | ARTPARK never pays the vendor. Pure liability, zero feature. Founder bank details are already DB-only and never emailed; holding a vendor's would be worse — PII with no reason to exist |
| PAN | No payment means no TDS and no reporting. GSTIN already embeds the PAN |
| Verification document uploads | Theatre. An admin vetted this vendor by inviting them. Certificate scans create a review burden nobody will sustain |
| IEC (import/export code) | Only meaningful if ARTPARK were importing. It is not |

**Unverified claims.** GSTIN is 15 characters (state code + PAN + entity code +
`Z` + checksum); Udyam replaced Udyog Aadhaar for MSME registration; ISO 13485
is the medical-device standard. Current **GST registration thresholds were not
verified** and this spec deliberately asserts no number — nothing in the design
depends on the threshold, only on GSTIN being optional.

### Vendor lifecycle

`invited` → `registered` (profile submitted) → `approved` → optionally
`suspended`.

Products reach `published` only while their vendor is `approved`. Suspension is
therefore one lever that darkens everything a vendor lists.

## Data model (indicative — not built this phase)

### The spec-field registry

The mechanism behind "the fields change depending on the product".

```sql
art_infra_spec_fields
  id            uuid pk
  category_id   -> art_infra_categories
  key           text            -- machine key: 'snr', 'tolerance_mm'
  label         text            -- 'SNR', 'Tolerance'
  data_type     check ('text','number','enum','multi_enum','boolean')
  unit          text null       -- 'dB(A)', 'mm', 'W'
  enum_options  text[] null
  required      boolean default false
  filterable    boolean default false
  help_text     text
  sort          int
  archived_at   timestamptz null

  -- Partial: an archived field must not block re-adding its key, but two LIVE
  -- fields sharing a key would make `specs` ambiguous.
  unique (category_id, key) where archived_at is null
```

**Keyed to category, not to product type.** Hardware/Software cuts across
categories badly, and Software is already its own category, so keying to both
would double the rows for no gain.

**Five data types; three cut.** `text`, `number`, `enum`, `multi_enum`,
`boolean`. `multi_enum` exists solely because Fabrication needs "materials:
aluminium, steel, Delrin", and forcing that into free text destroys the one
service attribute a founder would filter on. `range`, `date` and `file` are cut
from v1.

**`specs` changes shape.** From a display-only array `[{"k":"SNR","v":"68 dB(A)"}]`
to an object keyed by field key, `{"snr": 68, "interface": "TDM / PDM"}`, with
labels, units and ordering resolved from the registry at render time. Renaming a
label then fixes it everywhere at once, and a number stays a number.

### Field-definition change policy

These are rows, so the usual DDL protections do not apply. The policy:

- **Adding a required field does not retroactively invalidate published
  products.** They are flagged incomplete to vendor and admin and stay live. The
  alternative silently dark-lists a working catalog the moment an admin adds a
  field.
- **Editing label, unit, help text or sort** is free and propagates.
- **Changing `data_type`** is restricted to widening (`enum` → `text`). Anything
  else requires explicit admin confirmation with coercion, because it can orphan
  every existing value.
- **Deletion is a soft delete** (`archived_at`). Values survive in `jsonb` but
  stop rendering. A hard delete destroys data an admin cannot recover from a
  typo.

### Other tables

```
art_infra_vendors        identity + contact block + lifecycle status;
                         nullable one-to-many link to auth users (unclaimed by default)
art_infra_categories     slug, label, sort
art_infra_products       vendor_id (author), category_id, type, pricing, price,
                         lead_time_weeks_min/max, specs jsonb, status
                         (draft|pending_review|published|retired), review_note,
                         sort, visible_tracks
art_infra_datasheets     product-scoped files/links, vendor-uploaded
art_infra_requests       application_id, product_id, vendor_id, note, qty,
                         status (pending|approved|declined|withdrawn),
                         decided_by/at, decision_note
art_infra_vendor_reviews vendor_id, application_id, rating 1-5, body,
                         status (pending|approved|hidden), unique(vendor_id, application_id)
```

`founder_cart_items` (the shortlist) is unchanged.

**Promotion stays a documented mechanism, used sparingly.**
`lead_time_weeks_min/max` are already promoted out of `specs` because free text
could not be filtered or sorted. v1 promotes nothing further; any future
promotion is a deliberate migration.

**Legacy seed.** The 12 seeded products carry free-text specs. Rather than
hand-convert them, extend `backend/scripts/gen_art_infra_fixture.py` — which
already transcribes the catalog mechanically and splits lead time out — to emit
keyed specs against the new field definitions. That generator exists precisely
because hand-transcribing 12 products is how typos enter.

## Request lifecycle

```
founder raises request (product) ──> pending ──> approved  ──> vendor contact disclosed
                                        │                       for EVERY product of that vendor
                                        ├──> declined (with admin reason)
                                        └──> withdrawn (by founder)
```

Disclosure is **derived, not stored**: a vendor's contact is visible to a
founder iff an `approved` request exists for that `application_id` and
`vendor_id`. No separate grant table, nothing to keep in sync.

## The three portals

### Vendor portal — `/vendor`, all new

| Screen | Contents |
|---|---|
| Registration / profile | The field set above. Blocking until submitted; afterwards editable, with identity-field edits flagged for admin re-approval |
| My catalog | Own products only, status chips, and the admin's `review_note` on anything sent back |
| Product editor | **Category picker first** — it determines the form. Spec fields render from the registry; required ones block submit. Reuses the existing preview-as-founder pane |

Category-first ordering is what delivers the requirement: pick Sensors and the
form asks for SNR, channels and interface; pick Fabrication and it asks for
tolerance, materials and MOQ.

### Admin portal — Art Infra tab, reshaped

| Screen | Change |
|---|---|
| Catalog | Authoring → **moderation**. Pending queue, approve / send-back-with-note. Existing filters and row actions survive |
| Vendors | Contact CRUD → **vendor accounts**: invite, approve, suspend |
| Categories | Gains **spec-field management** — nested CRUD, category → fields |
| Reviews | Product-level → **vendor-level** |
| **Requests** *(new)* | Founder request queue: who, which product, their note → approve / decline |
| Insights | Shortlist counts → **request** counts; a request is a far stronger demand signal |

Sub-nav goes from five entries to six.

### Founder portal — Art Infra page

The primary button becomes state-dependent:

| State | Button shows |
|---|---|
| no request | **Request contact** |
| pending | Requested — awaiting approval |
| approved | the vendor contact block, immediately |
| declined | the admin's reason |

Approval scoped to the vendor is what makes this pay off: request one Knowles
product, get approved, and every other Knowles product shows contact without
asking again.

Star ratings become **vendor** ratings, so the same score appears on all of that
vendor's cards. The review form unlocks on an approved request rather than a
shortlist. Specs render with labels and units from the registry. Shortlist,
quantities, subtotal and Push-to-procurement are untouched.

**Highest-risk screen: the spec-field editor.** It is a schema editor with a
non-technical audience; get it wrong and an admin can quietly break every
product form in a category. Expect to iterate on it after review — more than on
the vendor registration form, which is just a long form.

## API contract

Every vendor route is scoped server-side to the caller's own `vendor_id`. None
accepts a vendor id from the client.

### Vendor — `/vendor/*`

```
GET    /vendor/me                          profile + status + completeness
PATCH  /vendor/me
POST   /vendor/me/submit                   → registered, awaits approval
GET    /vendor/categories
GET    /vendor/spec-fields?category_id=    drives the dynamic form
GET    /vendor/products                    own only; ?status= &search=
POST   /vendor/products                    → draft
GET    /vendor/products/{id}
PATCH  /vendor/products/{id}
POST   /vendor/products/{id}/submit        draft → pending_review
POST   /vendor/products/{id}/retire
DELETE /vendor/products/{id}               drafts only
POST   /vendor/products/{id}/datasheets
DELETE /vendor/datasheets/{id}
```

### Admin — `/admin/art-infra/*`

```
GET    /vendors                        POST /vendors/invite
PATCH  /vendors/{id}                   POST /vendors/{id}/approve
                                       POST /vendors/{id}/suspend
GET    /products?status=pending_review
POST   /products/{id}/publish          POST /products/{id}/send-back  {note}
POST   /products/{id}/retire
GET/POST/PATCH/DELETE  /categories
GET    /categories/{id}/spec-fields
POST   /spec-fields                    PATCH  /spec-fields/{id}
DELETE /spec-fields/{id}               → soft, sets archived_at
GET    /requests?status=pending
POST   /requests/{id}/approve          POST /requests/{id}/decline    {note}
GET    /vendor-reviews?status=         POST /vendor-reviews/{id}/moderate {status}
GET    /insights
```

### Founder — `/founder/store*`

```
GET    /founder/store                            catalog + shortlist + request state
POST   /founder/store/requests   {product_id, note, qty?}
DELETE /founder/store/requests/{id}              withdraw
POST   /founder/store/vendors/{vendor_id}/review {rating, body}

  unchanged: /cart, /cart/{id}, /push-to-procurement
  REMOVED:   /founder/store/quote-request
```

### Three contract rules

**1. Contact details must not appear in the payload until approved.**
`GET /founder/store` returns `contact_state` per product
(`none|pending|approved|declined`), and the `vendor.contact` block is present
**only** when that vendor is approved for this founder. The tempting shortcut —
ship contacts always, hide them in the UI — puts every vendor's contact details
in a response any founder can read. This is the one place where a UI decision is
a security decision, and it is cheapest to fix while the contract is a document.

**2. Read and write shapes are defined separately.** Phase 1's product editor
loaded the admin *read* model (resolved `vendor`/`category` objects, `rating`,
`pending_reviews`) and posted it back as the write payload. That worked only
because the mock did `Object.assign`. A real `PATCH` either rejects it or
persists junk. The contract names writable fields explicitly; the read model is
documented read-only.

**3. Spec values are validated server-side; the client is told the rules.**
`GET /vendor/spec-fields` returns definitions so the form can render and
pre-validate, but the server re-validates on submit and on publish. Field
definitions are rows an admin can change between page load and submit, so the
client copy is a convenience, never the authority.

## Design-system conformance

**Tokens only, no new colours:** `--bg` `#f4f1ea`, `--bg-soft`, `--ink` /
`--ink-soft` / `--ink-dim`, `--line` / `--line-strong`, `--accent` `#c84a1a`
(TIR) or `#6B5CFF` (SIP), `--chip`. Radius is `--radius: 2px` on everything.
This system is flat and papery; a rounded card reads as imported from another
product. Serif headings, sans body, mono at 11px for chips.

**Structure** follows one-stylesheet-per-portal: a new `vendor-portal.css`
scoped under a `.vendor-portal` root class, exactly as `art-infra-admin.css`
sits under `.ai-admin`. The bar is the one Phase 1's stylesheet already met:
every emitted class defined, no dead CSS, no bare element selector that can leak
globally.

**Reuse `ListToolbar`** for the vendor catalog list. It exists because there
were once three implementations of one control, which is why an identical track
switcher rendered as a blue pill on one page and a grey square on the next. A
fourth copy repeats that mistake. Reuse `PageHead`, `Chip` and `Stat` from
`osAtoms` likewise.

**One extraction:** `.ai-status-{draft|published|retired}` is currently scoped
under `.ai-admin`, and the vendor portal shows the same statuses. Promote that
block to a shared stylesheet both import — one domain concept, one definition.

**Explicitly not in scope:** the audit lists four missing patterns (`<Modal>`,
`<EmptyState>`, `<Spinner>`, `<Badge>`) and five near-identical file-drop zones.
Building a third portal is a temptation to fix all of it. Where the vendor
portal needs one, copy the closest existing implementation's markup rather than
inventing a variant. Refactoring three portals is separate work.

## Mock design

Phase 1's mock resolved synchronously and could never fail, which is why five
mock-only couplings survived into its carryover document. This mock is built to
catch them locally:

- **Artificial latency with jitter**, so out-of-order responses happen in dev
  rather than in staging
- **Injectable failures**, so every mutation call site needs a real error path
  instead of one hard-coded refusal string
- **Write methods reject unknown fields**, surfacing the read-model-as-write
  -payload bug immediately
- **No `this`** anywhere in the store — standalone functions that survive
  destructuring
- Screens use request-id or `AbortController` guards; search is debounced; the
  unfiltered total refetches only when a non-search filter changes

A **view-as-vendor switch** stands in for vendor auth, which does not exist yet.

## Testing

- Component tests per screen against the mock, following Phase 1's pattern
- **Form generator tested hardest** — registry definitions in, rendered fields
  and validation out. It is the riskiest logic in the build
- **Disclosure rule tested explicitly**: the contact block is *absent from the
  payload* for a founder without an approved request, not merely hidden
- Mock return shapes are the Phase-2 contract; shape assertions become an
  executable spec for the real API
- Known baseline: 2 pre-existing `AdminPipeline` failures unrelated to any
  change, confirmed identical at `a8c00f2`. Verify against an untouched release
  before attributing

## Out of scope

- Any database, migration, router, RBAC change or storage bucket
- Vendor authentication (a view-as switch stands in)
- Vendor notifications of any kind — decision 5 makes the vendor passive
- ArtConnect, ArtPartners, Art Assets, Art Support
- Payment, ordering, fulfilment — ARTPARK still never transacts
- Extraction of the four missing design-system components

## Open items

- **Migration numbering**, when schema work starts: `feat/vip-onboarding` holds
  043–045 (staging only; production is at 042). Treat a free-looking number as a
  claim that expires — 037/038/039 already collided once.
- **The "Show contact" card bug**, open on `4a59d54`: a quote-priced product's
  card button calls `onPrimary` → `addToShortlist`, silently shortlisting
  instead of disclosing. It affects 4 of 12 products. This design replaces that
  button entirely, so the fix lands as part of the rework rather than separately.
- **GST registration thresholds** were not verified. Nothing depends on them.
