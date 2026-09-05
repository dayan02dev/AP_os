# Vendor portal Phase 1 — build notes

**Date:** 2026-09-05 · **Branch:** `feat/art-infra-admin` · **Spec:** `2026-09-04-vendor-portal-design.md`

Decisions taken during the build that a reader of the spec and the plan alone
would not predict. Process detail is omitted; this is only what changes what
Phase 2 should do.

## Where the implementation departs from the plan

**Disclosure is per-vendor, and that beat the contract's own wording.** The
spec's contract rule 1 described a per-product `contact_state`; Decision 4
promises approval unlocks the whole vendor. They disagreed. Implemented per
Decision 4 — `contact_state` is `approved` whenever any approved request exists
for that vendor, and vendor-level approval **wins over** the product's own
request row, so an older decline cannot mask a vendor unlocked elsewhere. The
spec has been amended. Build the behaviour, not the original sentence.

**Six spec fields are `text` despite naming quantities.** `sensors.channels`,
`sensors.snr`, `sensors.interface`, `prototyping.turnaround`,
`fabrication.materials`, `software.seats`. The catalog's real values embed units
and lists — `"68 dB(A)"`, `"TDM / PDM"`, `"Al 6061, ABS, PC"`. Typing them
`number`/`multi_enum` made every seeded product fail validation and let an
editor silently blank a real value on save. Do not "fix" this by normalising the
values: that fabricates data the catalog never had.

**Nothing in the seeded registry is `required`.** Required-ness is fully
implemented and tested; it is simply not switched on, because no single field is
populated across every product in some categories. Turning it on retroactively
would invalidate existing products, which the spec's own field-change policy
forbids.

**The admin product editor survives**, though the spec's six-screen table omits
one. All 11 seeded vendors are unclaimed (`user_ids: []`), so no vendor login can
author their 12 products, and the spec says unclaimed records "keep working
exactly as now". Deleting it would strand the seeded catalog with no author.
**This is an open question for sign-off:** if admins should never author, the
right fix is not deleting the screen but building Decision 10's "invite to
claim" as the handover path. Note the admin surface has no product create/update
endpoint in the API contract — that hole needs closing either way.

**Suspending a vendor removes its products from the founder catalog and
shortlist**, not just from new listings. The spec calls suspension "one lever
that darkens everything a vendor lists"; that is now literally true.

## Traps for Phase 2

**Vendor contacts are empty in the fixture by design.** The generator invents no
contact data. The mock's `sales@<vendor>.example` placeholders exist only so the
approved state is demonstrable in review. Reusing the generator for migration
046's seed and copying those across ships fiction as fact.

**`SAMPLE_REVIEWS` is fiction too** — two reviews attributed to founders who do
not exist. Never seed them.

**`validateSpecs` throws if handed raw registry rows.** It requires
`describeFields()` output, and enforces that rather than trusting the caller.
Passing the raw registry would silently enforce archived-but-required fields
against products that never had them.

**Write payloads reject unknown fields.** Every form builds its PATCH from an
explicit writable list. Spreading a loaded read model fails immediately — which
is deliberate, because a real `PATCH` would either 422 or persist junk.

**Contract holes the mock papers over.** `withdrawRequest` exists with no UI
calling it, so lifecycle step 4 is unexercised. There are no datasheet methods
(`db.datasheets` is always empty). `getVendorMe` returns no `completeness`.
There is no `GET /products/{id}` — the admin editor fetches the whole catalog
and finds by id.

**No live cross-portal updates.** `FounderStore` refetches on mount and after
the founder's own actions. An approval made elsewhere while the page sits open
needs a reload. Real navigation remounts and refetches, so it only bites a page
left open — but Phase 2 should pick a refetch strategy.

## Two known taxonomy smells, deliberately left

`software` carries 19 fields while each of its four products fills about four —
a compiler toolchain, an annotation platform, GPU credits and a QMS genuinely
share almost nothing. That is a signal `Software` is doing the work of several
categories. Splitting it is a design conversation, not a bug fix.

`prototyping` has 12 fields for two products, for the same reason.

## Migration numbering (settled 2026-09-06)

`feat/vip-onboarding` holds 043-045 (staging only; production is at 042), so 046
was the next free number. It is now taken by **`046_vendor_role.sql`** — the
CHECK-constraint widening that lets `user_roles.role` hold `vendor`, plus a grant
to a test account. That is the only schema change the Phase-1 portal needs.

**The catalog migration therefore becomes `047_art_infra_catalog.sql`**, not 046
as the design spec says. Re-check both numbers at merge time: this exact
collision already happened once on 037/038/039.

Verified on staging 2026-09-06 before writing 046: `user_roles_role_check`
accepted exactly applicant, founder, reviewer, jury, mentor, leadership, admin,
and rejected `vendor` and `infra_manager` with 23514. `user_roles_pkey` is a
composite key on `(user_id, role)`, so `on conflict (user_id, role)` is safe.
None of the six `art_infra_*` tables exist on staging.
