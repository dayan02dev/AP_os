# Vendor Portal + Three-Portal Art Infra — UI & Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a clickable Vercel preview containing a new vendor portal, a reshaped admin Art Infra tab and a reworked founder Art Infra page — all rendering from one shared in-memory mock — so the user can approve the UI and the API contract before any schema or backend work begins.

**Architecture:** One mock store (`artInfraMock.js`, rewritten) exposes exactly the method names the real Phase-2 client will expose, so swapping mock for network is a one-line import change per screen. Unlike Phase 1's mock, this one is **deliberately hostile**: every call is genuinely async with jitter, any call can be told to fail, write methods reject unknown fields, and no method uses `this`. Per-category spec fields live in a registry that a single pure form-generator module turns into rendered inputs plus validation — that generator is the riskiest unit in the build and is tested standalone. The founder store serializer enforces the disclosure rule: a vendor's contact block is *absent from the payload*, not merely hidden, until an approved request exists.

**Tech Stack:** React 18, Vite, React Router, Vitest + @testing-library/react, plain CSS scoped per portal. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-vendor-portal-design.md`

## Global Constraints

- **This phase is UI + contract only.** No migration, no backend router, no `rbac.py` change, no storage bucket, no Supabase call. `backend/` is touched in exactly one place: extending `scripts/gen_art_infra_fixture.py`.
- **Never run `git push`.** The repo `dayan02dev/AP_os` is PUBLIC and a push triggers an external Vercel build. The controller pushes, not the implementer.
- **Mock ≠ seed.** Sample reviews, sample datasheets and sample requests exist only so screens are not empty in review. They must never be carried into a Phase-2 migration seed.
- **Copy rules:** the founder-facing word is **"Shortlist"**, never "Cart". The founder's primary button is **"Request contact"**, never "Show contact" or "Request quote". "Push to procurement" keeps its exact wording.
- **Design tokens only.** `--bg` `#f4f1ea`, `--bg-soft`, `--ink` / `--ink-soft` / `--ink-dim`, `--line` / `--line-strong`, `--accent`, `--chip`. Border radius is `2px` everywhere. No new colour literals except the semantic success/error hexes already in the codebase (`#2f9e4f`, `#c84a1a`).
- **Reuse, don't re-implement:** `ListToolbar` from `frontend/src/pages/admin/platform/screens/ListToolbar.jsx` for every list screen; `PageHead` from `frontend/src/pages/admin/platform/shell/osAtoms.jsx` for every screen header.
- **snake_case** for every field name crossing the mock boundary — it is standing in for a JSON API.
- **Known-good baseline:** the suite has exactly **2 pre-existing failures**, both in `AdminPipeline` tests, confirmed byte-identical at `a8c00f2`. Never attribute them to your change; never "fix" them.
- Run all commands from `frontend/`. Single-file runs that trip coverage thresholds take `--no-cov` — vitest here does not enforce coverage, so this is rarely needed.

---

## File Structure

**New — mock and pure logic**

| File | Responsibility |
|---|---|
| `src/lib/artInfraMock.js` | *(rewritten)* The hostile store. All entities, all methods, no `this`. |
| `src/lib/artInfraLatency.js` | Latency/jitter/failure-injection harness. Separated so tests can control it without importing store internals. |
| `src/lib/specFieldForm.js` | Pure: registry definitions → field descriptors + `validateSpecs()`. The highest-risk unit. |
| `src/lib/__fixtures__/artInfraSeed.json` | *(regenerated)* Now carries `spec_fields` and keyed product `specs`. |

**New — vendor portal**

| File | Responsibility |
|---|---|
| `src/pages/vendor/VendorPortal.jsx` | Shell: sub-nav, view-as-vendor switch, screen routing. |
| `src/pages/vendor/VendorProfile.jsx` | Registration / profile form. |
| `src/pages/vendor/VendorCatalog.jsx` | Own-products list on `ListToolbar`. |
| `src/pages/vendor/VendorProductEditor.jsx` | Dynamic form + preview-as-founder. |
| `src/pages/vendor/components/SpecFieldInput.jsx` | Renders one registry-driven input by `data_type`. |
| `src/styles/vendor-portal.css` | Scoped under `.vendor-portal`. |

**New — admin screens**

| File | Responsibility |
|---|---|
| `src/pages/admin/platform/screens/artinfra/ArtInfraRequests.jsx` | Founder request queue. |
| `src/pages/admin/platform/screens/artinfra/ArtInfraSpecFields.jsx` | Spec-field CRUD for one category. |

**Modified**

| File | Change |
|---|---|
| `src/router.jsx:373-382` | Add `/vendor` routes beside the `/founder` block. |
| `src/pages/founder/FounderStore.jsx` | Request states replace Show-contact; vendor ratings. |
| `src/pages/founder/components/ProductCard.jsx` | Four-state primary button; vendor rating. |
| `src/pages/founder/components/ProductModal.jsx` | Request flow, registry-rendered specs, vendor review form. |
| `.../artinfra/ArtInfraShell.jsx` | Sixth sub-nav entry; requests badge. |
| `.../artinfra/ArtInfraCatalog.jsx` | Pending-review queue; publish / send-back. |
| `.../artinfra/ArtInfraVendors.jsx` | Invite / approve / suspend. |
| `.../artinfra/ArtInfraCategories.jsx` | Drill into spec fields. |
| `.../artinfra/ArtInfraReviews.jsx` | Vendor-level, not product-level. |
| `.../artinfra/ArtInfraInsights.jsx` | Request counts, not shortlist counts. |
| `src/styles/art-infra-admin.css` | Move `.ai-status-*` to the shared sheet. |
| `src/styles/art-infra-shared.css` | *(new)* Status chips both portals use. |
| `backend/scripts/gen_art_infra_fixture.py` | Emit `spec_fields` + keyed specs. |

---
### Task 1: Extend the fixture generator — spec-field registry and keyed specs

The 8 categories each get a real field set, and the 12 seeded products' free-text specs are mapped onto those keys **mechanically**. Hand-transcribing is how typos enter; this generator already exists for exactly that reason.

**Files:**
- Modify: `backend/scripts/gen_art_infra_fixture.py`
- Regenerate: `frontend/src/lib/__fixtures__/artInfraSeed.json`

**Interfaces:**
- Consumes: `backend/app/services/founder_catalog.py` `CATALOG` (unchanged, read-only)
- Produces: `artInfraSeed.json` with a new top-level `spec_fields` array of `{id, category_id, key, label, data_type, unit, enum_options, required, filterable, help_text, sort}`, and each product's `specs` as an **object** `{key: value}` plus `extra_specs` as the unmapped `[{k, v}]` remainder.

- [ ] **Step 1: Add the field definitions to the generator**

Insert above `def main()`:

```python
# Per-category spec fields. Keys are plain slugs so the existing free-text
# spec labels ("Channels", "SNR") map onto them by slugify() with no hand table.
# data_type is one of: text | number | enum | multi_enum | boolean
SPEC_FIELDS: dict[str, list[dict]] = {
    "sensors": [
        {"key": "modality", "label": "Sensing modality", "data_type": "text", "required": True},
        {"key": "channels", "label": "Channels", "data_type": "number", "filterable": True},
        {"key": "snr", "label": "SNR", "data_type": "number", "unit": "dB(A)"},
        {"key": "interface", "label": "Interface", "data_type": "multi_enum",
         "enum_options": ["I2C", "SPI", "TDM", "PDM", "UART", "Analog"]},
        {"key": "supply_voltage", "label": "Supply voltage", "data_type": "number", "unit": "V"},
        {"key": "operating_temp", "label": "Operating temperature", "data_type": "text"},
    ],
    "boards": [
        {"key": "form_factor", "label": "Form factor", "data_type": "text", "required": True},
        {"key": "mcu", "label": "MCU / SoC", "data_type": "text"},
        {"key": "io_count", "label": "I/O count", "data_type": "number"},
        {"key": "connectivity", "label": "Connectivity", "data_type": "multi_enum",
         "enum_options": ["Wi-Fi", "BLE", "LoRa", "Ethernet", "USB", "CAN"]},
        {"key": "supply_voltage", "label": "Supply voltage", "data_type": "number", "unit": "V"},
        {"key": "toolchain", "label": "Toolchain", "data_type": "text"},
    ],
    "compute": [
        {"key": "architecture", "label": "Architecture", "data_type": "enum",
         "enum_options": ["x86", "ARM", "RISC-V"], "required": True, "filterable": True},
        {"key": "cores", "label": "Cores", "data_type": "number"},
        {"key": "ram", "label": "RAM", "data_type": "number", "unit": "GB", "filterable": True},
        {"key": "accelerator", "label": "Accelerator", "data_type": "text"},
        {"key": "tdp", "label": "TDP", "data_type": "number", "unit": "W"},
    ],
    "prototyping": [
        {"key": "service_type", "label": "Service type", "data_type": "enum",
         "enum_options": ["3D printing", "PCB assembly", "Wire harness", "Enclosure"],
         "required": True, "filterable": True},
        {"key": "technology", "label": "Technology", "data_type": "text"},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "mm"},
        {"key": "materials", "label": "Materials", "data_type": "multi_enum",
         "enum_options": ["PLA", "ABS", "Nylon", "Resin", "FR4", "Aluminium"]},
        {"key": "turnaround", "label": "Turnaround", "data_type": "number", "unit": "days"},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
    ],
    "fabrication": [
        {"key": "process", "label": "Process", "data_type": "enum",
         "enum_options": ["CNC milling", "CNC turning", "Sheet metal", "Laser cutting",
                          "Injection moulding"], "required": True, "filterable": True},
        {"key": "materials", "label": "Materials", "data_type": "multi_enum",
         "enum_options": ["Aluminium", "Steel", "Stainless", "Brass", "Delrin", "ABS"]},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "mm"},
        {"key": "max_envelope", "label": "Max part envelope", "data_type": "text"},
        {"key": "surface_finish", "label": "Surface finish", "data_type": "multi_enum",
         "enum_options": ["As-machined", "Bead blast", "Anodised", "Powder coat"]},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
    ],
    "components": [
        {"key": "component_type", "label": "Component type", "data_type": "text", "required": True},
        {"key": "package", "label": "Package", "data_type": "text"},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "%"},
        {"key": "operating_temp", "label": "Operating temperature", "data_type": "text"},
        {"key": "rohs", "label": "RoHS compliant", "data_type": "boolean"},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
    ],
    "power": [
        {"key": "cell_type", "label": "Chemistry / type", "data_type": "text", "required": True},
        {"key": "nominal_voltage", "label": "Nominal voltage", "data_type": "number", "unit": "V"},
        {"key": "capacity", "label": "Capacity", "data_type": "number", "unit": "Wh"},
        {"key": "max_current", "label": "Max current", "data_type": "number", "unit": "A"},
        {"key": "protection", "label": "Protection", "data_type": "multi_enum",
         "enum_options": ["OVP", "OCP", "OTP", "Short-circuit", "Cell balancing"]},
    ],
    "software": [
        {"key": "licensing", "label": "Licensing model", "data_type": "enum",
         "enum_options": ["Perpetual", "Subscription", "Usage-based"],
         "required": True, "filterable": True},
        {"key": "deployment", "label": "Deployment", "data_type": "enum",
         "enum_options": ["Cloud", "On-premise", "Hybrid"], "filterable": True},
        {"key": "seats", "label": "Seats included", "data_type": "number"},
        {"key": "compliance", "label": "Compliance", "data_type": "multi_enum",
         "enum_options": ["HIPAA", "GDPR", "ISO 13485", "21 CFR Part 11", "SOC 2"]},
        {"key": "support_sla", "label": "Support SLA", "data_type": "text"},
    ],
}


def build_spec_fields() -> list[dict]:
    """Flatten SPEC_FIELDS into registry rows with ids, sort and defaults."""
    rows = []
    for category_id, fields in SPEC_FIELDS.items():
        for sort, f in enumerate(fields):
            rows.append({
                "id": f"sf-{category_id}-{f['key']}",
                "category_id": category_id,
                "key": f["key"],
                "label": f["label"],
                "data_type": f["data_type"],
                "unit": f.get("unit"),
                "enum_options": f.get("enum_options"),
                "required": f.get("required", False),
                "filterable": f.get("filterable", False),
                "help_text": f.get("help_text", ""),
                "sort": sort,
                "archived_at": None,
            })
    return rows


def map_specs(category_id: str, specs: list[dict]) -> tuple[dict, list[dict]]:
    """Map free-text [{k,v}] onto this category's field keys by slugified label.

    Returns (keyed, extra). Anything whose slug is not a defined key for the
    category stays in `extra` rather than being silently dropped.
    """
    known = {f["key"] for f in SPEC_FIELDS.get(category_id, [])}
    keyed, extra = {}, []
    for row in specs:
        slug = slugify(row["k"]).replace("-", "_")
        if slug in known:
            keyed[slug] = row["v"]
        else:
            extra.append(row)
    return keyed, extra
```

- [ ] **Step 2: Wire it into `main()`**

In `main()`, replace the `products.append({...})` block's `"specs": specs,` line and add the payload key. The full changed region:

```python
        specs, lo, hi = split_lead_time(product.get("specs") or [])
        keyed, extra = map_specs(cid, specs)
        products.append({
            "id": product["id"],
            "slug": slugify(product["name"]),
            "name": product["name"],
            "blurb": product["blurb"],
            "description": product["desc"],
            "vendor_id": vid,
            "category_id": cid,
            "type": product["type"],
            "pricing": product["pricing"],
            "price": product.get("price") if product["pricing"] == "fixed" else None,
            "lead_time_weeks_min": lo,
            "lead_time_weeks_max": hi,
            "specs": keyed,
            "extra_specs": extra,
            "status": "published",
            "sort": len(products),
            "visible_tracks": ["tir"],
        })
```

And in the payload plus reporting:

```python
    payload = {
        "vendors": sorted(vendors.values(), key=lambda v: v["name"]),
        "categories": sorted(categories.values(), key=lambda c: c["sort"]),
        "spec_fields": build_spec_fields(),
        "products": products,
    }
    ...
    print(f"  spec_fields {len(payload['spec_fields'])}")
    mapped = sum(len(p["specs"]) for p in products)
    unmapped = sum(len(p["extra_specs"]) for p in products)
    print(f"  specs mapped {mapped}, unmapped {unmapped}")
    for p in products:
        for row in p["extra_specs"]:
            print(f"    UNMAPPED {p['id']} {row['k']!r}")
```

- [ ] **Step 3: Run the generator**

Run: `cd backend && python3 scripts/gen_art_infra_fixture.py`

Expected: prints `vendors 11`, `categories 8`, `products 12`, `spec_fields 47`, and a `specs mapped N, unmapped M` line followed by one `UNMAPPED` line per label that did not match. **Unmapped entries are expected and fine** — they render as free text. Record the counts in your task report.

- [ ] **Step 4: Assert the fixture shape**

Create `frontend/src/lib/__tests__/artInfraSeed.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import seed from "../__fixtures__/artInfraSeed.json";

describe("artInfraSeed fixture", () => {
  it("carries the real catalog and a spec-field registry", () => {
    expect(seed.vendors).toHaveLength(11);
    expect(seed.categories).toHaveLength(8);
    expect(seed.products).toHaveLength(12);
    expect(seed.spec_fields.length).toBeGreaterThan(40);
  });

  it("defines fields for every category, keyed to that category", () => {
    const withFields = new Set(seed.spec_fields.map((f) => f.category_id));
    for (const c of seed.categories) expect(withFields.has(c.id)).toBe(true);
  });

  it("uses only the five supported data types", () => {
    const allowed = new Set(["text", "number", "enum", "multi_enum", "boolean"]);
    for (const f of seed.spec_fields) expect(allowed.has(f.data_type)).toBe(true);
  });

  it("gives every enum and multi_enum field its options", () => {
    for (const f of seed.spec_fields) {
      if (f.data_type === "enum" || f.data_type === "multi_enum") {
        expect(Array.isArray(f.enum_options)).toBe(true);
        expect(f.enum_options.length).toBeGreaterThan(1);
      }
    }
  });

  it("stores product specs as an object keyed by defined field keys", () => {
    for (const p of seed.products) {
      expect(Array.isArray(p.specs)).toBe(false);
      const keys = new Set(
        seed.spec_fields.filter((f) => f.category_id === p.category_id).map((f) => f.key),
      );
      for (const k of Object.keys(p.specs)) expect(keys.has(k)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/__tests__/artInfraSeed.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/gen_art_infra_fixture.py frontend/src/lib/__fixtures__/artInfraSeed.json frontend/src/lib/__tests__/artInfraSeed.test.js
git commit -m "feat(vendor-portal): spec-field registry in the generated fixture"
```

---

### Task 2: The latency and failure-injection harness

Phase 1's mock resolved synchronously and could never fail, which is exactly why five mock-only couplings survived to its carryover list. This harness is what makes those bugs reproduce locally.

**Files:**
- Create: `frontend/src/lib/artInfraLatency.js`
- Test: `frontend/src/lib/__tests__/artInfraLatency.test.js`

**Interfaces:**
- Produces:
  - `settle(value)` → `Promise` resolving to a deep clone after a jittered delay
  - `reject(code)` → `Promise` rejecting with `new Error(code)` after a jittered delay
  - `configure({ minMs, maxMs, failNext, failEvery })` — test control
  - `resetLatency()` — restores defaults; called from test setup

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { settle, reject, configure, resetLatency } from "../artInfraLatency.js";

describe("artInfraLatency", () => {
  beforeEach(() => resetLatency());

  it("resolves with a deep clone, not the original reference", async () => {
    const original = { nested: { n: 1 } };
    configure({ minMs: 0, maxMs: 0 });
    const out = await settle(original);
    expect(out).toEqual(original);
    expect(out).not.toBe(original);
    out.nested.n = 99;
    expect(original.nested.n).toBe(1);
  });

  it("is genuinely async — never resolves in the same microtask", async () => {
    configure({ minMs: 0, maxMs: 0 });
    let settled = false;
    const p = settle(1).then(() => { settled = true; });
    // A synchronous mock would already be true here after one microtask tick.
    await Promise.resolve();
    expect(settled).toBe(false);
    await p;
    expect(settled).toBe(true);
  });

  it("can be told to fail the next call exactly once", async () => {
    configure({ minMs: 0, maxMs: 0, failNext: "boom" });
    await expect(settle({ ok: true })).rejects.toThrow("boom");
    await expect(settle({ ok: true })).resolves.toEqual({ ok: true });
  });

  it("rejects with the given code", async () => {
    configure({ minMs: 0, maxMs: 0 });
    await expect(reject("not_found")).rejects.toThrow("not_found");
  });

  it("varies delay between min and max so responses can land out of order", async () => {
    configure({ minMs: 5, maxMs: 40 });
    const order = [];
    await Promise.all([
      settle("a").then(() => order.push("a")),
      settle("b").then(() => order.push("b")),
      settle("c").then(() => order.push("c")),
    ]);
    expect(order).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/__tests__/artInfraLatency.test.js`
Expected: FAIL — `Failed to resolve import "../artInfraLatency.js"`.

- [ ] **Step 3: Implement the harness**

```javascript
// Latency, jitter and failure injection for the Art Infra mock.
//
// Phase 1's mock wrapped everything in Promise.resolve(), so every call
// settled in issue order and nothing could ever reject. Five bugs survived
// review because of it: loaders with no out-of-order guard, an undebounced
// double-fetch, mutation call sites with no error path. This module exists so
// those reproduce on a laptop instead of in staging.

const DEFAULTS = { minMs: 40, maxMs: 260 };

let minMs = DEFAULTS.minMs;
let maxMs = DEFAULTS.maxMs;
let failNext = null;   // one-shot: next call rejects with this code
let failEvery = 0;     // 0 = off; N = every Nth call rejects
let callCount = 0;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const delay = () => minMs + Math.random() * Math.max(0, maxMs - minMs);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function configure(opts = {}) {
  if (opts.minMs !== undefined) minMs = opts.minMs;
  if (opts.maxMs !== undefined) maxMs = opts.maxMs;
  if (opts.failNext !== undefined) failNext = opts.failNext;
  if (opts.failEvery !== undefined) failEvery = opts.failEvery;
}

export function resetLatency() {
  minMs = DEFAULTS.minMs;
  maxMs = DEFAULTS.maxMs;
  failNext = null;
  failEvery = 0;
  callCount = 0;
}

function shouldFail() {
  if (failNext) {
    const code = failNext;
    failNext = null;          // one-shot
    return code;
    }
  callCount += 1;
  if (failEvery > 0 && callCount % failEvery === 0) return "injected_failure";
  return null;
}

export async function settle(value) {
  await wait(delay());
  const code = shouldFail();
  if (code) throw new Error(code);
  return clone(value);
}

export async function reject(code) {
  await wait(delay());
  throw new Error(code);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/artInfraLatency.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Reset latency between tests globally**

Append to `frontend/src/test/setup.js` inside the existing `beforeEach`:

```javascript
  // Art Infra mock latency/failure injection is module-level state; without
  // this a configure() in one test leaks into the next.
  resetLatency();
```

and add the import at the top of that file:

```javascript
import { resetLatency } from "../lib/artInfraLatency.js";
```

- [ ] **Step 6: Run the whole suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: 2 failures, both in `AdminPipeline` — the documented baseline. Any third failure is yours.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/artInfraLatency.js frontend/src/lib/__tests__/artInfraLatency.test.js frontend/src/test/setup.js
git commit -m "feat(vendor-portal): async mock harness with jitter and failure injection"
```

---
### Task 3: The spec-field form generator (highest-risk unit)

This is the module that makes "the details cells change depending on the product" true. It is pure — registry rows in, field descriptors and validation results out — so it is tested directly rather than through a rendered form. Everything about the dynamic form's correctness lives here.

**Files:**
- Create: `frontend/src/lib/specFieldForm.js`
- Test: `frontend/src/lib/__tests__/specFieldForm.test.js`

**Interfaces:**
- Consumes: `spec_fields` rows from Task 1's fixture.
- Produces:
  - `describeFields(specFields, categoryId)` → ordered array of live (non-archived) field rows for that category
  - `emptyValues(fields)` → `{}` seeded with type-appropriate blanks
  - `coerceValue(field, raw)` → typed value (`number | string | string[] | boolean | null`)
  - `validateSpecs(fields, values)` → `{ ok: boolean, errors: Record<string,string> }`

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from "vitest";
import {
  describeFields, emptyValues, coerceValue, validateSpecs,
} from "../specFieldForm.js";

const FIELDS = [
  { category_id: "sensors", key: "modality", label: "Sensing modality",
    data_type: "text", required: true, sort: 0, archived_at: null },
  { category_id: "sensors", key: "channels", label: "Channels",
    data_type: "number", unit: null, required: false, sort: 1, archived_at: null },
  { category_id: "sensors", key: "interface", label: "Interface",
    data_type: "multi_enum", enum_options: ["I2C", "SPI", "PDM"],
    required: false, sort: 2, archived_at: null },
  { category_id: "sensors", key: "grade", label: "Grade", data_type: "enum",
    enum_options: ["A", "B"], required: false, sort: 3, archived_at: null },
  { category_id: "sensors", key: "rohs", label: "RoHS", data_type: "boolean",
    required: false, sort: 4, archived_at: null },
  { category_id: "sensors", key: "legacy", label: "Legacy", data_type: "text",
    required: true, sort: 5, archived_at: "2026-09-01T00:00:00Z" },
  { category_id: "fabrication", key: "process", label: "Process",
    data_type: "enum", enum_options: ["CNC milling"], required: true, sort: 0,
    archived_at: null },
];

describe("describeFields", () => {
  it("returns only this category's fields, in sort order", () => {
    const out = describeFields(FIELDS, "sensors");
    expect(out.map((f) => f.key)).toEqual(
      ["modality", "channels", "interface", "grade", "rohs"]);
  });

  it("excludes archived fields", () => {
    expect(describeFields(FIELDS, "sensors").some((f) => f.key === "legacy")).toBe(false);
  });

  it("returns a different field set for a different category", () => {
    expect(describeFields(FIELDS, "fabrication").map((f) => f.key)).toEqual(["process"]);
  });

  it("returns empty for an unknown category rather than throwing", () => {
    expect(describeFields(FIELDS, "nope")).toEqual([]);
  });
});

describe("coerceValue", () => {
  const f = (data_type) => ({ key: "x", data_type, enum_options: ["A", "B"] });

  it("turns a numeric string into a number", () => {
    expect(coerceValue(f("number"), "42")).toBe(42);
  });

  it("turns an empty string into null, not 0", () => {
    expect(coerceValue(f("number"), "")).toBeNull();
  });

  it("leaves a non-numeric string alone so validation can report it", () => {
    expect(coerceValue(f("number"), "eight")).toBe("eight");
  });

  it("always yields an array for multi_enum", () => {
    expect(coerceValue(f("multi_enum"), "A")).toEqual(["A"]);
    expect(coerceValue(f("multi_enum"), ["A", "B"])).toEqual(["A", "B"]);
    expect(coerceValue(f("multi_enum"), "")).toEqual([]);
  });

  it("coerces boolean from checkbox values", () => {
    expect(coerceValue(f("boolean"), true)).toBe(true);
    expect(coerceValue(f("boolean"), "on")).toBe(true);
    expect(coerceValue(f("boolean"), false)).toBe(false);
  });
});

describe("validateSpecs", () => {
  const live = describeFields(FIELDS, "sensors");

  it("passes when required fields are filled", () => {
    expect(validateSpecs(live, { modality: "Acoustic" })).toEqual({ ok: true, errors: {} });
  });

  it("fails a missing required field", () => {
    const r = validateSpecs(live, {});
    expect(r.ok).toBe(false);
    expect(r.errors.modality).toMatch(/required/i);
  });

  it("treats whitespace as missing", () => {
    expect(validateSpecs(live, { modality: "   " }).ok).toBe(false);
  });

  it("rejects a non-numeric value in a number field", () => {
    const r = validateSpecs(live, { modality: "Acoustic", channels: "eight" });
    expect(r.ok).toBe(false);
    expect(r.errors.channels).toMatch(/number/i);
  });

  it("accepts zero as a real number, not as missing", () => {
    expect(validateSpecs(live, { modality: "Acoustic", channels: 0 }).ok).toBe(true);
  });

  it("rejects an enum value outside its options", () => {
    const r = validateSpecs(live, { modality: "Acoustic", grade: "Z" });
    expect(r.errors.grade).toMatch(/not an allowed/i);
  });

  it("rejects a multi_enum containing an unknown option", () => {
    const r = validateSpecs(live, { modality: "Acoustic", interface: ["I2C", "CAN"] });
    expect(r.errors.interface).toMatch(/CAN/);
  });

  it("rejects a key that is not a live field for this category", () => {
    const r = validateSpecs(live, { modality: "Acoustic", process: "CNC milling" });
    expect(r.ok).toBe(false);
    expect(r.errors.process).toMatch(/not a field/i);
  });

  it("does NOT require a field that has been archived", () => {
    // `legacy` is required but archived — an admin archiving a field must not
    // retroactively invalidate every product that never had it.
    expect(validateSpecs(live, { modality: "Acoustic" }).ok).toBe(true);
  });
});

describe("emptyValues", () => {
  it("seeds blanks appropriate to each type", () => {
    expect(emptyValues(describeFields(FIELDS, "sensors"))).toEqual({
      modality: "", channels: null, interface: [], grade: "", rohs: false,
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/specFieldForm.test.js`
Expected: FAIL — cannot resolve `../specFieldForm.js`.

- [ ] **Step 3: Implement**

```javascript
// Pure translation between the spec-field registry and a rendered form.
//
// The registry is DATA — admins edit it at runtime — so none of this can be a
// database CHECK constraint. In Phase 2 the identical rules run server-side on
// submit and on publish; the client copy is a convenience, never the authority.

const isBlank = (v) =>
  v === null || v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** Live (non-archived) fields for one category, in display order. */
export function describeFields(specFields, categoryId) {
  return (specFields || [])
    .filter((f) => f.category_id === categoryId && !f.archived_at)
    .slice()
    .sort((a, b) => a.sort - b.sort);
}

/** Type-appropriate blanks, so an uncontrolled input never warns. */
export function emptyValues(fields) {
  const out = {};
  for (const f of fields) {
    if (f.data_type === "number") out[f.key] = null;
    else if (f.data_type === "multi_enum") out[f.key] = [];
    else if (f.data_type === "boolean") out[f.key] = false;
    else out[f.key] = "";
  }
  return out;
}

/** DOM value -> stored value. Bad input is passed through for validation. */
export function coerceValue(field, raw) {
  switch (field.data_type) {
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;   // keep junk so validate can report it
    }
    case "multi_enum":
      if (Array.isArray(raw)) return raw;
      return isBlank(raw) ? [] : [raw];
    case "boolean":
      return raw === true || raw === "on" || raw === "true";
    default:
      return raw ?? "";
  }
}

/**
 * Validate values against the LIVE field set.
 * `fields` must already be the output of describeFields — archived fields are
 * excluded there, which is what stops an archived-but-required field from
 * invalidating every existing product.
 */
export function validateSpecs(fields, values) {
  const errors = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const key of Object.keys(values || {})) {
    if (!byKey.has(key)) errors[key] = `"${key}" is not a field in this category.`;
  }

  for (const f of fields) {
    const v = values?.[f.key];

    if (f.required && isBlank(v) && v !== 0 && v !== false) {
      errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (isBlank(v) && v !== 0 && v !== false) continue;   // optional and empty

    if (f.data_type === "number" && !Number.isFinite(v)) {
      errors[f.key] = `${f.label} must be a number.`;
    }
    if (f.data_type === "enum" && !(f.enum_options || []).includes(v)) {
      errors[f.key] = `"${v}" is not an allowed value for ${f.label}.`;
    }
    if (f.data_type === "multi_enum") {
      const bad = (v || []).filter((x) => !(f.enum_options || []).includes(x));
      if (bad.length) errors[f.key] = `${bad.join(", ")} not allowed for ${f.label}.`;
    }
    if (f.data_type === "boolean" && typeof v !== "boolean") {
      errors[f.key] = `${f.label} must be true or false.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/specFieldForm.test.js`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/specFieldForm.js frontend/src/lib/__tests__/specFieldForm.test.js
git commit -m "feat(vendor-portal): registry-driven form generation and validation"
```

---
### Task 4: The hostile mock store

Replaces Phase 1's `artInfraMock.js` entirely. Every method name here is the name the Phase-2 client will expose. Three rules make this mock hostile on purpose: it goes through `settle()` so calls are async and jittered, its write methods **reject unknown fields**, and **no method uses `this`**.

**Files:**
- Modify (rewrite): `frontend/src/lib/artInfraMock.js`
- Test: `frontend/src/lib/__tests__/artInfraMock.test.js` (replace existing)

**Interfaces:**
- Consumes: `artInfraSeed.json` (Task 1), `settle`/`reject` (Task 2).
- Produces: `createArtInfraStore(initial?, opts?)` returning the object below, and a shared singleton `artInfraMock`.

```
// shared reads
listCategories()                          -> Category[]
listSpecFields(categoryId?)               -> SpecField[]    // all when omitted

// vendor-scoped (vendorId is always the FIRST argument — never trusted from a form)
getVendorMe(vendorId)                     -> Vendor
saveVendorProfile(vendorId, patch)        -> Vendor         // rejects unknown fields
submitVendorProfile(vendorId)             -> Vendor         // -> status 'registered'
listVendorProducts(vendorId, filters?)    -> {items, total}
getVendorProduct(vendorId, productId)     -> Product | null
createVendorProduct(vendorId, patch)      -> Product        // -> status 'draft'
updateVendorProduct(vendorId, id, patch)  -> Product        // rejects unknown fields
submitProduct(vendorId, id)               -> Product        // draft -> pending_review
retireProduct(vendorId, id)               -> Product
deleteVendorProduct(vendorId, id)         -> undefined      // drafts only

// admin
adminListVendors(filters?)                -> Vendor[]
inviteVendor(patch)                       -> Vendor         // -> status 'invited'
approveVendor(id) / suspendVendor(id)     -> Vendor
adminListProducts(filters?)               -> {items, total}
publishProduct(id)                        -> Product
sendBackProduct(id, note)                 -> Product        // -> draft + review_note
saveCategory(patch) / deleteCategory(id)
saveSpecField(patch) / archiveSpecField(id)
listRequests(filters?)                    -> Request[]
approveRequest(id) / declineRequest(id, note) -> Request
listVendorReviews(filters?)               -> Review[]
moderateVendorReview(id, status) / deleteVendorReview(id)
insights()                                -> {perProduct, topRequested, neverRequested, meanApprovedRating}

// founder
founderStore()                            -> {catalog, shortlist, shortlist_subtotal, requests}
addToShortlist(productId, qty?) / setShortlistQty(productId, qty) / removeFromShortlist(productId)
pushToProcurement()                       -> {pushed}
createRequest(patch)                      -> Request        // rejects unknown fields
withdrawRequest(id)                       -> Request
submitVendorReview(vendorId, patch)       -> Review
```

- [ ] **Step 1: Write the failing contract tests**

Replace `frontend/src/lib/__tests__/artInfraMock.test.js` with:

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { createArtInfraStore } from "../artInfraMock.js";
import { configure, resetLatency } from "../artInfraLatency.js";

const ME = "app-me";
let store;

beforeEach(() => {
  resetLatency();
  configure({ minMs: 0, maxMs: 0 });   // deterministic in tests
  store = createArtInfraStore();
});

describe("disclosure rule — the security-relevant contract", () => {
  it("omits the contact block entirely when there is no approved request", async () => {
    const { catalog } = await store.founderStore();
    const p = catalog[0];
    expect(p.contact_state).toBe("none");
    // Absent from the PAYLOAD, not merely hidden in the UI.
    expect(p.vendor.contact_email).toBeUndefined();
    expect(p.vendor.contact_phone).toBeUndefined();
    expect(p.vendor.contact_name).toBeUndefined();
  });

  it("still omits it while the request is only pending", async () => {
    const before = await store.founderStore();
    await store.createRequest({ product_id: before.catalog[0].id, note: "need 4" });
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("pending");
    expect(after.catalog[0].vendor.contact_email).toBeUndefined();
  });

  it("includes it once the request is approved", async () => {
    const before = await store.founderStore();
    const req = await store.createRequest({ product_id: before.catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("approved");
    expect(after.catalog[0].vendor).toHaveProperty("contact_email");
  });

  it("unlocks EVERY product from that vendor, not just the one requested", async () => {
    const before = await store.founderStore();
    const target = before.catalog[0];
    const sibling = before.catalog.find(
      (p) => p.vendor.id === target.vendor.id && p.id !== target.id);
    const req = await store.createRequest({ product_id: target.id, note: "x" });
    await store.approveRequest(req.id);
    const after = await store.founderStore();
    if (sibling) {
      const s = after.catalog.find((p) => p.id === sibling.id);
      expect(s.contact_state).toBe("approved");
      expect(s.vendor).toHaveProperty("contact_email");
    }
    // A DIFFERENT vendor must stay locked.
    const other = after.catalog.find((p) => p.vendor.id !== target.vendor.id);
    expect(other.contact_state).toBe("none");
    expect(other.vendor.contact_email).toBeUndefined();
  });

  it("re-locks a declined request", async () => {
    const before = await store.founderStore();
    const req = await store.createRequest({ product_id: before.catalog[0].id, note: "x" });
    await store.declineRequest(req.id, "Out of budget");
    const after = await store.founderStore();
    expect(after.catalog[0].contact_state).toBe("declined");
    expect(after.catalog[0].vendor.contact_email).toBeUndefined();
    expect(after.catalog[0].request_note).toBe("Out of budget");
  });
});

describe("write methods reject unknown fields", () => {
  it("refuses a product patch carrying read-model junk", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "X", category_id: "sensors" });
    // `vendor`, `rating` and `pending_reviews` are READ-model fields.
    await expect(
      store.updateVendorProduct(v.id, p.id, {
        name: "Y", vendor: { id: v.id }, rating: { avg: 5, count: 1 },
      }),
    ).rejects.toThrow(/unwritable_fields/);
  });

  it("refuses a request patch with an unexpected key", async () => {
    const { catalog } = await store.founderStore();
    await expect(
      store.createRequest({ product_id: catalog[0].id, note: "x", status: "approved" }),
    ).rejects.toThrow(/unwritable_fields/);
  });
});

describe("vendor scoping", () => {
  it("never returns another vendor's products", async () => {
    const vendors = await store.adminListVendors();
    const { items } = await store.listVendorProducts(vendors[0].id);
    for (const p of items) expect(p.vendor_id).toBe(vendors[0].id);
  });

  it("refuses to mutate a product belonging to another vendor", async () => {
    const vendors = await store.adminListVendors();
    const { items } = await store.listVendorProducts(vendors[0].id);
    if (items.length) {
      const other = vendors.find((v) => v.id !== vendors[0].id);
      await expect(
        store.updateVendorProduct(other.id, items[0].id, { name: "hijack" }),
      ).rejects.toThrow(/not_found/);
    }
  });
});

describe("survives destructuring — no `this` anywhere", () => {
  it("works when methods are pulled off the store", async () => {
    const { founderStore, addToShortlist, setShortlistQty } = store;
    const { catalog } = await founderStore();
    await addToShortlist(catalog[0].id, 2);
    // Phase 1's setShortlistQty called this.removeFromShortlist and broke here.
    await setShortlistQty(catalog[0].id, 0);
    const after = await founderStore();
    expect(after.shortlist).toHaveLength(0);
  });
});

describe("product lifecycle", () => {
  it("moves draft -> pending_review -> published", async () => {
    const [v] = await store.adminListVendors();
    let p = await store.createVendorProduct(v.id, { name: "New", category_id: "sensors" });
    expect(p.status).toBe("draft");
    p = await store.submitProduct(v.id, p.id);
    expect(p.status).toBe("pending_review");
    p = await store.publishProduct(p.id);
    expect(p.status).toBe("published");
  });

  it("send-back returns it to draft with the admin's note", async () => {
    const [v] = await store.adminListVendors();
    let p = await store.createVendorProduct(v.id, { name: "New", category_id: "sensors" });
    p = await store.submitProduct(v.id, p.id);
    p = await store.sendBackProduct(p.id, "Add a datasheet");
    expect(p.status).toBe("draft");
    expect(p.review_note).toBe("Add a datasheet");
  });

  it("hides non-published products from the founder catalog", async () => {
    const [v] = await store.adminListVendors();
    const p = await store.createVendorProduct(v.id, { name: "Hidden", category_id: "sensors" });
    const { catalog } = await store.founderStore();
    expect(catalog.find((c) => c.id === p.id)).toBeUndefined();
  });
});

describe("reviews are vendor-level and gated on an approved request", () => {
  it("refuses a review with no approved request", async () => {
    const { catalog } = await store.founderStore();
    await expect(
      store.submitVendorReview(catalog[0].vendor.id, { rating: 5, body: "great" }),
    ).rejects.toThrow(/not_eligible/);
  });

  it("accepts one once the request is approved", async () => {
    const { catalog } = await store.founderStore();
    const req = await store.createRequest({ product_id: catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const r = await store.submitVendorReview(catalog[0].vendor.id, {
      rating: 5, body: "Responsive" });
    expect(r.status).toBe("pending");
    expect(r.application_id).toBe(ME);
  });

  it("shows an approved vendor rating on every product from that vendor", async () => {
    const { catalog } = await store.founderStore();
    const vendorId = catalog[0].vendor.id;
    const req = await store.createRequest({ product_id: catalog[0].id, note: "x" });
    await store.approveRequest(req.id);
    const r = await store.submitVendorReview(vendorId, { rating: 4, body: "Good" });
    await store.moderateVendorReview(r.id, "approved");
    const after = await store.founderStore();
    for (const p of after.catalog.filter((x) => x.vendor.id === vendorId)) {
      expect(p.rating.count).toBeGreaterThan(0);
      expect(p.rating.avg).toBe(4);
    }
  });
});

describe("injected failure surfaces to the caller", () => {
  it("rejects when the harness is told to fail", async () => {
    configure({ failNext: "server_error" });
    await expect(store.founderStore()).rejects.toThrow("server_error");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/artInfraMock.test.js`
Expected: FAIL — the old mock has none of these methods.

- [ ] **Step 3: Rewrite the store**

Replace `frontend/src/lib/artInfraMock.js` entirely:

```javascript
// Phase-2 API stand-in for three portals. Every method name here is the name
// the real client will expose, so swapping this module for a network client is
// a one-line import change per screen.
//
// Deliberately hostile, unlike Phase 1's mock:
//   * every call goes through settle() -- genuinely async, jittered, failable
//   * write methods REJECT unknown fields, so a read-model-as-write-payload
//     bug fails here instead of 422-ing in staging
//   * NO METHOD USES `this` -- every call site may destructure freely

import seed from "./__fixtures__/artInfraSeed.json";
import { settle, reject } from "./artInfraLatency.js";

// The single founder the preview simulates.
const ME = "app-me";

// MOCK ONLY -- never seed any of this into the Phase-2 migration.
const SAMPLE_REVIEWS = [
  { id: "r1", vendor_id: "knowles", application_id: "app-1", author_name: "Rhea Nair",
    author_venture: "AuralDx", rating: 5, status: "approved",
    body: "Channel matching saved us weeks of calibration.",
    created_at: "2026-08-02T10:00:00Z" },
  { id: "r2", vendor_id: "knowles", application_id: "app-2", author_name: "Ishan Gupta",
    author_venture: "BreatheAI", rating: 4, status: "pending",
    body: "Great SNR. Docs assume some DSP background.",
    created_at: "2026-08-11T10:00:00Z" },
];

const WRITABLE = {
  vendor: ["legal_name", "display_name", "website", "contact_name", "contact_email",
    "contact_phone", "city", "state", "country", "capabilities", "categories_served",
    "gstin", "udyam_number", "cin", "certifications"],
  product: ["name", "slug", "blurb", "description", "category_id", "type", "pricing",
    "price", "lead_time_weeks_min", "lead_time_weeks_max", "specs", "sort",
    "visible_tracks"],
  request: ["product_id", "note", "qty"],
  review: ["rating", "body"],
  category: ["id", "label", "sort"],
  specField: ["id", "category_id", "key", "label", "data_type", "unit", "enum_options",
    "required", "filterable", "help_text", "sort"],
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Throws if `patch` carries any key outside the entity's writable set. */
function assertWritable(patch, allowed) {
  const bad = Object.keys(patch || {}).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Error(`unwritable_fields: ${bad.join(", ")}`);
}

export function createArtInfraStore(initial = seed, { seedSamples = true } = {}) {
  const db = {
    vendors: clone(initial.vendors).map((v) => ({
      ...v, legal_name: v.name, display_name: v.name,
      website: "", capabilities: "", categories_served: [],
      city: "", state: "", country: "India",
      gstin: "", udyam_number: "", cin: "", certifications: [],
      status: "approved",        // seeded vendors are live and unclaimed
      user_ids: [],              // one-to-many; empty = unclaimed
    })),
    categories: clone(initial.categories),
    spec_fields: clone(initial.spec_fields),
    products: clone(initial.products).map((p) => ({ ...p, review_note: "" })),
    datasheets: [],
    reviews: seedSamples ? clone(SAMPLE_REVIEWS) : [],
    requests: [],
    shortlist: [],
    procurement: [],
  };

  // ---- derivations -------------------------------------------------------
  const vendorOf = (p) => db.vendors.find((v) => v.id === p.vendor_id) || null;
  const categoryOf = (p) => db.categories.find((c) => c.id === p.category_id) || null;

  const ratingOfVendor = (vendorId) => {
    const ok = db.reviews.filter((r) => r.vendor_id === vendorId && r.status === "approved");
    if (!ok.length) return { avg: 0, count: 0 };
    return { avg: ok.reduce((a, r) => a + r.rating, 0) / ok.length, count: ok.length };
  };

  const requestFor = (productId) =>
    db.requests.find((r) => r.product_id === productId && r.application_id === ME) || null;

  const vendorApprovedFor = (vendorId) =>
    db.requests.some((r) => r.vendor_id === vendorId
      && r.application_id === ME && r.status === "approved");

  /** THE DISCLOSURE RULE. Contact fields are added only when approved --
   *  they are absent from the object, not blanked, so they never travel. */
  const vendorForFounder = (v) => {
    const base = { id: v.id, name: v.display_name || v.name, website: v.website };
    if (!vendorApprovedFor(v.id)) return base;
    return {
      ...base,
      contact_name: v.contact_name, contact_email: v.contact_email,
      contact_phone: v.contact_phone, artpark_ref: v.artpark_ref,
      city: v.city, state: v.state, country: v.country,
    };
  };

  const founderView = (p) => {
    const v = vendorOf(p);
    const line = db.shortlist.find((s) => s.product_id === p.id);
    const req = requestFor(p.id);
    const mine = db.reviews.find(
      (r) => r.vendor_id === p.vendor_id && r.application_id === ME);
    return {
      ...p,
      vendor: v ? vendorForFounder(v) : null,
      category: categoryOf(p),
      spec_fields: db.spec_fields.filter(
        (f) => f.category_id === p.category_id && !f.archived_at),
      datasheets: db.datasheets.filter((d) => d.product_id === p.id),
      rating: v ? ratingOfVendor(v.id) : { avg: 0, count: 0 },
      in_shortlist_qty: line ? line.qty : 0,
      contact_state: req ? req.status : "none",
      request_id: req ? req.id : null,
      request_note: req ? req.decision_note || "" : "",
      can_review: v ? vendorApprovedFor(v.id) : false,
      my_review: mine || null,
    };
  };

  const adminView = (p) => ({
    ...p,
    vendor: vendorOf(p),
    category: categoryOf(p),
    pending_reviews: db.reviews.filter(
      (r) => r.vendor_id === p.vendor_id && r.status === "pending").length,
    rating: ratingOfVendor(p.vendor_id),
  });

  const ownedProduct = (vendorId, productId) =>
    db.products.find((p) => p.id === productId && p.vendor_id === vendorId) || null;

  // ---- shared reads ------------------------------------------------------
  const listCategories = () =>
    settle([...db.categories].sort((a, b) => a.sort - b.sort));

  const listSpecFields = (categoryId) =>
    settle(db.spec_fields
      .filter((f) => (!categoryId || f.category_id === categoryId))
      .sort((a, b) => a.sort - b.sort));

  // ---- vendor-scoped -----------------------------------------------------
  const getVendorMe = (vendorId) => {
    const v = db.vendors.find((x) => x.id === vendorId);
    return v ? settle(v) : reject("not_found");
  };

  const saveVendorProfile = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.vendor); } catch (e) { return Promise.reject(e); }
    const v = db.vendors.find((x) => x.id === vendorId);
    if (!v) return reject("not_found");
    Object.assign(v, patch);
    return settle(v);
  };

  const submitVendorProfile = (vendorId) => {
    const v = db.vendors.find((x) => x.id === vendorId);
    if (!v) return reject("not_found");
    if (!v.legal_name || !v.contact_email) return reject("profile_incomplete");
    if (v.status === "invited") v.status = "registered";
    return settle(v);
  };

  const listVendorProducts = (vendorId, { status = "", search = "" } = {}) => {
    const q = search.trim().toLowerCase();
    const items = db.products
      .filter((p) => p.vendor_id === vendorId)
      .filter((p) => (!status || p.status === status))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.sort - b.sort);
    return settle({ items, total: db.products.filter((p) => p.vendor_id === vendorId).length });
  };

  const getVendorProduct = (vendorId, productId) =>
    settle(ownedProduct(vendorId, productId));

  const createVendorProduct = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.product); } catch (e) { return Promise.reject(e); }
    if (!patch.name) return reject("name_required");
    const created = {
      id: uid("p"), vendor_id: vendorId, slug: patch.slug || slugify(patch.name),
      blurb: "", description: "", category_id: "", type: "Hardware", pricing: "fixed",
      price: null, lead_time_weeks_min: null, lead_time_weeks_max: null,
      specs: {}, extra_specs: [], status: "draft", review_note: "",
      sort: db.products.length, visible_tracks: ["tir"],
      ...patch,
    };
    db.products.push(created);
    return settle(created);
  };

  const updateVendorProduct = (vendorId, productId, patch) => {
    try { assertWritable(patch, WRITABLE.product); } catch (e) { return Promise.reject(e); }
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    Object.assign(p, patch);
    return settle(p);
  };

  const submitProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    if (p.status !== "draft") return reject("not_draft");
    p.status = "pending_review";
    p.review_note = "";
    return settle(p);
  };

  const retireProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    p.status = "retired";
    return settle(p);
  };

  const deleteVendorProduct = (vendorId, productId) => {
    const p = ownedProduct(vendorId, productId);
    if (!p) return reject("not_found");
    if (p.status !== "draft") return reject("only_drafts_deletable");
    db.products = db.products.filter((x) => x.id !== productId);
    return settle(undefined);
  };

  // ---- admin -------------------------------------------------------------
  const adminListVendors = ({ status = "", search = "" } = {}) => {
    const q = search.trim().toLowerCase();
    return settle(db.vendors
      .filter((v) => (!status || v.status === status))
      .filter((v) => !q || (v.display_name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")));
  };

  const inviteVendor = (patch) => {
    if (!patch?.contact_email) return reject("email_required");
    const created = {
      id: slugify(patch.display_name || patch.contact_email), name: patch.display_name || "",
      legal_name: "", display_name: patch.display_name || "", website: "",
      contact_name: "", contact_email: patch.contact_email, contact_phone: "",
      artpark_ref: "", capabilities: "", categories_served: [],
      city: "", state: "", country: "India",
      gstin: "", udyam_number: "", cin: "", certifications: [],
      status: "invited", user_ids: [],
    };
    db.vendors.push(created);
    return settle(created);
  };

  const setVendorStatus = (id, status) => {
    const v = db.vendors.find((x) => x.id === id);
    if (!v) return reject("not_found");
    v.status = status;
    return settle(v);
  };
  const approveVendor = (id) => setVendorStatus(id, "approved");
  const suspendVendor = (id) => setVendorStatus(id, "suspended");

  const adminListProducts = ({ search = "", status = "", category = "", type = "",
    vendor = "" } = {}) => {
    const q = search.trim().toLowerCase();
    const items = db.products
      .filter((p) => (!status || p.status === status))
      .filter((p) => (!category || p.category_id === category))
      .filter((p) => (!type || p.type === type))
      .filter((p) => (!vendor || p.vendor_id === vendor))
      .filter((p) => !q || p.name.toLowerCase().includes(q)
        || (vendorOf(p)?.display_name || "").toLowerCase().includes(q))
      .sort((a, b) => a.sort - b.sort)
      .map(adminView);
    return settle({ items, total: db.products.length });
  };

  const publishProduct = (id) => {
    const p = db.products.find((x) => x.id === id);
    if (!p) return reject("not_found");
    const v = vendorOf(p);
    if (!v || v.status !== "approved") return reject("vendor_not_approved");
    p.status = "published";
    p.review_note = "";
    return settle(p);
  };

  const sendBackProduct = (id, note) => {
    const p = db.products.find((x) => x.id === id);
    if (!p) return reject("not_found");
    if (!note?.trim()) return reject("note_required");
    p.status = "draft";
    p.review_note = note;
    return settle(p);
  };

  const saveCategory = (patch) => {
    try { assertWritable(patch, WRITABLE.category); } catch (e) { return Promise.reject(e); }
    if (!patch.label) return reject("label_required");
    const existing = patch.id && db.categories.find((c) => c.id === patch.id);
    if (existing) { Object.assign(existing, patch); return settle(existing); }
    const created = { id: slugify(patch.label), sort: db.categories.length, ...patch };
    db.categories.push(created);
    return settle(created);
  };

  const deleteCategory = (id) => {
    if (db.products.some((p) => p.category_id === id)) return reject("category_in_use");
    db.categories = db.categories.filter((c) => c.id !== id);
    db.spec_fields = db.spec_fields.filter((f) => f.category_id !== id);
    return settle(undefined);
  };

  const saveSpecField = (patch) => {
    try { assertWritable(patch, WRITABLE.specField); } catch (e) { return Promise.reject(e); }
    if (!patch.label || !patch.key) return reject("key_and_label_required");
    const existing = patch.id && db.spec_fields.find((f) => f.id === patch.id);
    // A live field's key must stay unique within its category; an ARCHIVED one
    // must not block re-adding that key.
    const clash = db.spec_fields.find((f) => f.category_id === patch.category_id
      && f.key === patch.key && !f.archived_at && f.id !== patch.id);
    if (clash) return reject("duplicate_key");
    if (existing) { Object.assign(existing, patch); return settle(existing); }
    const created = {
      id: uid("sf"), unit: null, enum_options: null, required: false,
      filterable: false, help_text: "", archived_at: null,
      sort: db.spec_fields.filter((f) => f.category_id === patch.category_id).length,
      ...patch,
    };
    db.spec_fields.push(created);
    return settle(created);
  };

  /** Soft delete. Values survive in specs but stop rendering. */
  const archiveSpecField = (id) => {
    const f = db.spec_fields.find((x) => x.id === id);
    if (!f) return reject("not_found");
    f.archived_at = new Date().toISOString();
    return settle(f);
  };

  const listRequests = ({ status = "" } = {}) =>
    settle(db.requests
      .filter((r) => (!status || r.status === status))
      .map((r) => ({
        ...r,
        product_name: db.products.find((p) => p.id === r.product_id)?.name || "(deleted)",
        vendor_name: db.vendors.find((v) => v.id === r.vendor_id)?.display_name || "",
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));

  const decideRequest = (id, status, note) => {
    const r = db.requests.find((x) => x.id === id);
    if (!r) return reject("not_found");
    if (status === "declined" && !note?.trim()) return reject("note_required");
    r.status = status;
    r.decision_note = note || "";
    r.decided_at = new Date().toISOString();
    return settle(r);
  };
  const approveRequest = (id) => decideRequest(id, "approved", "");
  const declineRequest = (id, note) => decideRequest(id, "declined", note);

  const listVendorReviews = ({ status = "" } = {}) =>
    settle(db.reviews
      .filter((r) => (!status || r.status === status))
      .map((r) => ({
        ...r,
        vendor_name: db.vendors.find((v) => v.id === r.vendor_id)?.display_name || "",
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));

  const moderateVendorReview = (id, status) => {
    const r = db.reviews.find((x) => x.id === id);
    if (!r) return reject("not_found");
    r.status = status;
    r.moderated_at = new Date().toISOString();
    return settle(r);
  };

  const deleteVendorReview = (id) => {
    db.reviews = db.reviews.filter((r) => r.id !== id);
    return settle(undefined);
  };

  const insights = () => {
    const perProduct = db.products.map((p) => ({
      id: p.id, name: p.name, status: p.status,
      vendor: vendorOf(p)?.display_name || "",
      requested_by: db.requests.filter((r) => r.product_id === p.id).length,
      rating: ratingOfVendor(p.vendor_id),
    }));
    const approved = db.reviews.filter((r) => r.status === "approved");
    return settle({
      perProduct,
      topRequested: [...perProduct].filter((p) => p.requested_by > 0)
        .sort((a, b) => b.requested_by - a.requested_by),
      neverRequested: perProduct.filter((p) => p.requested_by === 0),
      meanApprovedRating: {
        avg: approved.length
          ? approved.reduce((a, r) => a + r.rating, 0) / approved.length : 0,
        count: approved.length,
      },
    });
  };

  // ---- founder -----------------------------------------------------------
  const founderStore = () => {
    const catalog = db.products
      .filter((p) => p.status === "published")
      .sort((a, b) => a.sort - b.sort)
      .map(founderView);
    const shortlist = db.shortlist.map((line) => ({
      product_id: line.product_id, qty: line.qty,
      product: founderView(db.products.find((p) => p.id === line.product_id)),
    }));
    return settle({
      catalog,
      shortlist,
      shortlist_subtotal: shortlist.reduce(
        (a, l) => a + (l.product.price || 0) * l.qty, 0),
      requests: db.requests.filter((r) => r.application_id === ME),
    });
  };

  const addToShortlist = (productId, qty = 1) => {
    if (!db.products.some((p) => p.id === productId)) return reject("unknown_product");
    const line = db.shortlist.find((s) => s.product_id === productId);
    if (line) line.qty += qty;
    else db.shortlist.push({ product_id: productId, qty });
    return settle(undefined);
  };

  const removeFromShortlist = (productId) => {
    db.shortlist = db.shortlist.filter((s) => s.product_id !== productId);
    return settle(undefined);
  };

  // Plain call, NOT this.removeFromShortlist -- survives destructuring.
  const setShortlistQty = (productId, qty) => {
    if (qty <= 0) return removeFromShortlist(productId);
    const line = db.shortlist.find((s) => s.product_id === productId);
    if (line) line.qty = qty;
    else db.shortlist.push({ product_id: productId, qty });
    return settle(undefined);
  };

  const pushToProcurement = () => {
    const pushed = db.shortlist.length;
    db.shortlist.forEach((line) => {
      const p = db.products.find((x) => x.id === line.product_id);
      db.procurement.push({
        item: p.name, qty: line.qty, estimate: p.price || 0,
        vendor: vendorOf(p)?.display_name || "", status: "estimate",
      });
    });
    db.shortlist = [];
    return settle({ pushed });
  };

  const createRequest = (patch) => {
    try { assertWritable(patch, WRITABLE.request); } catch (e) { return Promise.reject(e); }
    const p = db.products.find((x) => x.id === patch.product_id);
    if (!p) return reject("unknown_product");
    const open = db.requests.find((r) => r.product_id === p.id
      && r.application_id === ME && ["pending", "approved"].includes(r.status));
    if (open) return reject("already_requested");
    const created = {
      id: uid("req"), application_id: ME, product_id: p.id, vendor_id: p.vendor_id,
      note: patch.note || "", qty: patch.qty ?? null, status: "pending",
      decision_note: "", decided_at: null, created_at: new Date().toISOString(),
    };
    db.requests.push(created);
    return settle(created);
  };

  const withdrawRequest = (id) => {
    const r = db.requests.find((x) => x.id === id && x.application_id === ME);
    if (!r) return reject("not_found");
    r.status = "withdrawn";
    return settle(r);
  };

  const submitVendorReview = (vendorId, patch) => {
    try { assertWritable(patch, WRITABLE.review); } catch (e) { return Promise.reject(e); }
    if (!vendorApprovedFor(vendorId)) return reject("not_eligible");
    const existing = db.reviews.find(
      (r) => r.vendor_id === vendorId && r.application_id === ME);
    if (existing) {
      Object.assign(existing, { ...patch, status: "pending" });
      return settle(existing);
    }
    const created = {
      id: uid("r"), vendor_id: vendorId, application_id: ME,
      author_name: "You", author_venture: "Your venture",
      rating: patch.rating, body: patch.body, status: "pending",
      created_at: new Date().toISOString(),
    };
    db.reviews.push(created);
    return settle(created);
  };

  return {
    listCategories, listSpecFields,
    getVendorMe, saveVendorProfile, submitVendorProfile,
    listVendorProducts, getVendorProduct, createVendorProduct, updateVendorProduct,
    submitProduct, retireProduct, deleteVendorProduct,
    adminListVendors, inviteVendor, approveVendor, suspendVendor,
    adminListProducts, publishProduct, sendBackProduct,
    saveCategory, deleteCategory, saveSpecField, archiveSpecField,
    listRequests, approveRequest, declineRequest,
    listVendorReviews, moderateVendorReview, deleteVendorReview,
    insights,
    founderStore, addToShortlist, setShortlistQty, removeFromShortlist,
    pushToProcurement, createRequest, withdrawRequest, submitVendorReview,
  };
}

// Shared singleton so every screen in the preview sees the same edits.
export const artInfraMock = createArtInfraStore();
```

- [ ] **Step 4: Run the mock tests**

Run: `npx vitest run src/lib/__tests__/artInfraMock.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Confirm the old screens are the only breakage**

Run: `npx vitest run`
Expected: the 2 baseline `AdminPipeline` failures **plus** failures in the existing Art Infra screen tests, which still call Phase-1 method names (`listProducts`, `saveProduct`, `listVendors`, `listReviews`, `moderateReview`). That is expected at this point — Tasks 8–12 rewire them. Record the failing file list in your report so the controller can confirm it shrinks to zero by Task 12.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/artInfraMock.js frontend/src/lib/__tests__/artInfraMock.test.js
git commit -m "feat(vendor-portal): hostile mock store for all three portals"
```

---
### Task 5: Vendor portal shell, route and view-as-vendor switch

There is no `vendor` role and no vendor login in this phase, so the shell carries a **view-as** picker that stands in for authentication. It is the single place the acting vendor id is decided; every screen receives it as a prop and no screen reads it from anywhere else.

**Files:**
- Create: `frontend/src/pages/vendor/VendorPortal.jsx`
- Create: `frontend/src/styles/vendor-portal.css`
- Modify: `frontend/src/router.jsx` (after the `/founder/*` block, ~line 382)
- Test: `frontend/src/pages/vendor/__tests__/VendorPortal.test.jsx`

**Interfaces:**
- Consumes: `artInfraMock.adminListVendors()`, `getVendorMe(vendorId)`.
- Produces: `<VendorPortal store={...} />`; renders `VendorProfile`, `VendorCatalog`, `VendorProductEditor` (Tasks 6–8) with props `{ store, vendorId }`.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VendorPortal from "../VendorPortal.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store;
beforeEach(() => { configure({ minMs: 0, maxMs: 0 }); store = createArtInfraStore(); });

describe("VendorPortal", () => {
  it("renders the three sub-nav entries", async () => {
    render(<VendorPortal store={store} />);
    await screen.findByRole("button", { name: "Profile" });
    expect(screen.getByRole("button", { name: "My catalog" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New product" })).toBeInTheDocument();
  });

  it("shows a view-as picker listing real vendors", async () => {
    render(<VendorPortal store={store} />);
    const picker = await screen.findByLabelText("Viewing as vendor");
    await waitFor(() => expect(picker.options.length).toBeGreaterThan(1));
  });

  it("switching vendor re-scopes the screen", async () => {
    render(<VendorPortal store={store} />);
    const picker = await screen.findByLabelText("Viewing as vendor");
    const second = picker.options[1].value;
    fireEvent.change(picker, { target: { value: second } });
    await waitFor(() => expect(picker.value).toBe(second));
  });

  it("marks the active sub-nav entry with aria-current", async () => {
    render(<VendorPortal store={store} />);
    const profile = await screen.findByRole("button", { name: "Profile" });
    expect(profile).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "My catalog" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "My catalog" }))
        .toHaveAttribute("aria-current", "page"));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/vendor/__tests__/VendorPortal.test.jsx`
Expected: FAIL — cannot resolve `../VendorPortal.jsx`.

- [ ] **Step 3: Implement the shell**

```jsx
// Vendor portal shell. The editor is not in the sub-nav: it is reached by
// opening a row from the catalog, the same way AdminDetail is reached from
// AdminPipeline.
//
// The view-as picker stands in for vendor authentication, which does not exist
// in this phase. It is the ONLY place the acting vendor id is decided --
// every screen takes it as a prop so that swapping in a real session later
// touches one file.

import "../../styles/vendor-portal.css";

import { useEffect, useState } from "react";
import { artInfraMock } from "../../lib/artInfraMock.js";
import VendorProfile from "./VendorProfile.jsx";
import VendorCatalog from "./VendorCatalog.jsx";
import VendorProductEditor from "./VendorProductEditor.jsx";

const VIEWS = [
  { id: "profile", label: "Profile" },
  { id: "catalog", label: "My catalog" },
];

export default function VendorPortal({ store = artInfraMock }) {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [view, setView] = useState("profile");
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let live = true;
    store.adminListVendors().then((rows) => {
      if (!live) return;
      setVendors(rows);
      setVendorId((cur) => cur || rows[0]?.id || "");
    }).catch(() => { if (live) setVendors([]); });
    return () => { live = false; };
  }, [store]);

  const goEditor = (productId) => { setEditingId(productId); setView("editor"); };
  const backToCatalog = () => { setEditingId(null); setView("catalog"); };

  if (!vendorId) return <div className="vendor-portal"><div className="adm-async adm-async-empty">Loading…</div></div>;

  return (
    <div className="vendor-portal">
      <nav className="vp-subnav" aria-label="Vendor sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`vp-subnav-btn${view === v.id ? " is-on" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => { setEditingId(null); setView(v.id); }}
          >
            {v.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <label className="vp-viewas">
          <span>Viewing as</span>
          <select
            className="os-input"
            aria-label="Viewing as vendor"
            value={vendorId}
            onChange={(e) => { setEditingId(null); setVendorId(e.target.value); }}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.display_name || v.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="os-btn" onClick={() => goEditor(null)}>
          + New product
        </button>
      </nav>

      {view === "profile" && <VendorProfile store={store} vendorId={vendorId} />}
      {view === "catalog" && <VendorCatalog store={store} vendorId={vendorId} goEditor={goEditor} />}
      {view === "editor" && (
        <VendorProductEditor store={store} vendorId={vendorId}
          productId={editingId} onDone={backToCatalog} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the stylesheet**

`frontend/src/styles/vendor-portal.css` — tokens only, radius 2px, everything scoped under `.vendor-portal`:

```css
/* Vendor portal. Scoped entirely under .vendor-portal so nothing leaks into
   the admin or founder shells. Tokens only -- no colour literals. */

.vendor-portal { padding: 24px 32px 80px; background: var(--bg); color: var(--ink); }

.vendor-portal .vp-subnav {
  display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 24px;
}
.vendor-portal .vp-subnav-btn {
  background: none; border: 1px solid transparent; border-radius: 2px;
  padding: 8px 14px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-soft); cursor: pointer;
}
.vendor-portal .vp-subnav-btn.is-on {
  border-color: var(--line-strong); background: var(--bg-soft); color: var(--ink);
}
.vendor-portal .vp-viewas { display: inline-flex; align-items: center; gap: 8px; }
.vendor-portal .vp-viewas span {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim);
}

.vendor-portal .vp-form { display: grid; gap: 16px; max-width: 720px; }
.vendor-portal .vp-form label { display: grid; gap: 6px; font-size: 13px; color: var(--ink-soft); }
.vendor-portal .vp-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.vendor-portal .vp-editor { display: grid; grid-template-columns: 1fr 380px; gap: 32px; }
.vendor-portal .vp-editor-form { display: grid; gap: 16px; }
.vendor-portal .vp-editor-preview {
  border-left: 1px solid var(--line); padding-left: 24px;
}

.vendor-portal .vp-field-err { font-size: 12px; color: #c84a1a; }
.vendor-portal .vp-help { font-size: 12px; color: var(--ink-dim); }
.vendor-portal .vp-multi { display: flex; flex-wrap: wrap; gap: 8px; }
.vendor-portal .vp-multi label {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--line); border-radius: 2px; padding: 4px 10px; font-size: 13px;
}
.vendor-portal .vp-note {
  border: 1px solid var(--line-strong); background: var(--bg-soft);
  border-radius: 2px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px;
}
.vendor-portal .vp-row-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 5: Register the route**

In `frontend/src/router.jsx`, add the import beside the founder imports and this route immediately after the `/founder/*` block:

```jsx
import VendorPortal from "./pages/vendor/VendorPortal.jsx";
```

```jsx
      {/* Vendor portal. No ProtectedRoute yet: the `vendor` role does not
          exist in this phase and the shell's view-as picker stands in for a
          session. Gate this the moment the role ships. */}
      <Route path="/vendor" element={<VendorPortal />} />
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/pages/vendor/__tests__/VendorPortal.test.jsx`
Expected: PASS, 4 tests. (Tasks 6–8 create the three child screens; until then, stub them as `export default function X() { return null; }` in their files so the import resolves — replace the stub in each task.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/vendor frontend/src/styles/vendor-portal.css frontend/src/router.jsx
git commit -m "feat(vendor-portal): shell, sub-nav, view-as switch and route"
```

---

### Task 6: Vendor registration / profile screen

**Files:**
- Create (replace stub): `frontend/src/pages/vendor/VendorProfile.jsx`
- Test: `frontend/src/pages/vendor/__tests__/VendorProfile.test.jsx`

**Interfaces:**
- Consumes: `store.getVendorMe(vendorId)`, `store.saveVendorProfile(vendorId, patch)`, `store.submitVendorProfile(vendorId)`, `store.listCategories()`.
- Produces: `<VendorProfile store vendorId />`.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VendorProfile from "../VendorProfile.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  vendorId = (await store.adminListVendors())[0].id;
});

describe("VendorProfile", () => {
  it("renders the required identity fields", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    for (const l of ["Display name", "Website", "Contact name", "Contact email",
      "Contact phone", "City", "Capabilities"]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
  });

  it("does NOT collect bank details or PAN", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    expect(screen.queryByLabelText(/bank/i)).toBeNull();
    expect(screen.queryByLabelText(/IFSC/i)).toBeNull();
    expect(screen.queryByLabelText(/^PAN$/i)).toBeNull();
  });

  it("persists an edit", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    const website = await screen.findByLabelText("Website");
    fireEvent.change(website, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(async () => {
      const v = await store.getVendorMe(vendorId);
      expect(v.website).toBe("https://example.com");
    });
  });

  it("surfaces a save failure instead of silently succeeding", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText(/could not save/i);
  });

  it("clears a stale error after a later success", async () => {
    render(<VendorProfile store={store} vendorId={vendorId} />);
    await screen.findByLabelText("Legal name");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText(/could not save/i);
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.queryByText(/could not save/i)).toBeNull());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/vendor/__tests__/VendorProfile.test.jsx`
Expected: FAIL — the stub renders `null`, so `findByLabelText` times out.

- [ ] **Step 3: Implement**

```jsx
// Vendor registration and profile.
//
// Field set is fixed by the design spec. Bank details, IFSC and PAN are
// DELIBERATELY ABSENT: ARTPARK never pays the vendor, so they are PII with no
// feature behind them. Do not add them.

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";

const TEXT_FIELDS = [
  ["legal_name", "Legal name", true],
  ["display_name", "Display name", true],
  ["website", "Website", true],
  ["contact_name", "Contact name", true],
  ["contact_email", "Contact email", true],
  ["contact_phone", "Contact phone", true],
  ["city", "City", true],
  ["state", "State", false],
  ["country", "Country", false],
  ["gstin", "GSTIN", false],
  ["udyam_number", "Udyam number", false],
  ["cin", "CIN", false],
];

const WRITABLE = TEXT_FIELDS.map(([k]) => k).concat(["capabilities", "categories_served"]);

export default function VendorProfile({ store, vendorId }) {
  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let live = true;
    store.getVendorMe(vendorId)
      .then((v) => { if (live) { setForm(v); setError(""); } })
      .catch(() => { if (live) setError("Could not load this vendor."); });
    return () => { live = false; };
  }, [store, vendorId]);
  useEffect(load, [load]);

  useEffect(() => {
    let live = true;
    store.listCategories().then((c) => { if (live) setCategories(c); }).catch(() => {});
    return () => { live = false; };
  }, [store]);

  if (!form) {
    return <div className="adm-async adm-async-empty">{error || "Loading…"}</div>;
  }

  const set = (k, v) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })); };

  const toggleCategory = (id) => {
    const cur = form.categories_served || [];
    set("categories_served", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  // Build the PATCH explicitly from writable keys. Spreading `form` would send
  // the read model back (status, user_ids, name) and a real API would 422.
  const save = async () => {
    setBusy(true);
    try {
      const patch = {};
      for (const k of WRITABLE) if (form[k] !== undefined) patch[k] = form[k];
      await store.saveVendorProfile(vendorId, patch);
      setError("");
      setSaved(true);
    } catch {
      setError("Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Vendor" title="Your profile"
        sub="ARTPARK shares these details with a founder only after approving their request." />

      {error && <div className="inline-error">{error}</div>}
      {saved && <div className="vp-note">Profile saved.</div>}
      {form.status !== "approved" && (
        <div className="vp-note">
          Status: <strong>{form.status}</strong>. Your products stay hidden from founders
          until ARTPARK approves your account.
        </div>
      )}

      <div className="vp-form">
        {TEXT_FIELDS.map(([key, label]) => (
          <label key={key}>{label}
            <input className="os-input" aria-label={label} value={form[key] ?? ""}
              onChange={(e) => set(key, e.target.value)} />
          </label>
        ))}

        <label>Capabilities
          <textarea className="os-input" aria-label="Capabilities" rows={4}
            value={form.capabilities ?? ""}
            onChange={(e) => set("capabilities", e.target.value)} />
          <span className="vp-help">What you actually supply, in your own words.</span>
        </label>

        <div>
          <div className="section-lbl">Categories served</div>
          <div className="vp-multi">
            {categories.map((c) => (
              <label key={c.id}>
                <input type="checkbox"
                  checked={(form.categories_served || []).includes(c.id)}
                  onChange={() => toggleCategory(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="vp-row-actions">
          <button type="button" className="os-btn" disabled={busy} onClick={save}>
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/vendor/__tests__/VendorProfile.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/vendor/VendorProfile.jsx frontend/src/pages/vendor/__tests__/VendorProfile.test.jsx
git commit -m "feat(vendor-portal): registration and profile screen"
```

---
### Task 7: Vendor catalog list

**Files:**
- Create (replace stub): `frontend/src/pages/vendor/VendorCatalog.jsx`
- Test: `frontend/src/pages/vendor/__tests__/VendorCatalog.test.jsx`

**Interfaces:**
- Consumes: `store.listVendorProducts(vendorId, {status, search})`, `store.submitProduct`, `store.retireProduct`, `store.deleteVendorProduct`.
- Produces: `<VendorCatalog store vendorId goEditor />` where `goEditor(productId)` opens Task 8's editor.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VendorCatalog from "../VendorCatalog.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  const vendors = await store.adminListVendors();
  vendorId = vendors.find((v) => v.id === "knowles")?.id || vendors[0].id;
});

describe("VendorCatalog", () => {
  it("lists only this vendor's products", async () => {
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    const { items } = await store.listVendorProducts(vendorId);
    for (const p of items) expect(screen.getByText(p.name)).toBeInTheDocument();
  });

  it("shows the admin's send-back note on a returned draft", async () => {
    const p = await store.createVendorProduct(vendorId, { name: "Returned", category_id: "sensors" });
    await store.submitProduct(vendorId, p.id);
    await store.sendBackProduct(p.id, "Add a datasheet");
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText("Add a datasheet");
  });

  it("submits a draft for review", async () => {
    const p = await store.createVendorProduct(vendorId, { name: "Fresh", category_id: "sensors" });
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText("Fresh");
    fireEvent.click(screen.getByRole("button", { name: `Submit Fresh for review` }));
    await waitFor(async () => {
      const got = await store.getVendorProduct(vendorId, p.id);
      expect(got.status).toBe("pending_review");
    });
  });

  it("opens the editor when the name is clicked", async () => {
    const goEditor = vi.fn();
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={goEditor} />);
    const { items } = await store.listVendorProducts(vendorId);
    await screen.findByText(items[0].name);
    fireEvent.click(screen.getByRole("button", { name: items[0].name }));
    expect(goEditor).toHaveBeenCalledWith(items[0].id);
  });

  it("reports a load failure", async () => {
    configure({ failNext: "server_error" });
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    await screen.findByText(/could not load/i);
  });

  it("ignores a stale response that lands after a newer one", async () => {
    // Guard proof: the screen must commit only the newest request's result.
    render(<VendorCatalog store={store} vendorId={vendorId} goEditor={vi.fn()} />);
    const search = await screen.findByLabelText("Search products");
    fireEvent.change(search, { target: { value: "zzzz" } });
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText(/no products/i)).toBeNull());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/vendor/__tests__/VendorCatalog.test.jsx`
Expected: FAIL — stub renders `null`.

- [ ] **Step 3: Implement**

```jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";
import ListToolbar from "../admin/platform/screens/ListToolbar";

const STATUS_SEGMENTS = [
  ["", "All"], ["draft", "Draft"], ["pending_review", "In review"],
  ["published", "Published"], ["retired", "Retired"],
];

const fmtPrice = (p) =>
  p.pricing === "quote" ? "On request"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR",
        maximumFractionDigits: 0 }).format(p.price || 0);

export default function VendorCatalog({ store, vendorId, goEditor }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Monotonic request id: only the newest response may commit state. Without
  // this a slow early keystroke overwrites a fast later one.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myId = ++reqIdRef.current;
    try {
      const { items, total: t } = await store.listVendorProducts(vendorId, { search, status });
      if (myId !== reqIdRef.current) return;   // stale — a newer request won
      setRows(items);
      setTotal(t);
      setError("");
    } catch {
      if (myId !== reqIdRef.current) return;
      setError("Could not load your catalog.");
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }, [store, vendorId, search, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, ...args) => {
    try { await fn(...args); setError(""); await load(); }
    catch { setError("That didn't go through. Please try again."); }
  };

  return (
    <div>
      <PageHead eyebrow="Vendor" title="My catalog"
        sub="Drafts are private. Submitted products go to ARTPARK for review before founders see them." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search products" searchPlaceholder="Search your products…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus,
          options: STATUS_SEGMENTS }]}
        count={rows.length} total={total}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading catalog…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Product</th><th>Category</th><th>Price</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <button type="button" className="ai-linkbtn" onClick={() => goEditor(p.id)}>
                    {p.name}
                  </button>
                  {p.review_note && <div className="os-sub">{p.review_note}</div>}
                </td>
                <td>{p.category_id}</td>
                <td>{fmtPrice(p)}</td>
                <td><span className={`ai-status ai-status-${p.status}`}>{p.status}</span></td>
                <td className="vp-row-actions">
                  {p.status === "draft" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Submit ${p.name} for review`}
                      onClick={() => act(store.submitProduct, vendorId, p.id)}>
                      Submit for review
                    </button>
                  )}
                  {p.status === "published" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Retire ${p.name}`}
                      onClick={() => act(store.retireProduct, vendorId, p.id)}>
                      Retire
                    </button>
                  )}
                  {p.status === "draft" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => act(store.deleteVendorProduct, vendorId, p.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="tbl-empty">No products match these filters.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/vendor/__tests__/VendorCatalog.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/vendor/VendorCatalog.jsx frontend/src/pages/vendor/__tests__/VendorCatalog.test.jsx
git commit -m "feat(vendor-portal): own-catalog list with request-id guard"
```

---

### Task 8: The dynamic product editor

The requirement — "the details cells change depending on the product" — lands here. Choosing a category re-renders the spec section from the registry.

**Files:**
- Create: `frontend/src/pages/vendor/components/SpecFieldInput.jsx`
- Create (replace stub): `frontend/src/pages/vendor/VendorProductEditor.jsx`
- Test: `frontend/src/pages/vendor/__tests__/VendorProductEditor.test.jsx`

**Interfaces:**
- Consumes: `describeFields`, `emptyValues`, `coerceValue`, `validateSpecs` (Task 3); `store.listSpecFields`, `store.listCategories`, `store.getVendorProduct`, `store.createVendorProduct`, `store.updateVendorProduct`; `ProductCard`/`ProductModal` from `pages/founder/components/`.
- Produces: `<SpecFieldInput field value onChange error />`, `<VendorProductEditor store vendorId productId onDone />`.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VendorProductEditor from "../VendorProductEditor.jsx";
import { createArtInfraStore } from "../../../lib/artInfraMock.js";
import { configure } from "../../../lib/artInfraLatency.js";

let store, vendorId;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  vendorId = (await store.adminListVendors())[0].id;
});

const renderNew = () =>
  render(<VendorProductEditor store={store} vendorId={vendorId}
    productId={null} onDone={vi.fn()} />);

describe("VendorProductEditor — dynamic spec fields", () => {
  it("shows no spec fields until a category is chosen", async () => {
    renderNew();
    await screen.findByLabelText("Name");
    expect(screen.getByText(/choose a category/i)).toBeInTheDocument();
  });

  it("renders the Sensors field set when Sensors is chosen", async () => {
    renderNew();
    const cat = await screen.findByLabelText("Category");
    fireEvent.change(cat, { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    expect(screen.getByLabelText("Channels")).toBeInTheDocument();
    expect(screen.getByLabelText("SNR")).toBeInTheDocument();
  });

  it("swaps the whole field set when the category changes", async () => {
    renderNew();
    const cat = await screen.findByLabelText("Category");
    fireEvent.change(cat, { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.change(cat, { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    // The sensor-only field must be GONE, not merely hidden.
    expect(screen.queryByLabelText("Sensing modality")).toBeNull();
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });

  it("renders a unit next to a number field that declares one", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("SNR");
    expect(screen.getByText("dB(A)")).toBeInTheDocument();
  });

  it("renders a multi_enum as checkboxes, not a text box", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText("Category"), { target: { value: "fabrication" } });
    await screen.findByLabelText("Process");
    expect(screen.getByRole("checkbox", { name: "Aluminium" })).toBeInTheDocument();
  });

  it("blocks save when a required spec field is empty, and says which", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Sensing modality is required/i);
  });

  it("saves a valid product and sends only writable fields", async () => {
    const onDone = vi.fn();
    render(<VendorProductEditor store={store} vendorId={vendorId}
      productId={null} onDone={onDone} />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Mic" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "sensors" } });
    await screen.findByLabelText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Sensing modality"), { target: { value: "Acoustic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // If the editor spread its read model, the mock would reject the write.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the preview-as-founder pane", async () => {
    renderNew();
    await screen.findByTestId("founder-preview");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/vendor/__tests__/VendorProductEditor.test.jsx`
Expected: FAIL — stub renders `null`.

- [ ] **Step 3: Implement `SpecFieldInput`**

```jsx
// Renders exactly one registry-defined field. All type branching lives here so
// the editor stays a layout component.

export default function SpecFieldInput({ field, value, onChange, error }) {
  const label = field.label + (field.required ? " *" : "");

  if (field.data_type === "boolean") {
    return (
      <label>
        <input type="checkbox" aria-label={field.label} checked={!!value}
          onChange={(e) => onChange(e.target.checked)} />
        {" "}{label}
        {error && <span className="vp-field-err">{error}</span>}
      </label>
    );
  }

  if (field.data_type === "enum") {
    return (
      <label>{label}
        <select className="os-input" aria-label={field.label} value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.enum_options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {field.help_text && <span className="vp-help">{field.help_text}</span>}
        {error && <span className="vp-field-err">{error}</span>}
      </label>
    );
  }

  if (field.data_type === "multi_enum") {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) =>
      onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
    return (
      <div>
        <div className="section-lbl">{label}</div>
        <div className="vp-multi">
          {(field.enum_options || []).map((o) => (
            <label key={o}>
              <input type="checkbox" aria-label={o} checked={selected.includes(o)}
                onChange={() => toggle(o)} />
              {o}
            </label>
          ))}
        </div>
        {error && <span className="vp-field-err">{error}</span>}
      </div>
    );
  }

  // text and number
  return (
    <label>{label}
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="os-input"
          aria-label={field.label}
          type={field.data_type === "number" ? "number" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && <span className="vp-help">{field.unit}</span>}
      </span>
      {field.help_text && <span className="vp-help">{field.help_text}</span>}
      {error && <span className="vp-field-err">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 4: Implement the editor**

```jsx
// Category first -- it decides the whole spec form. The preview pane mounts
// the REAL founder components so a vendor sees what a founder will see.

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";
import ProductCard from "../founder/components/ProductCard.jsx";
import ProductModal from "../founder/components/ProductModal.jsx";
import SpecFieldInput from "./components/SpecFieldInput.jsx";
import {
  describeFields, emptyValues, coerceValue, validateSpecs,
} from "../../lib/specFieldForm.js";

const BLANK = {
  name: "", blurb: "", description: "", category_id: "", type: "Hardware",
  pricing: "fixed", price: null,
  lead_time_weeks_min: null, lead_time_weeks_max: null, specs: {},
};

// Exactly the writable set. Building the PATCH from this rather than spreading
// the loaded object is what stops read-model fields reaching the API.
const WRITABLE = ["name", "blurb", "description", "category_id", "type", "pricing",
  "price", "lead_time_weeks_min", "lead_time_weeks_max", "specs"];

export default function VendorProductEditor({ store, vendorId, productId, onDone }) {
  const [form, setForm] = useState(productId ? null : { ...BLANK });
  const [categories, setCategories] = useState([]);
  const [allFields, setAllFields] = useState([]);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let live = true;
    Promise.all([store.listCategories(), store.listSpecFields()])
      .then(([c, f]) => { if (live) { setCategories(c); setAllFields(f); } })
      .catch(() => { if (live) setBanner("Could not load categories."); });
    return () => { live = false; };
  }, [store]);

  const load = useCallback(async () => {
    if (!productId) { setForm({ ...BLANK }); return; }
    const myId = ++reqIdRef.current;
    try {
      const p = await store.getVendorProduct(vendorId, productId);
      if (myId !== reqIdRef.current) return;
      setForm(p ? { ...p, specs: p.specs || {} } : { ...BLANK });
    } catch {
      if (myId === reqIdRef.current) setBanner("Could not load this product.");
    }
  }, [store, vendorId, productId]);
  useEffect(() => { load(); }, [load]);

  if (!form) return <div className="adm-async adm-async-empty">{banner || "Loading…"}</div>;

  const fields = describeFields(allFields, form.category_id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setCategory = (categoryId) => {
    // Values from the previous category are not valid keys for the new one, so
    // the spec bag resets rather than carrying orphans the API would reject.
    const next = describeFields(allFields, categoryId);
    setErrors({});
    setForm((f) => ({ ...f, category_id: categoryId, specs: emptyValues(next) }));
  };

  const setSpec = (field, raw) =>
    setForm((f) => ({ ...f, specs: { ...f.specs, [field.key]: coerceValue(field, raw) } }));

  const preview = {
    ...form,
    id: form.id || "preview",
    vendor: { id: vendorId, name: "Your company" },
    category: categories.find((c) => c.id === form.category_id) || { label: "(no category)" },
    spec_fields: fields,
    datasheets: [], rating: { avg: 0, count: 0 },
    contact_state: "none", can_review: false, my_review: null, in_shortlist_qty: 0,
  };

  const save = async () => {
    if (!form.name.trim()) { setBanner("A product needs a name."); return; }
    const result = validateSpecs(fields, form.specs || {});
    setErrors(result.errors);
    if (!result.ok) {
      setBanner(Object.values(result.errors)[0]);
      return;
    }
    setBusy(true);
    try {
      const patch = {};
      for (const k of WRITABLE) if (form[k] !== undefined) patch[k] = form[k];
      if (productId) await store.updateVendorProduct(vendorId, productId, patch);
      else await store.createVendorProduct(vendorId, patch);
      setBanner("");
      onDone();
    } catch (e) {
      setBanner(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Vendor" title={productId ? "Edit product" : "New product"}
        breadcrumb={[{ label: "My catalog", onClick: onDone },
          { label: form.name || "New product" }]}
        actions={
          <>
            <button type="button" className="os-btn ghost" onClick={onDone}>Cancel</button>
            <button type="button" className="os-btn" disabled={busy} onClick={save}>Save</button>
          </>
        } />

      {banner && <div className="inline-error">{banner}</div>}

      <div className="vp-editor">
        <div className="vp-editor-form">
          <label>Name
            <input className="os-input" aria-label="Name" value={form.name}
              onChange={(e) => set("name", e.target.value)} />
          </label>

          <label>Category
            <select className="os-input" aria-label="Category" value={form.category_id}
              onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="vp-help">The category decides which details you fill in below.</span>
          </label>

          <label>Type
            <select className="os-input" aria-label="Type" value={form.type}
              onChange={(e) => set("type", e.target.value)}>
              <option>Hardware</option><option>Software</option>
            </select>
          </label>

          <label>Pricing
            <select className="os-input" aria-label="Pricing" value={form.pricing}
              onChange={(e) => setForm((f) => ({
                ...f, pricing: e.target.value,
                price: e.target.value === "quote" ? null : f.price,
              }))}>
              <option value="fixed">Fixed price</option>
              <option value="quote">On request</option>
            </select>
          </label>

          {form.pricing === "fixed" && (
            <label>Price (₹)
              <input className="os-input" type="number" aria-label="Price (₹)"
                value={form.price ?? ""}
                onChange={(e) => set("price",
                  e.target.value === "" ? null : Number(e.target.value))} />
            </label>
          )}

          <label>Blurb (card line)
            <input className="os-input" aria-label="Blurb (card line)" value={form.blurb}
              onChange={(e) => set("blurb", e.target.value)} />
          </label>

          <label>Description
            <textarea className="os-input" aria-label="Description" rows={5}
              value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>

          <div className="section-lbl">Details</div>
          {!form.category_id && (
            <p className="vp-help">Choose a category to see the details for this kind of product.</p>
          )}
          {fields.map((f) => (
            <SpecFieldInput key={f.key} field={f} value={form.specs?.[f.key]}
              error={errors[f.key]} onChange={(raw) => setSpec(f, raw)} />
          ))}
        </div>

        <aside className="vp-editor-preview" data-testid="founder-preview">
          <div className="section-lbl">Preview as founder</div>
          <div className="founder-portal">
            <div className="pgrid">
              <ProductCard product={preview} onOpen={() => setShowModal(true)}
                onPrimary={() => setShowModal(true)} />
            </div>
          </div>
          <button type="button" className="os-btn ghost" onClick={() => setShowModal(true)}>
            Open the detail view
          </button>
        </aside>
      </div>

      {showModal && (
        <div className="founder-portal">
          <ProductModal product={preview} onClose={() => setShowModal(false)}
            onPrimary={() => {}} onSubmitReview={async () => {}} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/pages/vendor/__tests__/VendorProductEditor.test.jsx`
Expected: PASS, 8 tests. If the last two fail on `ProductCard`/`ProductModal` props, that is Task 9's rework — note it and continue; re-run after Task 9.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/vendor/VendorProductEditor.jsx frontend/src/pages/vendor/components frontend/src/pages/vendor/__tests__/VendorProductEditor.test.jsx
git commit -m "feat(vendor-portal): registry-driven product editor with founder preview"
```

---
### Task 9: Rework the founder Art Infra page

"Show contact" becomes a four-state "Request contact". Ratings become vendor-level. Specs render from the registry. The shortlist, quantities, subtotal and Push-to-procurement are untouched.

**Files:**
- Modify: `frontend/src/pages/founder/components/ProductCard.jsx`
- Modify: `frontend/src/pages/founder/components/ProductModal.jsx`
- Modify: `frontend/src/pages/founder/FounderStore.jsx`
- Test: `frontend/src/pages/founder/__tests__/ProductCard.test.jsx` (extend), `ProductModal.test.jsx` (extend), `FounderStore.artinfra.test.jsx` (extend)

**Interfaces:**
- Consumes: `founderView` shape from Task 4 — `contact_state`, `request_id`, `request_note`, `spec_fields`, vendor-level `rating`, `can_review`, `my_review`.
- Produces: `primaryLabel(product)` exported from `ProductCard.jsx` returning one of `Add to shortlist` / `Request contact` / `Requested — awaiting approval` / `Contact available` / `Request declined`.

- [ ] **Step 1: Write the failing tests**

Append to `ProductCard.test.jsx`:

```javascript
import { primaryLabel } from "../components/ProductCard.jsx";

describe("four-state primary button", () => {
  const quote = { ...base, pricing: "quote" };

  it("offers Request contact when nothing has been asked", () => {
    expect(primaryLabel({ ...quote, contact_state: "none" })).toBe("Request contact");
  });
  it("reports a pending request and disables the button", () => {
    expect(primaryLabel({ ...quote, contact_state: "pending" }))
      .toBe("Requested — awaiting approval");
  });
  it("reports availability once approved", () => {
    expect(primaryLabel({ ...quote, contact_state: "approved" })).toBe("Contact available");
  });
  it("reports a decline", () => {
    expect(primaryLabel({ ...quote, contact_state: "declined" })).toBe("Request declined");
  });
  it("keeps Add to shortlist for fixed-price items", () => {
    expect(primaryLabel({ ...base, pricing: "fixed", contact_state: "none" }))
      .toBe("Add to shortlist");
  });
  it("never says Show contact or Request quote anywhere", () => {
    for (const s of ["none", "pending", "approved", "declined"]) {
      const label = primaryLabel({ ...quote, contact_state: s });
      expect(label).not.toMatch(/show contact/i);
      expect(label).not.toMatch(/request quote/i);
    }
  });
});
```

Append to `FounderStore.artinfra.test.jsx`:

```javascript
describe("request flow", () => {
  it("raises a request and shows the pending state", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const btn = (await screen.findAllByRole("button", { name: "Request contact" }))[0];
    fireEvent.click(btn);
    const note = await screen.findByLabelText("What do you need?");
    fireEvent.change(note, { target: { value: "Need 4 units by October" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText("Requested — awaiting approval");
  });

  it("shows the contact block once an admin approves, without a reload", async () => {
    const store = createArtInfraStore();
    const { catalog } = await store.founderStore();
    const quote = catalog.find((p) => p.pricing === "quote");
    const req = await store.createRequest({ product_id: quote.id, note: "x" });
    await store.approveRequest(req.id);
    render(<FounderStore store={store} />);
    await screen.findAllByRole("button", { name: "Contact available" });
  });

  it("surfaces a failed request instead of appearing to succeed", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const btn = (await screen.findAllByRole("button", { name: "Request contact" }))[0];
    fireEvent.click(btn);
    fireEvent.change(await screen.findByLabelText("What do you need?"),
      { target: { value: "x" } });
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(/could not send/i);
  });

  it("leaves the shortlist mechanics alone", async () => {
    const store = createArtInfraStore();
    render(<FounderStore store={store} />);
    const add = (await screen.findAllByRole("button", { name: "Add to shortlist" }))[0];
    fireEvent.click(add);
    await screen.findByTestId("shortlist-count");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/founder/__tests__/`
Expected: FAIL — `primaryLabel` is not exported with the new signature and the request UI does not exist.

- [ ] **Step 3: Rework `ProductCard.jsx`**

Replace `primaryLabel` and the button block:

```jsx
// Fixed-price items go on the shortlist. Quote-priced items need an ARTPARK-
// approved request before their vendor's contact is disclosed -- the payload
// does not even carry it until then.
export function primaryLabel(product) {
  if (product.pricing !== "quote") return "Add to shortlist";
  switch (product.contact_state) {
    case "pending": return "Requested — awaiting approval";
    case "approved": return "Contact available";
    case "declined": return "Request declined";
    default: return "Request contact";
  }
}

export function primaryDisabled(product) {
  return product.pricing === "quote" && product.contact_state === "pending";
}
```

and in the rendered button:

```jsx
        <button
          type="button"
          className={product.pricing === "quote" ? "mini ghost" : "mini"}
          disabled={busy || primaryDisabled(product)}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPrimary(product); }}
        >
          {primaryLabel(product)}
        </button>
```

**Also fix the Phase-1 bug this replaces:** the card's primary action for a quote-priced product previously called `onPrimary` → `addToShortlist`, silently shortlisting instead of disclosing. `FounderStore` now routes by `pricing` (Step 5), so the card stays dumb and the bug is gone.

- [ ] **Step 4: Rework `ProductModal.jsx`**

Three changes. Render specs from the registry:

```jsx
            <div>
              <div className="section-lbl">Specifications</div>
              {(product.spec_fields || []).map((f) => {
                const v = product.specs?.[f.key];
                if (v === null || v === undefined || v === "" ||
                    (Array.isArray(v) && v.length === 0)) return null;
                const shown = Array.isArray(v) ? v.join(", ")
                  : typeof v === "boolean" ? (v ? "Yes" : "No") : v;
                return (
                  <div className="spec-row" key={f.key}>
                    <span className="k">{f.label}</span>
                    <span className="v">{shown}{f.unit ? ` ${f.unit}` : ""}</span>
                  </div>
                );
              })}
              {(product.extra_specs || []).map((s, i) => (
                <div className="spec-row" key={`x${i}`}>
                  <span className="k">{s.k}</span><span className="v">{s.v}</span>
                </div>
              ))}
              {leadTime && (
                <div className="spec-row">
                  <span className="k">Lead time</span><span className="v">{leadTime}</span>
                </div>
              )}
            </div>
```

Replace the `showContact` state and `primary()` with a request form:

```jsx
  const [note, setNote] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);

  const primary = () => {
    if (product.pricing !== "quote") { onPrimary(product); return; }
    if (product.contact_state === "none" || product.contact_state === "declined") {
      setFormOpen(true);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await onRequestContact(product.id, note);
      setErr("");
      setFormOpen(false);
    } catch {
      setErr("Could not send your request. Please try again.");
    } finally {
      setSending(false);
    }
  };
```

and the right column below the primary button:

```jsx
            {formOpen && (
              <form className="rev-form" onSubmit={send}>
                <label>What do you need?
                  <textarea aria-label="What do you need?" value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Quantity, timeline, anything ARTPARK should know" />
                </label>
                {err && <div className="inline-error">{err}</div>}
                <button type="submit" className="mini" disabled={sending || !note.trim()}>
                  Send request
                </button>
              </form>
            )}

            {product.contact_state === "pending" && (
              <p className="muted">ARTPARK is reviewing your request.</p>
            )}
            {product.contact_state === "declined" && product.request_note && (
              <p className="muted">Declined: {product.request_note}</p>
            )}

            {product.contact_state === "approved" && (
              <div className="vendor-contact">
                <div className="section-lbl">Vendor contact</div>
                <div className="vc-row"><span className="k">Vendor</span><span className="v">{product.vendor?.name}</span></div>
                {product.vendor?.contact_name && <div className="vc-row"><span className="k">Contact</span><span className="v">{product.vendor.contact_name}</span></div>}
                {product.vendor?.contact_email && <div className="vc-row"><span className="k">Email</span><span className="v">{product.vendor.contact_email}</span></div>}
                {product.vendor?.contact_phone && <div className="vc-row"><span className="k">Phone</span><span className="v">{product.vendor.contact_phone}</span></div>}
              </div>
            )}
```

Change `ReviewForm`'s gate and target — it now reviews the **vendor**:

```jsx
  if (!product.can_review) {
    return <p className="muted">You can review this vendor once ARTPARK approves a request to them.</p>;
  }
```
and its submit becomes `onSubmitReview(product.vendor.id, { rating: Number(rating), body })`.

- [ ] **Step 5: Rework `FounderStore.jsx`**

Route the primary action by pricing, and add the two new handlers:

```jsx
  // Fixed-price -> shortlist. Quote-priced -> open the modal, where the
  // request form lives. The card never shortlists a quote-priced item.
  const onCardPrimary = (product) => {
    if (product.pricing === "quote") setOpenId(product.id);
    else addToShortlist(product);
  };

  const requestContact = async (productId, note) => {
    await store.createRequest({ product_id: productId, note });
    await load();
  };

  const submitReview = async (vendorId, payload) => {
    await store.submitVendorReview(vendorId, payload);
    await load();
  };
```

and pass them down:

```jsx
        {catalog.map((c) => (
          <ProductCard key={c.id} product={c} busy={busy}
            onOpen={(p) => setOpenId(p.id)} onPrimary={onCardPrimary} />
        ))}
...
        <ProductModal product={openProduct} busy={busy}
          onClose={() => setOpenId(null)}
          onPrimary={addToShortlist}
          onRequestContact={requestContact}
          onSubmitReview={submitReview} />
```

- [ ] **Step 6: Run the founder tests**

Run: `npx vitest run src/pages/founder/__tests__/`
Expected: PASS. Any test still asserting "Show contact" is a Phase-1 leftover — update it to the new copy rather than reintroducing the old button.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/founder
git commit -m "feat(vendor-portal): founder request flow, vendor ratings, registry specs"
```

---

### Task 10: Admin spec-field management

The highest-risk admin screen: a schema editor with a non-technical audience.

**Files:**
- Create: `frontend/src/pages/admin/platform/screens/artinfra/ArtInfraSpecFields.jsx`
- Modify: `.../artinfra/ArtInfraCategories.jsx` (drill-in)
- Test: `.../screens/__tests__/ArtInfraSpecFields.test.jsx`

**Interfaces:**
- Consumes: `store.listSpecFields(categoryId)`, `store.saveSpecField(patch)`, `store.archiveSpecField(id)`.
- Produces: `<ArtInfraSpecFields store categoryId categoryLabel onBack />`.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import ArtInfraSpecFields from "../artinfra/ArtInfraSpecFields.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store;
beforeEach(() => { configure({ minMs: 0, maxMs: 0 }); store = createArtInfraStore(); });

const renderIt = () => render(
  <ArtInfraSpecFields store={store} categoryId="sensors"
    categoryLabel="Sensors" onBack={vi.fn()} />);

describe("ArtInfraSpecFields", () => {
  it("lists the fields defined for this category only", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    expect(screen.queryByText("Process")).toBeNull();   // fabrication's field
  });

  it("adds a field", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Field label"), { target: { value: "IP rating" } });
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "ip_rating" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    await screen.findByText("IP rating");
  });

  it("refuses a duplicate key in the same category", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    fireEvent.change(screen.getByLabelText("Field label"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "channels" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    await screen.findByText(/already a field/i);
  });

  it("archives rather than deletes, and warns that values are kept", async () => {
    renderIt();
    await screen.findByText("Channels");
    fireEvent.click(screen.getByRole("button", { name: "Archive Channels" }));
    await waitFor(() => expect(screen.queryByText("Channels")).toBeNull());
    const fields = await store.listSpecFields("sensors");
    const archived = fields.find((f) => f.key === "channels");
    expect(archived.archived_at).not.toBeNull();   // soft, not destroyed
  });

  it("warns before archiving a required field", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    expect(screen.getByText(/existing products keep their values/i)).toBeInTheDocument();
  });

  it("surfaces a failure", async () => {
    renderIt();
    await screen.findByText("Sensing modality");
    configure({ failNext: "server_error" });
    fireEvent.click(screen.getByRole("button", { name: "Archive Channels" }));
    await screen.findByText(/could not/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraSpecFields.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// Spec-field editor for one category. This is a SCHEMA editor with a
// non-technical audience: archiving is soft, and the copy says so, because an
// admin cannot undo a destructive edit from a typo.

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

const TYPES = [
  ["text", "Text"], ["number", "Number"], ["enum", "One of a list"],
  ["multi_enum", "Several from a list"], ["boolean", "Yes / no"],
];

const slugKey = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function ArtInfraSpecFields({ store, categoryId, categoryLabel, onBack }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({ label: "", key: "", data_type: "text",
    unit: "", enum_options: "", required: false });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listSpecFields(categoryId)
    .then((r) => { setRows(r.filter((f) => !f.archived_at)); setError(""); })
    .catch(() => setError("Could not load fields."))
    .finally(() => setLoading(false)), [store, categoryId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.label.trim()) return;
    setError("");
    try {
      await store.saveSpecField({
        category_id: categoryId,
        key: draft.key.trim() || slugKey(draft.label),
        label: draft.label.trim(),
        data_type: draft.data_type,
        unit: draft.unit.trim() || null,
        enum_options: ["enum", "multi_enum"].includes(draft.data_type)
          ? draft.enum_options.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        required: draft.required,
      });
      setDraft({ label: "", key: "", data_type: "text", unit: "",
        enum_options: "", required: false });
      load();
    } catch (e) {
      setError(e.message === "duplicate_key"
        ? "There is already a field with that key in this category."
        : "Could not add that field.");
    }
  };

  const archive = async (row) => {
    setError("");
    try { await store.archiveSpecField(row.id); load(); }
    catch { setError("Could not archive that field."); }
  };

  const needsOptions = ["enum", "multi_enum"].includes(draft.data_type);

  return (
    <div>
      <PageHead eyebrow="Art Infra" title={`${categoryLabel} — details`}
        breadcrumb={[{ label: "Categories", onClick: onBack }, { label: categoryLabel }]}
        sub="These are the fields a vendor fills in for every product in this category." />

      <div className="vp-note">
        Archiving a field hides it from new and existing forms. Existing products keep their
        values, and nothing is deleted — re-adding the same key later brings the field back.
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="ai-inline-add">
        <input className="os-input" aria-label="Field label" placeholder="e.g. IP rating"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value,
            key: draft.key || slugKey(e.target.value) })} />
        <input className="os-input" aria-label="Field key" placeholder="ip_rating"
          value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
        <select className="os-input" aria-label="Field type" value={draft.data_type}
          onChange={(e) => setDraft({ ...draft, data_type: e.target.value })}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="os-input" aria-label="Unit" placeholder="unit (optional)"
          value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        {needsOptions && (
          <input className="os-input" aria-label="Options"
            placeholder="comma,separated,options" value={draft.enum_options}
            onChange={(e) => setDraft({ ...draft, enum_options: e.target.value })} />
        )}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" aria-label="Required" checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
          Required
        </label>
        <button type="button" className="os-btn" onClick={add}>Add field</button>
      </div>

      {loading ? (
        <div className="inline-loading">Loading fields…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Field</th><th>Key</th><th>Type</th><th>Unit</th><th>Required</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td className="os-mono os-text-xs">{f.key}</td>
                <td>{(TYPES.find(([v]) => v === f.data_type) || [])[1] || f.data_type}</td>
                <td>{f.unit || "—"}</td>
                <td>{f.required ? "Yes" : "—"}</td>
                <td className="ai-row-actions">
                  <button type="button" className="os-btn ghost"
                    aria-label={`Archive ${f.label}`} onClick={() => archive(f)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={6} className="tbl-empty">No fields yet for this category.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the drill-in to `ArtInfraCategories.jsx`**

Add a per-row action and local state:

```jsx
  const [drill, setDrill] = useState(null);   // {id, label} or null

  if (drill) {
    return <ArtInfraSpecFields store={store} categoryId={drill.id}
      categoryLabel={drill.label} onBack={() => setDrill(null)} />;
  }
```

and in the row actions, before Delete:

```jsx
                  <button type="button" className="os-btn ghost"
                    aria-label={`Edit ${c.label} details`}
                    onClick={() => setDrill({ id: c.id, label: c.label })}>
                    Details
                  </button>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraSpecFields.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/artinfra frontend/src/pages/admin/platform/screens/__tests__/ArtInfraSpecFields.test.jsx
git commit -m "feat(vendor-portal): admin spec-field management with soft archive"
```

---
### Task 11: Admin request queue and the sixth sub-nav entry

**Files:**
- Create: `.../screens/artinfra/ArtInfraRequests.jsx`
- Modify: `.../screens/artinfra/ArtInfraShell.jsx`
- Test: `.../screens/__tests__/ArtInfraRequests.test.jsx`, extend `ArtInfraShell.test.jsx`

**Interfaces:**
- Consumes: `store.listRequests({status})`, `store.approveRequest(id)`, `store.declineRequest(id, note)`.
- Produces: `<ArtInfraRequests store onChange />`; shell gains view id `requests`.

- [ ] **Step 1: Write the failing test**

```javascript
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import ArtInfraRequests from "../artinfra/ArtInfraRequests.jsx";
import { createArtInfraStore } from "../../../../../lib/artInfraMock.js";
import { configure } from "../../../../../lib/artInfraLatency.js";

let store, req;
beforeEach(async () => {
  configure({ minMs: 0, maxMs: 0 });
  store = createArtInfraStore();
  const { catalog } = await store.founderStore();
  req = await store.createRequest({ product_id: catalog[0].id, note: "Need 4 by October" });
});

describe("ArtInfraRequests", () => {
  it("shows the pending request with its product, vendor and note", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("approving removes it from the pending queue", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByText("Need 4 by October")).toBeNull());
    const approved = await store.listRequests({ status: "approved" });
    expect(approved).toHaveLength(1);
  });

  it("refuses to decline without a reason", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm decline" }));
    await screen.findByText(/reason is required/i);
  });

  it("declines with a reason the founder will see", async () => {
    render(<ArtInfraRequests store={store} onChange={vi.fn()} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(await screen.findByLabelText("Reason"), { target: { value: "Out of budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
    await waitFor(async () => {
      const [r] = await store.listRequests({ status: "declined" });
      expect(r.decision_note).toBe("Out of budget");
    });
  });

  it("notifies the shell after every decision so the badge updates", async () => {
    const onChange = vi.fn();
    render(<ArtInfraRequests store={store} onChange={onChange} />);
    await screen.findByText("Need 4 by October");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraRequests.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS = [["pending", "Pending"], ["approved", "Approved"],
  ["declined", "Declined"], ["", "All"]];

export default function ArtInfraRequests({ store, onChange }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listRequests({ status })
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load requests."))
    .finally(() => setLoading(false)), [store, status]);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setError("");
    try { await store.approveRequest(id); await load(); onChange?.(); }
    catch { setError("Could not approve that request."); }
  };

  const confirmDecline = async () => {
    if (!reason.trim()) { setError("A reason is required — the founder sees it."); return; }
    try {
      await store.declineRequest(declining.id, reason);
      setDeclining(null); setReason(""); setError("");
      await load(); onChange?.();
    } catch { setError("Could not decline that request."); }
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q
    || r.product_name.toLowerCase().includes(q)
    || r.vendor_name.toLowerCase().includes(q));

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Contact requests"
        sub="Approving one discloses that vendor's contact for every product they list." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search requests" searchPlaceholder="Product or vendor…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS }]}
        count={visible.length} total={rows.length}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading requests…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Product</th><th>Vendor</th><th>What they need</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name}</td>
                <td>{r.vendor_name}</td>
                <td className="ai-review-body">{r.note}</td>
                <td><span className={`ai-status ai-status-${r.status}`}>{r.status}</span></td>
                <td className="ai-row-actions">
                  {r.status === "pending" && (
                    <>
                      <button type="button" className="os-btn ghost"
                        onClick={() => approve(r.id)}>Approve</button>
                      <button type="button" className="os-btn ghost"
                        onClick={() => { setDeclining(r); setReason(""); }}>Decline</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && !error && (
              <tr><td colSpan={5} className="tbl-empty">Nothing in this queue.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {declining && (
        <div className="modal-bg" onClick={() => setDeclining(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Decline this request</h2></div>
            <div className="ai-form">
              <label>Reason
                <textarea className="os-input" aria-label="Reason" rows={4} value={reason}
                  onChange={(e) => setReason(e.target.value)} />
              </label>
              <p className="os-sub">The founder sees this on the product.</p>
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost"
                onClick={() => setDeclining(null)}>Cancel</button>
              <button type="button" className="os-btn"
                onClick={confirmDecline}>Confirm decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `ArtInfraShell.jsx`**

Add the import, the sixth `VIEWS` entry, a pending-requests badge alongside the reviews badge, and the render branch:

```jsx
import ArtInfraRequests from "./ArtInfraRequests.jsx";
```
```jsx
const VIEWS = [
  { id: "catalog", label: "Catalog" },
  { id: "vendors", label: "Vendors" },
  { id: "categories", label: "Categories" },
  { id: "requests", label: "Requests" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
];
```
```jsx
  const [pendingReqs, setPendingReqs] = useState(0);

  const refreshBadges = () => {
    // listVendorReviews, not Phase 1's listReviews -- Task 4 already replaced
    // the store, so the old name resolves to undefined and `.then` would throw.
    store.listVendorReviews({ status: "pending" })
      .then((r) => setPending(r.length)).catch(() => {});
    store.listRequests({ status: "pending" })
      .then((r) => setPendingReqs(r.length)).catch(() => {});
  };
  useEffect(() => { refreshBadges(); }, [store, view]);
```
```jsx
            {v.id === "requests" && pendingReqs > 0 && (
              <span className="ai-badge" data-testid="artinfra-requests-badge">{pendingReqs}</span>
            )}
```
```jsx
      {view === "requests" && <ArtInfraRequests store={store} onChange={refreshBadges} />}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/pages/admin/platform/screens/__tests__/ArtInfraRequests.test.jsx src/pages/admin/platform/screens/__tests__/ArtInfraShell.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens
git commit -m "feat(vendor-portal): admin contact-request queue"
```

---

### Task 12: Rewire the remaining admin screens

Four screens still call Phase-1 method names. This task makes the suite green again.

**Files:**
- Modify: `.../artinfra/ArtInfraVendors.jsx`, `ArtInfraCatalog.jsx`, `ArtInfraReviews.jsx`, `ArtInfraInsights.jsx`
- Modify their four existing test files.

**Interfaces:**
- `listProducts` → `adminListProducts`; `listVendors` → `adminListVendors`; `setProductStatus(id,'published')` → `publishProduct(id)`; `listReviews` → `listVendorReviews`; `moderateReview` → `moderateVendorReview`; `deleteReview` → `deleteVendorReview`.

- [ ] **Step 1: Write the failing tests**

Add to `ArtInfraVendors.test.jsx`:

```javascript
it("invites a vendor by email", async () => {
  render(<ArtInfraVendors store={store} />);
  await screen.findByText("Knowles");
  fireEvent.click(screen.getByRole("button", { name: "+ Invite vendor" }));
  fireEvent.change(await screen.findByLabelText("Contact email"),
    { target: { value: "new@vendor.com" } });
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NewCo" } });
  fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
  await screen.findByText("NewCo");
  const rows = await store.adminListVendors({ status: "invited" });
  expect(rows.some((v) => v.contact_email === "new@vendor.com")).toBe(true);
});

it("suspending a vendor is offered for approved vendors", async () => {
  render(<ArtInfraVendors store={store} />);
  await screen.findByText("Knowles");
  expect(screen.getAllByRole("button", { name: /^Suspend / }).length).toBeGreaterThan(0);
});
```

Add to `ArtInfraCatalog.test.jsx`:

```javascript
it("publishes a product that is awaiting review", async () => {
  const [v] = await store.adminListVendors();
  const p = await store.createVendorProduct(v.id, { name: "Awaiting", category_id: "sensors" });
  await store.submitProduct(v.id, p.id);
  render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
  const seg = await screen.findByRole("button", { name: "In review" });
  fireEvent.click(seg);
  await screen.findByText("Awaiting");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  await waitFor(async () => {
    const { items } = await store.adminListProducts({ status: "published" });
    expect(items.some((x) => x.id === p.id)).toBe(true);
  });
});

it("sends a product back with a required note", async () => {
  const [v] = await store.adminListVendors();
  const p = await store.createVendorProduct(v.id, { name: "Thin", category_id: "sensors" });
  await store.submitProduct(v.id, p.id);
  render(<ArtInfraCatalog store={store} goEditor={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "In review" }));
  await screen.findByText("Thin");
  fireEvent.click(screen.getByRole("button", { name: "Send back" }));
  fireEvent.change(await screen.findByLabelText("What needs fixing?"),
    { target: { value: "Add specs" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(async () => {
    const got = await store.getVendorProduct(v.id, p.id);
    expect(got.status).toBe("draft");
    expect(got.review_note).toBe("Add specs");
  });
});
```

Add to `ArtInfraReviews.test.jsx`:

```javascript
it("shows the vendor a review is about, not a product", async () => {
  render(<ArtInfraReviews store={store} onChange={vi.fn()} />);
  await screen.findByText("Ishan Gupta");
  expect(screen.getByRole("columnheader", { name: "Vendor" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Product" })).toBeNull();
});
```

Add to `ArtInfraInsights.test.jsx`:

```javascript
it("counts requests rather than shortlists", async () => {
  const { catalog } = await store.founderStore();
  await store.createRequest({ product_id: catalog[0].id, note: "x" });
  render(<ArtInfraInsights store={store} />);
  await screen.findByText("Most requested");
  expect(screen.getByRole("columnheader", { name: "Requests" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/pages/admin/platform/screens/__tests__/`
Expected: FAIL across the four files.

- [ ] **Step 3: Apply the rewires**

`ArtInfraVendors.jsx` — swap `listVendors` → `adminListVendors`, change the modal from "New vendor" to **"+ Invite vendor"** submitting `{display_name, contact_email}` via `inviteVendor`, and replace the row Delete with status actions:

```jsx
                <td className="ai-row-actions">
                  <button type="button" className="os-btn ghost" aria-label={`Edit ${v.display_name}`}
                    onClick={() => setEditing({ ...v })}>Edit</button>
                  {v.status !== "approved" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Approve ${v.display_name}`}
                      onClick={() => act(store.approveVendor, v.id)}>Approve</button>
                  )}
                  {v.status === "approved" && (
                    <button type="button" className="os-btn ghost"
                      aria-label={`Suspend ${v.display_name}`}
                      onClick={() => act(store.suspendVendor, v.id)}>Suspend</button>
                  )}
                </td>
```

Add a Status column rendering `<span className={`ai-status ai-status-${v.status}`}>`.

`ArtInfraCatalog.jsx` — swap `listProducts` → `adminListProducts`; add `["pending_review", "In review"]` to `STATUS_SEGMENTS`; replace the row actions:

```jsx
                <td className="ai-row-actions">
                  {p.status === "pending_review" && (
                    <>
                      <button type="button" className="os-btn ghost"
                        onClick={() => act(store.publishProduct, p.id)}>Publish</button>
                      <button type="button" className="os-btn ghost"
                        onClick={() => setSendingBack(p)}>Send back</button>
                    </>
                  )}
                  {p.status === "published" && (
                    <button type="button" className="os-btn ghost"
                      onClick={() => act(store.sendBackProduct, p.id, "Retired by admin")}>
                      Retire
                    </button>
                  )}
                </td>
```

plus a send-back modal with a required `aria-label="What needs fixing?"` textarea and a `Confirm` button, and a **request-id guard** on `load()` identical to Task 7's.

`ArtInfraReviews.jsx` — swap `listReviews` → `listVendorReviews`, `moderateReview` → `moderateVendorReview`, `deleteReview` → `deleteVendorReview`, and change the first column header and cell from `product_name` to `vendor_name`.

`ArtInfraInsights.jsx` — read `topRequested` / `neverRequested` / `requested_by`; rename the headings to "Most requested" / "Never requested" and the column to "Requests".

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: exactly **2** failures, both `AdminPipeline`. Any other failure is yours.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens
git commit -m "feat(vendor-portal): rewire admin screens onto the three-portal store"
```

---

### Task 13: Shared status chips, stylesheet audit and full verification

**Files:**
- Create: `frontend/src/styles/art-infra-shared.css`
- Modify: `frontend/src/styles/art-infra-admin.css`, `frontend/src/styles/vendor-portal.css`

- [ ] **Step 1: Extract the status chips**

Move the `.ai-status` block out of `art-infra-admin.css` into a new shared sheet, unscoped from any portal root so both can use it, and add the four new statuses:

```css
/* Art Infra status chips. Shared by the admin and vendor portals because they
   render the SAME domain statuses -- one definition, not two that drift. */
.ai-status {
  display: inline-block; border-radius: 2px; padding: 2px 8px;
  font-size: 11px; font-family: var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.06em; border: 1px solid var(--line-strong); color: var(--ink-soft);
}
.ai-status-draft          { background: var(--bg-soft); }
.ai-status-pending_review { background: var(--chip); }
.ai-status-published      { background: #e6f4ea; border-color: #2f9e4f; color: #2a7a3a; }
.ai-status-retired        { opacity: 0.6; }
.ai-status-invited        { background: var(--bg-soft); }
.ai-status-registered     { background: var(--chip); }
.ai-status-approved       { background: #e6f4ea; border-color: #2f9e4f; color: #2a7a3a; }
.ai-status-suspended      { background: #f7e4de; border-color: #c84a1a; color: #c84a1a; }
.ai-status-pending        { background: var(--chip); }
.ai-status-declined       { opacity: 0.6; }
.ai-status-hidden         { opacity: 0.6; }
```

Import it from both `art-infra-admin.css` and `vendor-portal.css` with `@import "./art-infra-shared.css";` as the first line, and delete the old `.ai-status*` rules from `art-infra-admin.css`.

- [ ] **Step 2: Audit every class the new screens emit**

Run this and confirm the output is empty:

```bash
cd frontend
# Every className string used by the vendor portal...
grep -rhoE 'className="[^"]*"' src/pages/vendor | tr -d '"' | sed 's/className=//' \
  | tr ' ' '\n' | grep -E '^(vp-|vendor-)' | sort -u > /tmp/used.txt
# ...against every selector defined in its stylesheet.
grep -oE '\.(vp-|vendor-)[a-z-]+' src/styles/vendor-portal.css | tr -d '.' | sort -u > /tmp/defined.txt
echo "USED BUT UNDEFINED (renders unstyled):"; comm -23 /tmp/used.txt /tmp/defined.txt
echo "DEFINED BUT UNUSED (dead CSS):";          comm -13 /tmp/used.txt /tmp/defined.txt
```

Fix anything either list reports.

- [ ] **Step 3: Confirm no global leakage**

```bash
grep -nE '^\s*(table|input|button|select|label|h[1-6])\s*\{' src/styles/vendor-portal.css \
  && echo "LEAK: bare element selector -- scope it under .vendor-portal" \
  || echo "OK: every rule is scoped"
```

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: exactly 2 failures, both `AdminPipeline`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds, `dist/` emitted.

- [ ] **Step 6: Prove the work actually ships rather than being tree-shaken**

```bash
B=$(ls -t dist/assets/*.js | head -1)
for s in "Request contact" "Viewing as" "Contact requests" "Preview as founder" "Archive"; do
  printf "%-22s x%s\n" "$s" "$(grep -o "$s" "$B" | wc -l | tr -d ' ')"
done
```

Every count must be ≥ 1. Record them in your report.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles
git commit -m "feat(vendor-portal): shared status chips and stylesheet audit"
```

- [ ] **Step 8: STOP — do not push**

The controller pushes. `dayan02dev/AP_os` is public and a push triggers an external Vercel build. Report your final suite counts, build result and bundle greps instead.

---

## Phase 2 — explicitly out of scope for this plan

Migration `046` (re-check the number against `feat/vip-onboarding`, which holds 043–045); the `/admin/art-infra` and `/vendor` routers; the `vendor` and `infra_manager` roles plus the RBAC mirror test; real vendor authentication and the invite email; the datasheet storage bucket with signed-URL reads; audit writes into `audit_log_v2`; CSV import/export; bulk publish/retire.

**Never seed into the migration:** `SAMPLE_REVIEWS` from `artInfraMock.js`, or any request or shortlist row the mock creates. They exist to keep review screens from looking empty and are fiction.

## Self-review notes

**Spec coverage.** Every section of the design spec maps to a task: vendor identity → 5, 6; registration fields → 6; spec-field registry → 1, 3, 10; product lifecycle → 4, 7, 12; request flow → 4, 9, 11; vendor-level reviews → 4, 9, 12; the three portals → 5–12; API contract → 4 (the mock's method names *are* the contract); design-system conformance → 5, 13; hostile mock → 2, 4; testing → every task.

**Deliberately deferred within this phase**, so it is not mistaken for a gap: datasheet upload (no bucket to upload to), vendor invite email (no backend), the `status`/`sort`/`visible_tracks` controls in the vendor editor (no meaningful demonstration against a mock), and per-field `filterable` actually driving a founder-side filter — the flag is stored and editable, but nothing consumes it until there is a database to filter in.

**Type consistency.** `vendorId` is the first argument of every vendor-scoped method in Tasks 4–8. `contact_state` — not `contactState` or `disclosure` — is the founder-facing field name in Tasks 4, 9. `describeFields` / `emptyValues` / `coerceValue` / `validateSpecs` keep those exact names in Tasks 3, 8. `adminListVendors` and `adminListProducts` carry the `admin` prefix everywhere; the Phase-1 names `listVendors` and `listProducts` survive nowhere after Task 12.

**The one judgment call worth revisiting after the preview.** Task 8 resets the whole spec bag when the category changes, so switching category discards typed values. That is correct — values from the old category are not valid keys for the new one — but if a reviewer finds it annoying in practice, the alternative is to keep values whose keys exist in both field sets. Cheap to change; not worth guessing at now.
