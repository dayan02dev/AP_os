# MOU agreements + Founders Resources lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan targets PRODUCTION (TIR).** Work only in this worktree, branch `feat/mou-agreements-resource-lock`. Do not touch `feat/vip-onboarding` or any other worktree.

**Goal:** Replace the hand-written, free-text MOU with a PDF generated from the real ARTPARK Facility Agreement (extract-and-render, never a retyped copy), and lock the five Founders Resources tabs (Art Infra, ArtConnect, ArtPartners, Art Assets, Art Support) so each releases independently from the backend with no frontend deploy.

**Architecture:** A build-time script (`scripts/extract_agreement_template.py`) walks the source `.docx` mechanically — paragraphs and tables, in document order, `[•]` markers preserved verbatim — and emits a committed JSON template. The runtime never opens a `.docx`. `app/services/agreements.py` loads that JSON, applies Facility-Agreement-specific substitution rules (collaborator blocks repeat/drop for 1–3 collaborators, ARTPARK constants fill in once), renders the body with `reportlab.platypus` (real paragraphs + real tables, not raw canvas lines) and appends a canvas-drawn signature page merged in with `pypdf` — the exact three libraries the Lambda runtime carries and nothing else. The resources lock is a `settings`-driven per-item availability map surfaced on `/founder/me` and enforced twice: once in the API (403 on a locked resource's endpoints) and once in the frontend route guard inside `FounderPortal.renderTab()`, so `GET /founder/store` and typing `/founder/store` are both dead ends while an item is off.

**Tech Stack:** FastAPI + pydantic + Supabase (service-role client) on the backend; React 18 + react-router-dom + Vitest on the frontend; `reportlab`, `pypdf`, `python-docx` — already in `backend/requirements.txt`, no new dependency.

**Spec:** `docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md` (copied into this worktree as part of Task 0)

**Source document (read directly, not via the spec's summary):** `backend/scripts/source_docs/facility_agreement_2026-08-06.docx` (copied in by Task 1) — 133 paragraphs, 4 tables, 22 `[•]` placeholders, confirmed by direct `python-docx` inspection during planning.

## Correction to the spec's field map

Research for this plan re-derived the placeholder breakdown directly from the `.docx` (the task brief required this). The spec's §5 says the Facilities schedule carries **4** blanks ("Dedicated Seating, Laboratory Space, Computing Resources, and the remaining row"). The actual document has **6**: Schedule II ("SCHEDULE II: FACILITIES", the 7×5 table) has an `[•]` in the Availability Window column for *every* data row — Dedicated Seating, Laboratory Space, Computing Resources, Wireless Internet, Conference Rooms, and Administrative ID / Access Badge. The totals still reconcile: 12 founder-supplied + 4 ARTPARK-constant `[•]` occurrences (term ×2, insurance, collaboration-agreement date) + 6 facilities-schedule `[•]` occurrences = 22, matching the confirmed total. The plan below builds against the real 6-row structure. This is flagged again in the final report as a correction, not a silent override.

Two placeholders in the document use a different bracket syntax entirely — literal `[month]` and `[date]` (paragraphs 1 and 19, both the same execution/effective date value) — and are **not** part of the 22-count `[•]` total. The no-leftover-placeholder guard in Task 4 checks for all three tokens, not just `[•]`, because a literal `[month]` surviving into a signed legal PDF is exactly the same class of failure.

## Global Constraints

- **Migration-free.** `founder_mou.template_version` is a plain `text` column with a default, no `check` constraint (verified against `backend/migrations/040_founder_portal.sql`) — storing `'facility-v1'` needs no DDL. `founder_mou` is also `unique(application_id)` — one row per application, not one per agreement. That is sufficient today because exactly one agreement (Facility) ships in this plan; it stops being sufficient the day Collaboration Agreement ships, at which point `unique(application_id)` must become `unique(application_id, agreement)` or a new table. That IS a migration — correctly out of scope here, deferred to that later, smaller deploy (see spec §3, the redlined-draft blocker). No task in this plan adds a column or table.
- **The existing signed row is never touched.** Production holds one `founder_mou` row, `signer_name = 'OOOO'`, `template_version = 'tir-mou-v2'`, against the one onboarded TIR application. No task backfills, migrates, or re-signs it. It keeps reading as signed, under its own recorded version, forever — Task 6 fixes a real bug (`GET /mou` currently *always* reports the current constant instead of the row's own `template_version`) precisely so this old row keeps reporting `tir-mou-v2` instead of quietly relabelling itself `facility-v1` the moment this ships.
- **Founders Resources already has a full, live backend** (`founder_resources.py`, `founder_resources_query.py`, `founder_catalog.py`, migration 041, registered in `main.py`, reachable today at `/founder/store` etc. with real per-founder DB state layered over static reference/mockup catalog data). "Unbuilt" in this task means *the underlying business relationships aren't real yet* (vendors, investors, partners are transcribed from a design mockup), not that the code is missing. The lock is a product gate in front of working code, not new CRUD.
- **Rollout is two ordered production deploys** (spec §10): Founders Resources lock ships first (Tasks 2–3, small, reversible, immediate value), Facility Agreement MOU ships second (Tasks 4–9) after the lock is verified in prod. Do not conflate the two into one deploy.
- **No literal placeholder token survives into a generated PDF.** Every render path (PDF bytes and the pre-sign preview text) is checked directly — not just visually — for `[•]`, `[month]`, `[date]` before being returned. This is the single test a reader would run first; Task 4 puts the check inside the renderer itself (fail closed, `ValueError`, not just a test assertion).
- **Two independent lock mechanisms, deliberately not shared.** `FounderLocked.jsx` (existing) means "sign your MOU first" — conditional, unlocks as a group. The new `FounderResourceLocked.jsx` (Task 3) means "not released yet" — server-driven, per item, no MOU relationship at all. They render different copy and are tested to prove they differ; a future editor collapsing them into one component is exactly the regression Task 3's test catches.
- **The empty/null-state guard this project keeps needing** (per CLAUDE.md, five prior defects): every state below gets its own copy, verified by its own test.
  | Surface | State | Cause | Copy is distinct because |
  |---|---|---|---|
  | MOU · Facility Agreement | Not started | founder hasn't opened the wizard / entered anything | nothing to save yet, no "come back and finish" framing |
  | MOU · Facility Agreement | Partially filled | founder started but at least one required field is missing | actionable — tell them what's left |
  | MOU · Facility Agreement | Signed | `founder_mou` row exists for this application | read-only, download-only, no editing affordance |
  | MOU · agreement list | Agreement present for this track | `GET /mou` returned it in `agreements[]` | rendered normally |
  | MOU · agreement list | Agreement absent for this track | not in `agreements[]` (e.g. Collaboration, until it ships) | **no card rendered at all** — the frontend has no hardcoded expectation of a second agreement, so there's nothing to mislabel; this axis is closed structurally, not with a "coming soon" message (verified by Task 9's catalog-driven test: adding a second entry to the mocked `agreements[]` makes a second card appear with zero frontend code changes) |
  | Founders Resources | Item locked (sidebar) | `resources_available[item]` is `false` | dim + 🔒, no click-through |
  | Founders Resources | Item locked (direct URL) | same flag, hit via route guard before the page component ever mounts | full-page "isn't open yet" message, not a 403 error screen — this is a known, expected state, not a fault |

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md` | *Create (copy).* The approved spec, carried onto this branch. |
| `backend/app/config.py` | *Modify.* `founder_resources_enabled` setting + parsing helpers, mirroring `founder_portal_allowlist`. |
| `backend/app/routers/founder.py` | *Modify.* `/founder/me` gains `resources_available`; `/founder/mou` extended; new `POST /founder/mou/preview`; `/founder/mou/sign` accepts `collaborators`. |
| `backend/app/routers/founder_resources.py` | *Modify.* Every endpoint gated by `require_resource(item)`. |
| `backend/app/models/founder.py` | *Modify.* `CollaboratorIn`, extended `MouSignRequest`, new `MouPreviewRequest`. |
| `backend/scripts/source_docs/facility_agreement_2026-08-06.docx` | *Create.* Committed copy of the source Word file — extractor input only, never read at runtime. |
| `backend/scripts/extract_agreement_template.py` | *Create.* Generic docx → JSON template extractor. Run by a human, not the app. |
| `backend/app/services/agreements/facility-v1.json` | *Create.* Committed extractor output — what actually ships. |
| `backend/app/services/agreements.py` | *Create.* Facility-Agreement substitution engine + reportlab/pypdf renderer + preview text. |
| `backend/app/services/founder_mou.py` | *Modify.* `sign_and_onboard()` delegates PDF bytes to `agreements.py`; old free-text renderer kept intact for the legacy row; `GET /mou` version bug fixed. |
| `backend/tests/test_extract_agreement_template.py` | *Create.* Extractor vs. the real docx. |
| `backend/tests/test_agreements.py` | *Create.* Substitution engine + PDF/preview rendering. |
| `backend/tests/test_founder_crud.py` | *Modify.* `_sign_body()` gains `collaborators`; new version-per-row test. |
| `backend/tests/test_founder_mou.py` | *Modify.* `TEMPLATE_VERSION` assertions updated; legacy renderer tests untouched. |
| `backend/tests/test_founder_resources.py` | *Modify.* Existing tests grant resource access via the new setting; new 403-when-locked tests added. |
| `frontend/src/lib/founderApi.js` | *Modify.* `previewMou`; `signMou` takes `collaborators`. |
| `frontend/src/pages/founder/FounderMou.jsx` | *Rewrite.* 4-step wizard: Your details → Review → Sign → Download. |
| `frontend/src/pages/founder/FounderResourceLocked.jsx` | *Create.* "Not released yet" screen — distinct copy from `FounderLocked.jsx`. |
| `frontend/src/pages/founder/FounderPortal.jsx` | *Modify.* Per-item sidebar disable + `renderTab()` route guard for the five resource tabs. |
| `frontend/src/pages/founder/__tests__/FounderMou.test.jsx` | *Rewrite.* Wizard steps, three MOU states, collaborator add/remove, catalog-driven field labels. |
| `frontend/src/pages/founder/__tests__/FounderPortal.test.jsx` | *Modify.* Sidebar disable + route-guard proof + mutation check. |

---

## Task 0: Carry the spec onto this branch

**Files:**
- Create: `docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md`

- [ ] **Step 1:** Copy the approved spec verbatim from the other worktree.

```bash
cp "/Users/apple/Desktop/Final_AP_os/.claude/worktrees/vip-onboarding/docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md" \
   "/Users/apple/Desktop/Final_AP_os/.claude/worktrees/mou-resource-lock/docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md"
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-18-mou-agreements-and-resource-lock-design.md
git commit -m "docs(mou+lock): carry the approved design spec onto this branch"
```

---

## Part A — Founders Resources lock (ships first)

### Task 1: `founder_resources_enabled` setting + `/founder/me` availability map

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/routers/founder.py`
- Test: `backend/tests/test_founder_access.py`

**Interfaces:**
- Produces: `settings.founder_resources_enabled_set` (a `frozenset[str]`), `settings.resource_available(item: str) -> bool`, `RESOURCE_ITEMS` tuple.
- `/founder/me` response gains `"resources_available": {"store": bool, "fundraising": bool, "partners": bool, "assets": bool, "support": bool}` as a top-level sibling of `"locked"` — **not** nested inside it, and not reusing `locked`'s semantics.

- [ ] **Step 1: Add the setting**, immediately after `founder_portal_allowlist` in `config.py` (~line 161):

```python
    # ── Founders Resources availability (server-driven, per-item release) ──
    # The five Founders Resources tabs (store, fundraising, partners, assets,
    # support) are fully working against the founder_catalog.py reference
    # data (migration 041) but the underlying vendor/investor/partner
    # relationships are not real yet. Comma-separated resource keys currently
    # released to founders. Unlike founder_portal_allowlist (empty = open),
    # empty here means "everything locked" — the safe default for a surface
    # that isn't launched. Flip via FOUNDER_RESOURCES_ENABLED; releasing an
    # item is an env-var change, never a frontend deploy.
    founder_resources_enabled: str = ""

RESOURCE_ITEMS: tuple[str, ...] = ("store", "fundraising", "partners", "assets", "support")
```

And near `founder_portal_allowlist_emails`:

```python
    @property
    def founder_resources_enabled_set(self) -> frozenset[str]:
        return frozenset(
            e.strip().lower()
            for e in self.founder_resources_enabled.split(",")
            if e.strip()
        )

    def resource_available(self, item: str) -> bool:
        return item in self.founder_resources_enabled_set
```

- [ ] **Step 2: Extend `GET /founder/me`** in `founder.py`:

```python
    return {
        "status": ctx["status"],
        "application_id": ctx["application_id"],
        "grant_amount": float(ctx["app"].get("grant_amount") or 0),
        "project_name": _project_name(ctx["app"]),
        "mou_signed": signed,
        "locked": {
            "cohort": ctx["status"] != "onboarded",
            "dashboard": ctx["status"] != "onboarded",
        },
        "resources_available": {
            item: settings.resource_available(item) for item in RESOURCE_ITEMS
        },
    }
```

(Import `RESOURCE_ITEMS` and `settings` from `..config` — `settings` is likely already imported; check before adding a duplicate import.)

- [ ] **Step 3: Write the failing tests** in `test_founder_access.py`:

```python
def test_me_reports_all_resources_locked_by_default(client, monkeypatch, _clear):
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.json()["resources_available"] == {
        "store": False, "fundraising": False, "partners": False,
        "assets": False, "support": False,
    }


def test_me_reports_only_enabled_resources_as_available(client, monkeypatch, _clear):
    from app.config import settings
    monkeypatch.setattr(settings, "founder_resources_enabled", "store, assets")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/me").json()
    assert body["resources_available"]["store"] is True
    assert body["resources_available"]["assets"] is True
    assert body["resources_available"]["fundraising"] is False
```

- [ ] **Step 2: Run — both new tests fail** (`resources_available` KeyError) before the code change, pass after.

- [ ] **Step 5: Mutation-check.** Change `resource_available` to always return `True`; confirm `test_me_reports_all_resources_locked_by_default` fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/routers/founder.py backend/tests/test_founder_access.py
git commit -m "feat(founder): per-item Founders Resources availability on /founder/me"
```

---

### Task 2: Backend gate on the Founders Resources endpoints

**Files:**
- Modify: `backend/app/routers/founder_resources.py`
- Modify: `backend/tests/test_founder_resources.py`

**Interfaces:**
- Produces: `require_resource(item: str)` — a dependency factory, composed on top of `require_founder_access`, returning the same `FounderContext` on success or 403 `{"code": "resource_not_available", "item": item}`.

This closes the gap Task 1 leaves open: `/founder/me` *reporting* an item as unavailable is not the same as the API *refusing* it. Without this task, a founder who already has the SPA loaded could still call `GET /founder/store` directly and get real data even while the sidebar shows it locked.

- [ ] **Step 1: Add the dependency** in `founder_resources.py`:

```python
from ..config import settings

def require_resource(item: str):
    async def _check(
        ctx: Annotated[dict, Depends(require_founder_access)],
    ) -> dict:
        if not settings.resource_available(item):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail={"code": "resource_not_available", "item": item},
            )
        return ctx
    return _check
```

- [ ] **Step 2: Apply it to every route**, replacing `Annotated[dict, Depends(require_founder_access)]` with `Annotated[dict, Depends(require_resource("store"))]` (etc.) on: `get_store`, `add_to_cart`, `set_cart_qty`, `remove_cart_item`, `request_quote`, `push_to_procurement` → `"store"`; `get_fundraising`, `toggle_intro` → `"fundraising"`; `get_partners`, `toggle_partner` → `"partners"`; `get_assets`, `create_booking`, `delete_booking` → `"assets"`; `get_support`, `create_ticket` → `"support"`.

- [ ] **Step 3: Update existing tests to keep passing.** Every existing test in `test_founder_resources.py` currently assumes access; add a helper and call it in each test's setup:

```python
@pytest.fixture
def _enable_all(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "founder_resources_enabled", ",".join(
        ["store", "fundraising", "partners", "assets", "support"]
    ))
```

Add `_enable_all` to every existing test's parameter list (it's a fixture, order-independent — no need to touch each test body beyond the signature).

- [ ] **Step 4: Write the new failing tests** (locked-by-default):

```python
def test_get_store_403_when_not_enabled(client, monkeypatch, _clear):
    _install(monkeypatch, {"tir_applications": [_APP]})
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/store")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "resource_not_available"


def test_enabling_one_item_does_not_open_another(client, monkeypatch, _clear):
    from app.config import settings
    monkeypatch.setattr(settings, "founder_resources_enabled", "store")
    _install(monkeypatch, {"tir_applications": [_APP], "founder_cart_items": [], "founder_resource_requests": []})
    app.dependency_overrides[get_current_user] = _override_user("u1")
    assert client.get("/founder/store").status_code == 200
    assert client.get("/founder/fundraising").status_code == 403
```

- [ ] **Step 5: Run the full file** — `cd backend && pytest tests/test_founder_resources.py -q --no-cov`. All green.

- [ ] **Step 6: Mutation-check.** Change `require_resource` to ignore `item` and only call `require_founder_access`. Confirm `test_get_store_403_when_not_enabled` fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/founder_resources.py backend/tests/test_founder_resources.py
git commit -m "feat(founder): gate Founders Resources endpoints on per-item availability"
```

---

### Task 3: Frontend lock — route guard + sidebar + distinct copy

**Files:**
- Create: `frontend/src/pages/founder/FounderResourceLocked.jsx`
- Modify: `frontend/src/pages/founder/FounderPortal.jsx`
- Modify: `frontend/src/pages/founder/__tests__/FounderPortal.test.jsx`

**Interfaces:**
- Produces: `<FounderResourceLocked label="Art Infra" />` — presentational, no data fetching.
- `FounderPortal`'s `renderTab()` gains a check for the five resource tabs; `FounderSidebar` gains a `resourcesAvailable` prop.

**Why this is a real guard and not styling:** `renderTab()` decides which component to mount *before* any child renders. If `resources_available.store` is `false`, `FounderStore` (and its `founderApi.getStore()` call) is never constructed — not hidden with CSS, not mounted-then-blocked. Typing `/founder/store` into the URL bar lands on this exact code path (`router.jsx`'s `/founder/store` route always renders `<FounderPortal tab="store" />`; there is no separate unguarded entry point).

- [ ] **Step 1: Write `FounderResourceLocked.jsx`**, deliberately different copy from `FounderLocked.jsx` (no MOU framing, no "Go to Sign MOU" CTA — there is nothing to sign here):

```jsx
export default function FounderResourceLocked({ label }) {
  return (
    <div className="panel" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 30 }}>🔒</div>
      <h2 style={{ fontFamily: "var(--font-display)", marginTop: 10 }}>{label} isn't open yet</h2>
      <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
        This part of Founders resources is still being set up. Check back soon — nothing to do here yet.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Extend `FounderPortal.jsx`.** `me.resources_available` is already served (Task 1). Thread it through:

```jsx
const resourcesAvailable = me.resources_available || {
  store: false, fundraising: false, partners: false, assets: false, support: false,
};

const RESOURCE_LABELS = {
  store: "Art Infra", fundraising: "ArtConnect", partners: "ArtPartners",
  assets: "Art Assets", support: "Art Support",
};

const renderTab = () => {
  if ((tab === "approach" || tab === "org" || tab === "expense") && locked.cohort)
    return <FounderLocked which="cohort" onGoMou={() => navigate("/founder/mou")} />;
  if (tab === "dashboard" && locked.dashboard)
    return <FounderLocked which="dashboard" onGoMou={() => navigate("/founder/mou")} />;
  if (RESOURCE_LABELS[tab] && !resourcesAvailable[tab])
    return <FounderResourceLocked label={RESOURCE_LABELS[tab]} />;
  switch (tab) {
    // ...unchanged
  }
};
```

Pass `resourcesAvailable` into `<FounderSidebar>`.

- [ ] **Step 3: Update `FounderSidebar`.** The "Founders resources" nav group currently has no `locked:` key at all (unlike "Cohort management"/"Dashboard reporting"), so `isLocked(group)` never fires for it today. Give each item under that group its own availability key and check per-item, not per-group:

```jsx
const NAV = [
  // ...
  { group: "Founders resources", items: [
    { sec: "store", num: "01", label: "Art Infra", to: "/founder/store", avail: "store" },
    { sec: "fundraising", num: "02", label: "ArtConnect", to: "/founder/fundraising", avail: "fundraising" },
    { sec: "partners", num: "03", label: "ArtPartners", to: "/founder/partners", avail: "partners" },
    { sec: "assets", num: "04", label: "Art Assets", to: "/founder/assets", avail: "assets" },
    { sec: "support", num: "05", label: "Art Support", to: "/founder/support", avail: "support" },
  ]},
];
```

And the call site — `isLocked` currently takes only `group`; it now takes `(group, item)`, and the one place it's called (inside `g.items.map`) passes both:

```jsx
function FounderSidebar({ tab, locked, resourcesAvailable, navigate }) {
  const isLocked = (group, item) =>
    (group.locked && locked[group.locked]) ||
    (item.avail && !resourcesAvailable[item.avail]);
  return (
    <aside className="eir-os-side">
      {NAV.map((g) => (
        <nav className="eir-os-side-group" key={g.group}>
          <div className="eir-mono eir-os-side-title">{g.group}</div>
          {g.items.map((it) => {
            const lock = isLocked(g, it);  // was isLocked(g) — now checks the item too
            return (
              <button
                type="button"
                key={it.sec}
                className={`eir-os-nav ${tab === it.sec ? "is-on" : ""}`}
                onClick={() => navigate(it.to)}
                style={lock ? { opacity: 0.5 } : undefined}
                aria-disabled={lock || undefined}
              >
                <span className="eir-mono eir-os-nav-num">{it.num}</span>
                <span className="eir-os-nav-label">{it.label}</span>
                {lock && <span className="eir-mono eir-os-nav-badge">🔒</span>}
              </button>
            );
          })}
        </nav>
      ))}
      {/* ...rest of FounderSidebar unchanged (Cohort links, footer) */}
```

- [ ] **Step 4: Write the failing tests** in `FounderPortal.test.jsx`:

```jsx
it("disables a locked resource item in the sidebar", async () => {
  vi.spyOn(founderApi, "me").mockResolvedValue({
    status: "onboarded", locked: { cohort: false, dashboard: false },
    resources_available: { store: false, fundraising: true, partners: false, assets: false, support: false },
  });
  render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Art Infra")).toBeInTheDocument());
  expect(screen.getByText("Art Infra").closest("button")).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByText("ArtConnect").closest("button")).not.toHaveAttribute("aria-disabled");
});

it("blocks direct navigation to a locked resource tab — the guard, not just the sidebar", async () => {
  vi.spyOn(founderApi, "me").mockResolvedValue({
    status: "onboarded", locked: { cohort: false, dashboard: false },
    resources_available: { store: false, fundraising: false, partners: false, assets: false, support: false },
  });
  const getStoreSpy = vi.spyOn(founderApi, "getStore");
  render(<MemoryRouter initialEntries={["/founder/store"]}><FounderPortal tab="store" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/isn't open yet/i)).toBeInTheDocument());
  expect(screen.queryByText(/procurement store/i)).not.toBeInTheDocument();
  expect(getStoreSpy).not.toHaveBeenCalled();
});

it("opens a resource tab once its flag is true", async () => {
  vi.spyOn(founderApi, "me").mockResolvedValue({
    status: "onboarded", locked: { cohort: false, dashboard: false },
    resources_available: { store: true, fundraising: false, partners: false, assets: false, support: false },
  });
  vi.spyOn(founderApi, "getStore").mockResolvedValue({ catalog: [], cart: [], cart_subtotal: 0 });
  render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
});

it("FounderResourceLocked copy is not the MOU-lock copy", async () => {
  vi.spyOn(founderApi, "me").mockResolvedValue({
    status: "onboarded", locked: { cohort: false, dashboard: false },
    resources_available: { store: false, fundraising: false, partners: false, assets: false, support: false },
  });
  render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/isn't open yet/i)).toBeInTheDocument());
  expect(screen.queryByText(/sign your mou/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run** — `cd frontend && npx vitest run src/pages/founder/__tests__/FounderPortal.test.jsx`. All pass.

- [ ] **Step 6: Mutation-check the guard specifically.** In `renderTab()`, comment out the `RESOURCE_LABELS[tab] && !resourcesAvailable[tab]` branch (let it fall through to `<FounderStore />` unconditionally). Confirm "blocks direct navigation..." fails (the `getStore` spy gets called, the locked-copy assertion fails). This is the test that proves the guard is real, not decorative. Restore and confirm green again. Report exactly what failed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/founder/FounderResourceLocked.jsx frontend/src/pages/founder/FounderPortal.jsx frontend/src/pages/founder/__tests__/FounderPortal.test.jsx
git commit -m "feat(founder): per-item Founders Resources lock with a real route guard"
```

**→ This is the natural point for the first production deploy** (spec §10: lock ships alone, verified, before the MOU work below). Confirm in prod: the one existing onboarded founder now sees all five Founders Resources items disabled (currently they are live with mockup catalog data — that access goes away the moment this ships, by design). `FOUNDER_RESOURCES_ENABLED` releases any item without a redeploy.

---

## Part B — Facility Agreement MOU (ships second)

### Task 4: Extractor script + committed template

**Files:**
- Create: `backend/scripts/source_docs/facility_agreement_2026-08-06.docx` (copy of the source file)
- Create: `backend/scripts/extract_agreement_template.py`
- Create: `backend/app/services/agreements/facility-v1.json`
- Test: `backend/tests/test_extract_agreement_template.py`

**Interfaces:**
- Produces: `extract_agreement_template.extract(docx_path: Path) -> dict` — the JSON-serializable template structure, and a CLI (`python scripts/extract_agreement_template.py <in.docx> <out.json>`).
- Template shape (generic — this script has zero Facility-Agreement-specific knowledge; that lives in Task 5):

```json
{
  "slug": "facility-v1",
  "source_file": "facility_agreement_2026-08-06.docx",
  "blocks": [
    {"type": "paragraph", "index": 0, "style": "Normal", "text": "FACILITY AGREEMENT", "placeholder_count": 0},
    {"type": "paragraph", "index": 4, "style": "Body Text", "text": "[•], having PAN [•], s/o/d/o [•], resident of [•] (hereinafter...)", "placeholder_count": 4},
    {"type": "table", "index": 126, "rows": [["S. No.", "Facility Description", "Type (Exclusive/Shared)", "Availability Window", "Additional Remarks"], ["1.", "Dedicated Seating", "Exclusive + Shared", "[•]", "..."], ...]}
  ]
}
```

- [ ] **Step 1: Copy the source file into the repo.**

```bash
mkdir -p backend/scripts/source_docs
cp "/Users/apple/Downloads/Facility Agreement_TIR Program_ARTPARK_(August 06, 2026).docx" \
   backend/scripts/source_docs/facility_agreement_2026-08-06.docx
```

- [ ] **Step 2: Write the failing extractor test** against the committed file:

```python
from pathlib import Path
from scripts.extract_agreement_template import extract

SOURCE = Path(__file__).resolve().parent.parent / "scripts" / "source_docs" / "facility_agreement_2026-08-06.docx"

def test_extracts_133_paragraphs_and_4_tables_in_order():
    result = extract(SOURCE)
    paras = [b for b in result["blocks"] if b["type"] == "paragraph"]
    tables = [b for b in result["blocks"] if b["type"] == "table"]
    assert len(paras) == 133
    assert len(tables) == 4
    # order preserved: the document's first block is the title paragraph
    assert result["blocks"][0]["text"].strip() == "FACILITY AGREEMENT"

def test_extracts_22_bullet_placeholders_total():
    result = extract(SOURCE)
    total = 0
    for b in result["blocks"]:
        if b["type"] == "paragraph":
            total += b["text"].count("[•]")
        else:
            for row in b["rows"]:
                for cell in row:
                    total += cell.count("[•]")
    assert total == 22

def test_collaborator_1_clause_is_extracted_verbatim():
    result = extract(SOURCE)
    para = next(b for b in result["blocks"] if b["type"] == "paragraph" and b["index"] == 4)
    assert para["placeholder_count"] == 4
    assert "Collaborator 1" in para["text"]

def test_facilities_schedule_table_has_six_placeholder_rows():
    result = extract(SOURCE)
    table = next(b for b in result["blocks"] if b["type"] == "table" and b["index"] == 126)
    placeholder_rows = [r for r in table["rows"] if "[•]" in r[3]]
    assert len(placeholder_rows) == 6
    assert table["rows"][1][1] == "Dedicated Seating"
    assert table["rows"][6][1] == "Administrative ID / Access Badge"

def test_a_revised_source_document_fails_loudly(tmp_path):
    """Guards against silent extraction drift: if the source changes shape,
    this test (run against the committed file) is the trip-wire — a
    paragraph or placeholder count that no longer matches is a signal the
    template JSON must be regenerated and every downstream index re-verified,
    not silently accepted."""
    result = extract(SOURCE)
    assert len(result["blocks"]) == 137  # 133 paragraphs + 4 tables
```

- [ ] **Step 3: Run and watch every test fail** (module not found).

- [ ] **Step 4: Implement `extract_agreement_template.py`.** Walk `document.element.body.iterchildren()`, wrap `p`/`tbl` children as `Paragraph`/`Table` (exactly the traversal used during planning research — see this plan's own opening research, not the docx's own `.paragraphs`/`.tables` properties, which lose document order relative to each other):

```python
"""Mechanical .docx → JSON template extractor. Run by a human when a new
agreement .docx arrives; the output is committed and is what the runtime
loads. This script has NO knowledge of what any field means — that belongs
to app/services/agreements.py, which interprets the committed JSON for a
specific agreement slug. Keeping this generic is what makes it reusable for
the Collaboration Agreement later."""
from __future__ import annotations
import json
import sys
from pathlib import Path

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph


def extract(docx_path: Path) -> dict:
    document = docx.Document(str(docx_path))
    blocks = []
    for i, child in enumerate(document.element.body.iterchildren()):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            para = Paragraph(child, document)
            blocks.append({
                "type": "paragraph", "index": i,
                "style": para.style.name if para.style else None,
                "text": para.text,
                "placeholder_count": para.text.count("[•]"),
            })
        elif tag == "tbl":
            table = Table(child, document)
            blocks.append({
                "type": "table", "index": i,
                "rows": [[c.text for c in row.cells] for row in table.rows],
            })
    return {"slug": None, "source_file": docx_path.name, "blocks": blocks}


def main(argv: list[str]) -> None:
    in_path, out_path, slug = Path(argv[0]), Path(argv[1]), argv[2] if len(argv) > 2 else None
    result = extract(in_path)
    if slug:
        result["slug"] = slug
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 5: Run the extractor for real** and commit its output as the shipped template:

```bash
cd backend && python scripts/extract_agreement_template.py \
  scripts/source_docs/facility_agreement_2026-08-06.docx \
  app/services/agreements/facility-v1.json \
  facility-v1
```

- [ ] **Step 6: Run the tests — all pass.**

- [ ] **Step 7: Mutation-check.** Change the traversal to iterate `document.paragraphs` instead of `body.iterchildren()` (this silently drops table-interleaving order and would still "work" on a flat count). Confirm `test_a_revised_source_document_fails_loudly` or the ordering assertion in the first test fails. Restore. Report what broke and why the naive approach is wrong (paragraphs-only traversal can't interleave tables at their real document position).

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/source_docs/facility_agreement_2026-08-06.docx \
        backend/scripts/extract_agreement_template.py \
        backend/app/services/agreements/facility-v1.json \
        backend/tests/test_extract_agreement_template.py
git commit -m "feat(agreements): extractor + committed facility-v1 template"
```

---

### Task 5: `agreements.py` — substitution engine

**Files:**
- Create: `backend/app/services/agreements.py`
- Test: `backend/tests/test_agreements.py`

**Interfaces:**
- Produces: `agreements.render_preview_text(collaborators: list[dict]) -> str`, `agreements.agreements_for_track(track: str) -> list[dict]`, and the internal `_resolve_blocks(collaborators: list[dict]) -> list[dict]` that Task 6's PDF renderer also consumes — factored out so preview text and the signed PDF can never drift from each other.
- Consumes: `app/services/agreements/facility-v1.json` (Task 4's output), `collaborators` — list of 1–3 dicts with keys `name`, `pan`, `parent_name`, `address` (already pydantic-validated by the caller).

This task is text-only — no reportlab, no PDF. Task 6 adds rendering on top of `_resolve_blocks`'s output.

- [ ] **Step 1: Write the failing tests.**

```python
import pytest
from app.services import agreements

ONE = [{"name": "Aditi Rao", "pan": "ABCDE1234F", "parent_name": "Suresh Rao", "address": "12 MG Road, Bengaluru"}]
TWO = ONE + [{"name": "Kiran Shah", "pan": "PQRSX5678L", "parent_name": "Manoj Shah", "address": "4 Church St, Bengaluru"}]
THREE = TWO + [{"name": "Divya Nair", "pan": "LMNOQ9012Z", "parent_name": "Ravi Nair", "address": "9 Brigade Rd, Bengaluru"}]


def test_one_collaborator_does_not_emit_second_or_third_block():
    text = agreements.render_preview_text(ONE)
    assert "Collaborator 2" not in text
    assert "Collaborator 3" not in text
    assert "Aditi Rao" in text


def test_two_collaborators_drops_only_the_third_block():
    text = agreements.render_preview_text(TWO)
    assert "Collaborator 1" in text and "Collaborator 2" in text
    assert "Collaborator 3" not in text
    assert "Kiran Shah" in text


def test_three_collaborators_renders_all_three():
    text = agreements.render_preview_text(THREE)
    assert all(f"Collaborator {n}" in text for n in (1, 2, 3))
    assert "Divya Nair" in text


def test_collaborator_fields_substitute_in_the_documented_order():
    """name, PAN, parent_name (s/o/d/o), address — the field-map order."""
    text = agreements.render_preview_text(ONE)
    assert "Aditi Rao, having PAN ABCDE1234F, s/o/d/o Suresh Rao, resident of 12 MG Road, Bengaluru" in text


def test_list_sentence_regenerates_for_one_collaborator():
    text = agreements.render_preview_text(ONE)
    assert 'Collaborator 1 shall be referred to as "Collaborator".' in text
    assert "individually referred to" not in text  # the 2/3-collaborator phrasing must not leak


def test_list_sentence_regenerates_for_three_collaborators():
    text = agreements.render_preview_text(THREE)
    assert 'Collaborator 1, Collaborator 2 and Collaborator 3 shall be individually referred to as "Collaborator" and collectively referred to as "Collaborators".' in text


def test_artpark_constants_appear():
    text = agreements.render_preview_text(ONE)
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]
    assert c["insurance_limit"] in text
    assert str(c["term_months"]) in text
    assert agreements._MONTH_WORDS[c["term_months"]] in text


def test_facilities_schedule_constants_appear_in_order():
    text = agreements.render_preview_text(ONE)
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]["availability_windows"]
    assert c["dedicated_seating"] in text
    assert c["access_badge"] in text


def test_no_placeholder_token_survives_any_collaborator_count():
    """The failure a reader notices first — checked for every arity, and for
    both placeholder syntaxes the source document actually uses."""
    for collaborators in (ONE, TWO, THREE):
        text = agreements.render_preview_text(collaborators)
        assert "[•]" not in text
        assert "[month]" not in text
        assert "[date]" not in text


def test_unresolved_placeholder_raises_instead_of_shipping_broken_text(monkeypatch):
    """Defensive check inside the renderer itself, not only in tests: if a
    future template edit adds a [•] this code doesn't know how to fill,
    fail loudly rather than emit a document with a visible blank."""
    bad_blocks = agreements._load_template("facility-v1")["blocks"] + [
        {"type": "paragraph", "index": 999, "text": "Unhandled [•] field.", "placeholder_count": 1}
    ]
    monkeypatch.setattr(agreements, "_load_template", lambda slug: {"blocks": bad_blocks})
    with pytest.raises(ValueError, match="placeholder"):
        agreements.render_preview_text(ONE)


def test_agreements_for_track_lists_facility_only():
    for track in ("tir", "sip"):
        ids = [a["slug"] for a in agreements.agreements_for_track(track)]
        assert ids == ["facility-v1"]
```

- [ ] **Step 2: Run and watch fail** (module not found).

- [ ] **Step 3: Implement `agreements.py`.** Key structural pieces:

```python
"""Agreement template loading + Facility-Agreement-specific substitution.

The template JSON (Task 4's output) is generic: an ordered list of
paragraph/table blocks with [•] markers preserved verbatim. Everything
below — which paragraph indices are the repeatable collaborator clauses,
which need the list-sentence regenerated, which table cells are ARTPARK's
facilities allocation — is knowledge specific to the Facility Agreement's
actual structure, confirmed by direct inspection of the source .docx. A
future second agreement (Collaboration) gets its own rule set; nothing here
is meant to generalize automatically.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_TEMPLATE_DIR = Path(__file__).resolve().parent / "agreements"
_BULLET = "[•]"

# ── ARTPARK constants — CONFIRM WITH ARTPARK OPS/LEGAL BEFORE PRODUCTION ──
# These are the values every founder's Facility Agreement will be signed
# with. Placeholder values below are structurally correct but NOT verified
# business terms; see the plan's final report for this open question.
TEMPLATE_CONSTANTS: dict[str, dict] = {
    "facility-v1": {
        "term_months": 6,
        "insurance_limit": "INR 10,00,000 (Rupees Ten Lakh only)",
        "collaboration_agreement_date": "06 August 2026",
        "execution_month": "August",
        "execution_date": "18",
        "availability_windows": {
            "dedicated_seating": "9:00 AM – 9:00 PM, Monday – Saturday",
            "lab_space": "9:00 AM – 9:00 PM, Monday – Saturday",
            "computing": "24x7",
            "wifi": "24x7",
            "conference_rooms": "9:00 AM – 6:00 PM, Monday – Friday, subject to booking",
            "access_badge": "24x7, subject to ARTPARK security policy",
        },
    },
}

_MONTH_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
                7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven",
                12: "twelve", 18: "eighteen", 24: "twenty-four", 36: "thirty-six"}

_COLLAB_FIELDS = ("name", "pan", "parent_name", "address")
# (AND-paragraph index, clause-paragraph index) per collaborator slot, in the
# order confirmed against the source document.
_COLLAB_BLOCK_INDICES = [(3, 4), (5, 6), (7, 8)]
_LIST_SENTENCE_INDEX = 9
_COLLAB_AGREEMENT_DATE_INDEX = 13
_TERM_INDEX = 34
_INSURANCE_INDEX = 88
_EXECUTION_DATE_PARAGRAPH_INDICES = (1, 19)
_FACILITIES_TABLE_INDEX = 126
_AVAILABILITY_ORDER = ("dedicated_seating", "lab_space", "computing", "wifi",
                       "conference_rooms", "access_badge")


@lru_cache
def _load_template(slug: str) -> dict:
    return json.loads((_TEMPLATE_DIR / f"{slug}.json").read_text(encoding="utf-8"))


def _fill_bullets(text: str, values: list[str]) -> str:
    parts = text.split(_BULLET)
    if len(parts) - 1 != len(values):
        raise ValueError(f"placeholder count mismatch: {text!r} expects {len(parts) - 1}, got {len(values)}")
    out = parts[0]
    for v, p in zip(values, parts[1:]):
        out += v + p
    return out


def _collaborator_list_sentence(n: int) -> str:
    labels = [f"Collaborator {i + 1}" for i in range(n)]
    if n == 1:
        return f'{labels[0]} shall be referred to as "Collaborator".'
    joined = f"{', '.join(labels[:-1])} and {labels[-1]}" if n > 2 else " and ".join(labels)
    return f'{joined} shall be individually referred to as "Collaborator" and collectively referred to as "Collaborators".'


def _resolve_blocks(collaborators: list[dict], slug: str = "facility-v1") -> list[dict]:
    if not 1 <= len(collaborators) <= 3:
        raise ValueError("1 to 3 collaborators required")
    c = TEMPLATE_CONSTANTS[slug]
    raw = _load_template(slug)["blocks"]
    # Slots beyond how many collaborators were actually supplied get dropped
    # whole (both the "AND" connector and the clause paragraph); slots up to
    # that count are kept and filled below.
    dropped_collab_indices = {i for pair in _COLLAB_BLOCK_INDICES[len(collaborators):] for i in pair}

    resolved = []
    for block in raw:
        idx = block["index"]
        if idx in dropped_collab_indices:
            continue
        if block["type"] == "table":
            if idx == _FACILITIES_TABLE_INDEX:
                rows = [list(r) for r in block["rows"]]
                for row_i, key in enumerate(_AVAILABILITY_ORDER, start=1):
                    rows[row_i][3] = c["availability_windows"][key]
                resolved.append({**block, "rows": rows})
            else:
                resolved.append(block)
            continue

        text = block["text"]
        if idx in {p for pair in _COLLAB_BLOCK_INDICES[: len(collaborators)] for p in pair} and block["placeholder_count"]:
            slot = next(i for i, pair in enumerate(_COLLAB_BLOCK_INDICES) if idx in pair)
            values = [str(collaborators[slot][f]) for f in _COLLAB_FIELDS]
            text = _fill_bullets(text, values)
        elif idx == _LIST_SENTENCE_INDEX:
            text = _collaborator_list_sentence(len(collaborators))
        elif idx == _COLLAB_AGREEMENT_DATE_INDEX:
            text = _fill_bullets(text, [c["collaboration_agreement_date"]])
        elif idx == _TERM_INDEX:
            words = _MONTH_WORDS.get(c["term_months"])
            if words is None:
                raise ValueError(f"no word form registered for term_months={c['term_months']}")
            text = _fill_bullets(text, [str(c["term_months"]), words])
        elif idx == _INSURANCE_INDEX:
            text = _fill_bullets(text, [c["insurance_limit"]])
        if idx in _EXECUTION_DATE_PARAGRAPH_INDICES:
            text = text.replace("[month]", c["execution_month"]).replace("[date]", c["execution_date"])

        if _BULLET in text or "[month]" in text or "[date]" in text:
            raise ValueError(f"placeholder survived resolution in block {idx}: {text!r}")
        resolved.append({**block, "text": text})
    return resolved


def render_preview_text(collaborators: list[dict], slug: str = "facility-v1") -> str:
    blocks = _resolve_blocks(collaborators, slug)
    lines = []
    for b in blocks:
        if b["type"] == "paragraph":
            lines.append(b["text"])
        else:
            for row in b["rows"]:
                lines.append(" | ".join(row))
    return "\n".join(lines)


def agreements_for_track(track: str) -> list[dict]:
    # Collaboration Agreement intentionally absent for every track until its
    # redlined draft is accepted (spec §3). Facility ships for both TIR
    # and VIP/SIP.
    return [{
        "slug": "facility-v1", "name": "Facility Agreement",
        "min_collaborators": 1, "max_collaborators": 3,
        "fields": [
            {"key": "name", "label": "Full legal name"},
            {"key": "pan", "label": "PAN"},
            {"key": "parent_name", "label": "Father's / Mother's / Spouse's name (s/o, d/o)"},
            {"key": "address", "label": "Residential address"},
        ],
    }]
```

- [ ] **Step 4: Run — all pass.**

- [ ] **Step 5: Mutation-check the two tests most likely to pass for the wrong reason.**
  1. In `_collaborator_list_sentence`, delete the `n == 1` special case so it falls through to the "individually/collectively" phrasing for a single collaborator. Confirm `test_list_sentence_regenerates_for_one_collaborator` fails.
  2. In `_resolve_blocks`, remove the final `if _BULLET in text ...: raise` guard. Confirm `test_unresolved_placeholder_raises_instead_of_shipping_broken_text` fails (it should now silently emit the unhandled placeholder instead of raising).
  Restore both. Report what broke for each.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/agreements.py backend/tests/test_agreements.py
git commit -m "feat(agreements): Facility Agreement substitution engine"
```

---

### Task 6: PDF rendering — reportlab platypus + pypdf merge

**Files:**
- Modify: `backend/app/services/agreements.py`
- Modify: `backend/tests/test_agreements.py`

**Interfaces:**
- Produces: `agreements.render_agreement_pdf(*, collaborators, signer_name, date_str, signature_png, accepted_acks, slug="facility-v1") -> bytes`.
- Consumes: `_resolve_blocks` from Task 5 (shared with preview — this is what guarantees preview text and the signed PDF never diverge).

**Why platypus + pypdf, not raw canvas (the existing `founder_mou.render_signed_pdf` pattern):** this document has four real tables (Schedule I–III) that need actual grid rendering, not `_wrap()`-and-`drawString()` line wrapping built for free text. `reportlab.platypus.SimpleDocTemplate` handles paragraph flow and `Table`/`TableStyle` natively. The signature block, though, is the same canvas-drawn image-embed the existing MOU renderer already does well — reimplementing that in platypus (a custom `Flowable`) is unnecessary work for one image. So: build the agreement body as a platypus document, draw the signature as a small one-page canvas document (reusing the existing embedding approach), and use `pypdf.PdfWriter` to concatenate the two into one PDF. This is why `pypdf` is a runtime dependency for this feature specifically — `founder_mou.py`'s existing renderer never needed it because it never merges two PDFs.

- [ ] **Step 1: Write the failing tests**, appended to `test_agreements.py`:

```python
import base64
from pypdf import PdfReader
import io

_PNG = "data:image/png;base64," + base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)).decode()


def test_render_agreement_pdf_returns_pdf_bytes():
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[],
    )
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 2000


def test_no_placeholder_survives_in_the_actual_pdf_text():
    """The direct assertion the task calls for: extract real text from the
    generated PDF bytes (not the pre-render string) and check it."""
    pdf = agreements.render_agreement_pdf(
        collaborators=THREE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[],
    )
    extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "[•]" not in extracted
    assert "[month]" not in extracted
    assert "[date]" not in extracted


def test_pdf_contains_every_collaborator_name():
    pdf = agreements.render_agreement_pdf(
        collaborators=THREE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[],
    )
    extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    for c in THREE:
        assert c["name"] in extracted


def test_two_collaborators_does_not_leak_a_third_empty_block_into_the_pdf():
    pdf = agreements.render_agreement_pdf(
        collaborators=TWO, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[],
    )
    extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "Collaborator 3" not in extracted


def test_signature_page_is_present_and_pdf_is_longer_with_more_collaborators():
    small = agreements.render_agreement_pdf(collaborators=ONE, signer_name="A", date_str="d", signature_png=_PNG, accepted_acks=[])
    big = agreements.render_agreement_pdf(collaborators=THREE, signer_name="A", date_str="d", signature_png=_PNG, accepted_acks=[])
    assert len(big) > len(small)
```

- [ ] **Step 2: Run and watch fail** (`render_agreement_pdf` not defined).

- [ ] **Step 3: Implement.** Add to `agreements.py`:

```python
def _build_body_pdf(blocks: list[dict]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle("FacilityBody", parent=styles["Normal"], fontSize=9.5, leading=13)
    heading_style = ParagraphStyle("FacilityHeading", parent=styles["Normal"], fontSize=11, leading=15, spaceBefore=8, spaceAfter=4)

    flowables = []
    for b in blocks:
        if b["type"] == "paragraph":
            if not b["text"].strip():
                flowables.append(Spacer(1, 4 * mm))
                continue
            style = heading_style if (b.get("style") or "").startswith("Headings") or b["text"].isupper() else body_style
            flowables.append(Paragraph(b["text"].replace("&", "&amp;"), style))
        else:
            table = Table(b["rows"], hAlign="LEFT")
            table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            flowables.append(table)
            flowables.append(Spacer(1, 4 * mm))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm).build(flowables)
    return buf.getvalue()


def _build_signature_page_pdf(signer_name: str, date_str: str, signature_png: str, accepted_acks: list[str] | None) -> bytes:
    # Reuses the exact image-embed approach founder_mou.render_signed_pdf
    # already proves works against the Lambda runtime's reportlab.
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    from .founder_mou import decode_signature_png, acknowledgement_text, _wrap

    raw_png = decode_signature_png(signature_png)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    x, y = 20 * mm, height - 25 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y, "Signature")
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.drawString(x, y, f"Signed by: {signer_name}    Date: {date_str}")
    y -= 10 * mm
    for ack_id in (accepted_acks or []):
        for i, line in enumerate(_wrap(acknowledgement_text(ack_id), 100)):
            c.drawString(x + 4 * mm, y, ("[x] " if i == 0 else "    ") + line)
            y -= 4.6 * mm
        y -= 1.5 * mm
    try:
        img = ImageReader(io.BytesIO(raw_png))
        c.drawImage(img, x, y - 20 * mm, width=55 * mm, height=18 * mm, preserveAspectRatio=True, mask="auto")
    except Exception:  # noqa: BLE001 — never fail the PDF over an image glitch
        pass
    c.showPage()
    c.save()
    return buf.getvalue()


def render_agreement_pdf(*, collaborators: list[dict], signer_name: str, date_str: str,
                          signature_png: str, accepted_acks: list[str] | None = None,
                          slug: str = "facility-v1") -> bytes:
    from pypdf import PdfWriter, PdfReader

    blocks = _resolve_blocks(collaborators, slug)
    body_pdf = _build_body_pdf(blocks)
    sig_pdf = _build_signature_page_pdf(signer_name, date_str, signature_png, accepted_acks)

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(body_pdf)).pages:
        writer.add_page(page)
    for page in PdfReader(io.BytesIO(sig_pdf)).pages:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
```

(Add `import io` at the top of `agreements.py` alongside the existing imports if not already present from Task 5.)

- [ ] **Step 4: Run — all pass.**

- [ ] **Step 5: Mutation-check.** Remove the `writer.add_page` loop for `sig_pdf` (ship the body only). Confirm `test_signature_page_is_present_and_pdf_is_longer_with_more_collaborators` still trivially passes (it doesn't test the signature page directly — this is the point of the check) but add and confirm a targeted assertion catches it: `assert len(PdfReader(io.BytesIO(pdf)).pages) >= 2` in `test_render_agreement_pdf_returns_pdf_bytes`, re-run, confirm THAT fails with the signature page removed. Restore. Report the gap this closes (a page-count-only smoke test would have missed a missing signature page).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/agreements.py backend/tests/test_agreements.py
git commit -m "feat(agreements): render the Facility Agreement to PDF (platypus + pypdf)"
```

---

### Task 7: Models + router wiring + the `template_version` bug fix

**Files:**
- Modify: `backend/app/models/founder.py`
- Modify: `backend/app/services/founder_mou.py`
- Modify: `backend/app/routers/founder.py`
- Modify: `backend/tests/test_founder_crud.py`
- Modify: `backend/tests/test_founder_mou.py`

**Interfaces:**
- Produces: `CollaboratorIn` model; `MouSignRequest.collaborators`; `MouPreviewRequest`; `founder_mou.sign_and_onboard(..., collaborators=...)`; `founder_mou.FACILITY_TEMPLATE_VERSION = "facility-v1"`.
- `GET /founder/mou` response gains `"agreements": agreements.agreements_for_track("tir")` and reports **the signed row's own `template_version`**, not the current constant.
- New `POST /founder/mou/preview`.

**The bug this task fixes:** today, `GET /mou` always returns `founder_mou.TEMPLATE_VERSION` (the *current* code constant), never the value stored on the signed row. The one production row (`signer_name='OOOO'`, `template_version='tir-mou-v2'`) would start reporting `'facility-v1'` the instant this ships — the exact "signed under an old version but labelled as if signed under the new one" bug the migration-free constraint is trying to avoid at the data layer, reappearing at the read layer if left unfixed.

- [ ] **Step 1: Add models** to `models/founder.py`:

```python
import re

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


class CollaboratorIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=200)
    pan: str = Field(min_length=10, max_length=10)
    parent_name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=1000)

    @field_validator("pan")
    @classmethod
    def _upper_pan(cls, v: str) -> str:
        v = v.strip().upper()
        if not _PAN_RE.match(v):
            raise ValueError("PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)")
        return v


class MouPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    collaborators: list[CollaboratorIn] = Field(min_length=1, max_length=3)
```

Extend `MouSignRequest`:

```python
class MouSignRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    signer_name: str = Field(min_length=1, max_length=200)
    signature_png: str = Field(min_length=32, max_length=2_000_000)
    acknowledgements: list[str] = Field(default_factory=list, max_length=32)
    collaborators: list[CollaboratorIn] = Field(min_length=1, max_length=3)
```

(Add `field_validator` to the existing `pydantic` import line if not already imported.)

- [ ] **Step 2: Wire `founder_mou.sign_and_onboard`.** Add `FACILITY_TEMPLATE_VERSION = "facility-v1"` near the existing `TEMPLATE_VERSION` constant (keep `TEMPLATE_VERSION` — the legacy renderer functions below it, `render_body`/`render_signed_pdf`/`_TEMPLATE_PATH`/`_wrap`, are untouched and stay importable for the one legacy row and its existing tests). Change the signature and body:

```python
def sign_and_onboard(*, application_id: str, user_id: str, signer_name: str,
                     founder_name: str, venture: str, signature_png: str,
                     collaborators: list[dict],
                     acknowledgements: list[str] | None = None) -> dict:
    missing = missing_acknowledgements(acknowledgements)
    if missing:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "acknowledgements_required", "missing": missing})
    accepted = list(REQUIRED_ACK_IDS)

    sb = get_admin_client()
    existing = (sb.table("founder_mou").select("*").eq("application_id", application_id)
                .limit(1).execute().data or [])
    if existing:
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail={"code": "mou_already_signed"})

    from . import agreements  # local import: agreements.py doesn't need this module at import time
    date_str = datetime.now(UTC).strftime("%d %b %Y")
    sig_path = f"{application_id}/mou/signature.png"
    pdf_path = f"{application_id}/mou/signed.pdf"

    _upload(sig_path, decode_signature_png(signature_png), "image/png")
    pdf = agreements.render_agreement_pdf(
        collaborators=collaborators, signer_name=signer_name, date_str=date_str,
        signature_png=signature_png, accepted_acks=accepted,
    )
    _upload(pdf_path, pdf, "application/pdf")

    row = {
        "application_id": application_id, "signer_name": signer_name,
        "signed_at": datetime.now(UTC).isoformat(), "signature_image_path": sig_path,
        "signed_pdf_path": pdf_path, "template_version": FACILITY_TEMPLATE_VERSION,
        "acknowledgements": accepted,
    }
    try:
        sb.table("founder_mou").insert(row).execute()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "mou_already_signed"}) from exc

    current = (sb.table("tir_applications").select("status").eq("id", application_id)
               .limit(1).execute().data or [])
    if current and current[0].get("status") == "offered":
        state_machine.apply_status_change(application_id, "tir", to_status="onboarded",
                                          changed_by=user_id, reason="MOU signed")
    return row
```

(`founder_name`/`venture` params are kept for signature compatibility with the caller but no longer feed the free-text template — `collaborators` carries the party details now. Note this explicitly in a comment so a future reader doesn't wonder why they're unused.)

- [ ] **Step 3: Fix the `GET /mou` version bug and extend the response** in `founder.py`:

```python
from ..services import agreements

@router.get("/mou")
async def get_mou(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou = founder_query.fetch_mou(ctx["application_id"])
    # Report the SIGNED ROW's own version when one exists — never the
    # current constant. A row signed under tir-mou-v2 must keep reporting
    # tir-mou-v2 forever, even after this deploy bumps new signings to
    # facility-v1. (Bug fixed here: the old code always returned the current
    # constant regardless of what was actually signed.)
    version = (mou or {}).get("template_version") or founder_mou.FACILITY_TEMPLATE_VERSION
    return {
        "template_version": version,
        "agreements": agreements.agreements_for_track("tir"),  # VIP wiring happens on feat/vip-onboarding
        "signed": mou is not None,
        "signed_at": (mou or {}).get("signed_at"),
        "signer_name": (mou or {}).get("signer_name"),
        "acknowledgements": founder_mou.ACKNOWLEDGEMENTS,
        "accepted_acknowledgements": (mou or {}).get("acknowledgements") or [],
    }


@router.post("/mou/preview")
async def preview_mou(payload: MouPreviewRequest,
                      ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    text = agreements.render_preview_text([c.model_dump() for c in payload.collaborators])
    return {"rendered_text": text}
```

(Remove the now-unused `body = founder_mou.render_body(...)` line and its `_signer_default` call from `get_mou` if nothing else references `body` in the response — check before deleting; `_signer_default` may still be useful as a signer-name prefill elsewhere in the frontend flow, in which case keep the helper but stop calling it inside `get_mou`.)

- [ ] **Step 4: Update `sign_mou`** to pass `collaborators` through:

```python
@router.post("/mou/sign")
async def sign_mou(payload: MouSignRequest, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    try:
        row = founder_mou.sign_and_onboard(
            application_id=ctx["application_id"], user_id=ctx["user_id"],
            signer_name=payload.signer_name, founder_name=payload.signer_name,
            venture=_project_name(ctx["app"]), signature_png=payload.signature_png,
            collaborators=[c.model_dump() for c in payload.collaborators],
            acknowledgements=payload.acknowledgements,
        )
    except ValueError as exc:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "invalid_signature", "message": str(exc)}) from exc
    return {"signed": True, "signed_at": row["signed_at"], "status": "onboarded"}
```

- [ ] **Step 5: Update existing tests.** In `test_founder_crud.py`, extend `_sign_body()`:

```python
def _sign_body(**over) -> dict:
    return {
        "signer_name": "Priya", "signature_png": _PNG, "acknowledgements": _all_acks(),
        "collaborators": [{"name": "Priya", "pan": "ABCDE1234F", "parent_name": "Rajesh", "address": "1 MG Road, Bengaluru"}],
        **over,
    }
```

Add the new version-per-row test:

```python
def test_get_mou_reports_the_signed_rows_own_version_not_the_current_constant(client, monkeypatch, _clear):
    """The exact bug this task fixes: a row signed under the OLD version must
    never start reporting the new one just because the constant moved on."""
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_mou": [{"application_id": "app1", "signer_name": "OOOO",
                         "template_version": "tir-mou-v2", "signed_pdf_path": "app1/mou/signed.pdf",
                         "signed_at": "2026-08-13", "acknowledgements": []}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/mou").json()
    assert body["template_version"] == "tir-mou-v2"


def test_sign_mou_stamps_facility_v1(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "offered",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [], "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 200, r.text
    assert fake.tables["founder_mou"][0]["template_version"] == "facility-v1"
```

In `test_founder_mou.py`, update `test_template_version_bumped_for_acknowledgements` — that test's name and assertion were about the acknowledgements-era bump (`tir-mou-v2`); it stays true (that constant is untouched), but add:

```python
def test_facility_template_version_constant():
    assert founder_mou.FACILITY_TEMPLATE_VERSION == "facility-v1"
```

- [ ] **Step 6: Run** — `cd backend && pytest tests/test_founder_crud.py tests/test_founder_mou.py tests/test_founder_access.py -q --no-cov`. All pass.

- [ ] **Step 7: Mutation-check the version-reporting fix specifically.** Revert `get_mou` to `"template_version": founder_mou.FACILITY_TEMPLATE_VERSION` unconditionally (the original bug). Confirm `test_get_mou_reports_the_signed_rows_own_version_not_the_current_constant` fails. Restore. Report the failure — this is the test protecting the one real production row.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/founder.py backend/app/services/founder_mou.py backend/app/routers/founder.py backend/tests/test_founder_crud.py backend/tests/test_founder_mou.py
git commit -m "feat(founder): wire the Facility Agreement into MOU sign + fix template_version reporting"
```

---

### Task 8: Frontend — `founderApi` thunks + the MOU wizard rewrite

**Files:**
- Modify: `frontend/src/lib/founderApi.js`
- Rewrite: `frontend/src/pages/founder/FounderMou.jsx`
- Rewrite: `frontend/src/pages/founder/__tests__/FounderMou.test.jsx`

**Interfaces:**
- Produces: `founderApi.previewMou(collaborators)`, `founderApi.signMou(signerName, signaturePng, acknowledgements, collaborators)` (extended signature — every existing call site is the one component being rewritten here, so nothing else breaks).
- `<FounderMou me={me} onSigned={refresh} />` unchanged as a prop contract — `FounderPortal.jsx` needs no change for this task.

- [ ] **Step 1: Extend `founderApi.js`**:

```js
  getMou: () => api.get("/founder/mou"),
  previewMou: (collaborators) => api.post("/founder/mou/preview", { collaborators }),
  signMou: (signerName, signaturePng, acknowledgements = [], collaborators = []) =>
    api.post("/founder/mou/sign", {
      signer_name: signerName, signature_png: signaturePng,
      acknowledgements, collaborators,
    }),
  mouSignedUrl: () => api.get("/founder/mou/signed-url"),
```

- [ ] **Step 2: Write the failing tests** in `FounderMou.test.jsx`. Keep the existing signed/unsigned/acknowledgement tests (update `unsigned()`'s fixture to include `agreements` since `GET /mou` now returns it), and add:

```jsx
const AGREEMENTS = [{
  slug: "facility-v1", name: "Facility Agreement",
  min_collaborators: 1, max_collaborators: 3,
  fields: [
    { key: "name", label: "Full legal name" },
    { key: "pan", label: "PAN" },
    { key: "parent_name", label: "Father's / Mother's / Spouse's name (s/o, d/o)" },
    { key: "address", label: "Residential address" },
  ],
}];

const unsigned = (over = {}) => ({
  template_version: "facility-v1", agreements: AGREEMENTS, signed: false, signer_name: "",
  acknowledgements: ACKS, accepted_acknowledgements: [], ...over,
});

describe("FounderMou — three distinct MOU states", () => {
  it("shows Not started when the wizard hasn't been opened", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/not started/i)).toBeInTheDocument());
  });

  it("shows a distinct Incomplete state once some fields are entered but not all", async () => {
    const user = userEvent.setup();
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => screen.getByLabelText(/full legal name/i));
    await user.type(screen.getByLabelText(/full legal name/i), "Aditi Rao");
    expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
    expect(screen.queryByText(/not started/i)).not.toBeInTheDocument();
  });

  it("shows the Signed state with a download action, and no editable fields", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue({
      ...unsigned(), signed: true, signer_name: "Priya", signed_at: "2026-08-18T00:00:00Z",
    });
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/signed/i)).toBeInTheDocument());
    expect(screen.getByText(/download/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/full legal name/i)).not.toBeInTheDocument();
  });
});

describe("FounderMou — collaborator fields are catalog-driven", () => {
  it("renders every field label from the backend catalog, not hardcoded copy", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByLabelText(/full legal name/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/PAN/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/s\/o, d\/o/i)).toBeInTheDocument();
  });

  it("a renamed catalog field label flows through to the screen with no frontend change", async () => {
    const renamed = { ...unsigned(), agreements: [{
      ...AGREEMENTS[0],
      fields: AGREEMENTS[0].fields.map((f) => f.key === "pan" ? { ...f, label: "Permanent Account Number" } : f),
    }] };
    vi.spyOn(founderApi, "getMou").mockResolvedValue(renamed);
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByLabelText(/permanent account number/i)).toBeInTheDocument());
  });
});

describe("FounderMou — 1-3 collaborators, dynamic", () => {
  it("starts with one collaborator block and can add up to three", async () => {
    const user = userEvent.setup();
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => screen.getByRole("button", { name: /add (another )?collaborator/i }));
    expect(screen.getAllByText(/collaborator 1/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/collaborator 2/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
    expect(screen.getByText(/collaborator 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
    expect(screen.getByText(/collaborator 3/i)).toBeInTheDocument();
    // caps at three
    expect(screen.queryByRole("button", { name: /add (another )?collaborator/i })).not.toBeInTheDocument();
  });

  it("cannot remove the last remaining collaborator", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => screen.getByLabelText(/full legal name/i));
    expect(screen.queryByRole("button", { name: /remove collaborator/i })).not.toBeInTheDocument();
  });
});

describe("FounderMou — Review step calls the preview endpoint", () => {
  it("advancing to Review sends the entered collaborators and shows the returned text", async () => {
    const user = userEvent.setup();
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    vi.spyOn(founderApi, "previewMou").mockResolvedValue({ rendered_text: "FACILITY AGREEMENT ... Aditi Rao ..." });
    render(<FounderMou me={{}} />);
    await waitFor(() => screen.getByLabelText(/full legal name/i));
    await user.type(screen.getByLabelText(/full legal name/i), "Aditi Rao");
    await user.type(screen.getByLabelText(/^PAN$/i), "ABCDE1234F");
    await user.type(screen.getByLabelText(/s\/o, d\/o/i), "Suresh Rao");
    await user.type(screen.getByLabelText(/residential address/i), "12 MG Road");
    await user.click(screen.getByRole("button", { name: /review/i }));
    await waitFor(() => expect(founderApi.previewMou).toHaveBeenCalledWith([
      { name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" },
    ]));
    expect(screen.getByText(/Aditi Rao/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement.** Rewrite `FounderMou.jsx` as a `Stepper`-driven wizard (reusing `frontend/src/pages/founder/components/Stepper.jsx`, the same component `FounderApproach.jsx` uses), four steps: `Your details` (1–3 collaborator blocks, fields mapped from `mou.agreements[0].fields`, add/remove, local state only — nothing persisted server-side until sign), `Review` (calls `founderApi.previewMou(collaborators)` on entry, shows `rendered_text`), `Sign` (existing signature-pad canvas + acknowledgement checklist, unchanged behavior), `Download` (existing signed-state panel, unchanged). Derive the three MOU states from local + server state:
  - **Not started:** every collaborator field across every block is empty.
  - **Incomplete:** at least one field has a value but at least one required field (per `mou.agreements[0].fields`, across all present collaborator blocks) is empty.
  - **Signed:** `mou.signed === true` — fields are not rendered at all in this state (read-only), matching the "Signed" test above.

  Render this status as a small label in the "Your details" step's header, next to the `eyebrow` (the same header row `Stepper`'s `progressLabel` slot sits in) — e.g. `<span className="fp-mou-status">{statusCopy}</span>` showing "Not started" / "Incomplete" / (nothing, once signed — that step doesn't render at all in the Signed state, superseded by the Download panel). It must be visible without advancing past step 0, since both tests assert on it immediately after the initial `getMou()` resolves.

- [ ] **Step 4: Run — all pass**, including the pre-existing tests carried over from the current `FounderMou.test.jsx` (signed confirmation + download, acknowledgement gating). Fix any prop-shape mismatches those inherited tests now hit (e.g. `unsigned()`'s fixture needing `agreements`).

- [ ] **Step 5: Mutation-check.** Collapse the "Not started" and "Incomplete" copy into one shared string (e.g. both render "Fill in your details"). Confirm the "shows a distinct Incomplete state" test fails on the `queryByText(/not started/i)).not.toBeInTheDocument()` assertion. Restore. Report the failure — this is the guard the task brief specifically asked for.

- [ ] **Step 6: Full frontend suite**

```bash
cd frontend && npx vitest run
```

Every test green, including every other founder page's tests (none of them import `FounderMou.jsx`, but `FounderPortal.test.jsx` renders the shell around it indirectly for other tabs — confirm nothing regressed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/founderApi.js frontend/src/pages/founder/FounderMou.jsx frontend/src/pages/founder/__tests__/FounderMou.test.jsx
git commit -m "feat(founder): Facility Agreement MOU wizard (details / review / sign / download)"
```

---

### Task 9: Full regression sweep + rollout checklist

**Files:** none (verification only).

- [ ] **Step 1: Backend — run every touched test file plus the two closest-neighbor suites**, to catch cross-file breakage the per-task runs wouldn't see:

```bash
cd backend && pytest tests/test_extract_agreement_template.py tests/test_agreements.py \
  tests/test_founder_crud.py tests/test_founder_mou.py tests/test_founder_access.py \
  tests/test_founder_resources.py -q --no-cov
```

All green. (Per CLAUDE.md's known gotcha: ~20-22 pre-existing failures exist elsewhere in the suite unrelated to this work — verify any new failure is actually in a file this plan touched before assuming it's yours.)

- [ ] **Step 2: Frontend — full suite**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 3: Direct assertion sanity-check, run once by hand** (not a substitute for the automated tests — a final human-legible confirmation before deploy):

```bash
cd backend && python3 -c "
from app.services import agreements
text = agreements.render_preview_text([
    {'name': 'Aditi Rao', 'pan': 'ABCDE1234F', 'parent_name': 'Suresh Rao', 'address': '12 MG Road'},
])
assert '[•]' not in text and '[month]' not in text and '[date]' not in text
print('clean:', len(text), 'chars')
"
```

- [ ] **Step 4: Rollout checklist** (spec §10 — two ordered deploys):
  1. Deploy Part A (Tasks 1–3) alone first. Verify in prod: `/founder/me` for the allowlisted account reports all five `resources_available` flags `false`; the sidebar shows all five items dimmed with 🔒; typing `/founder/store` shows "Art Infra isn't open yet", not the store. Confirm `FOUNDER_RESOURCES_ENABLED` can flip one item on without a redeploy.
  2. Deploy Part B (Tasks 4–8) after Part A is confirmed stable. Verify in prod: `GET /founder/mou` for the existing OOOO application still reports `template_version: "tir-mou-v2"` and `signed: true`, and its download link still resolves (the legacy row is untouched — this is the single most important prod check for this deploy). A fresh sign flow (do not test against the real allowlisted founder without coordinating — use staging or a scratch application) produces a `facility-v1` row and a downloadable PDF containing no `[•]`.
  3. Confirm `ARTPARK constants` in `agreements.py` (`term_months`, `insurance_limit`, `collaboration_agreement_date`, `execution_month`/`execution_date`, the six `availability_windows` values) have been reviewed against the real business terms before any founder signs for real — see open questions below.

---

## Out of scope

- **Collaboration Agreement.** Blocked on a revisions-accepted `.docx` (spec §3 — the current redlined draft has unaccepted tracked changes inside deleted runs, so extraction would yield broken text like "having PAN s"). When it ships, `agreements_for_track()` grows a second entry and `founder_mou`'s `unique(application_id)` constraint needs a real schema decision (`unique(application_id, agreement)` or a new table) — that is a migration, deliberately not planned here.
- **VIP staging wiring.** This worktree is TIR-only (based on `release/sip-launch-v1`, no VIP founder router exists here). `agreements.py` and `scripts/extract_agreement_template.py` are written track-agnostically so the `feat/vip-onboarding` branch can port them once its own founder-facing MOU surface exists; porting itself is not a task in this plan.
- **Draft persistence for in-progress collaborator details.** "Your details" lives in frontend local state only, sent to the backend in a single shot at sign time (bundled into `POST /founder/mou/sign`, same shape `POST /founder/mou/preview` already validated). No autosave, no server-side draft row — deliberate, to avoid a new table for a value that only needs to exist once, at signing.
- **Legacy `tir-mou-v2` renderer removal.** `founder_mou.render_body`/`render_signed_pdf`/`load_template`/`tir_mou.txt` stay in the codebase, unused by new signings, because the one production row depends on their continued importability (nothing re-renders that row; `signed_pdf_url()` just serves the already-generated file from storage) and their existing tests stay green rather than deleted.
- **Vercel/SAM promote.** As always, deploying either part to prod is the user's action.

## Open questions this plan could not resolve

1. **The spec's field-map said the Facilities schedule has 4 blanks; the real document has 6** (Wireless Internet and Conference Rooms also carry `[•]` in the Availability Window column, not just Dedicated Seating / Laboratory Space / Computing Resources). This plan builds against the real 6-row structure and documents the correction inline (see "Correction to the spec's field map," above the Global Constraints). Worth a second pair of eyes against the spec's author before Task 4 ships.
2. **The ARTPARK constants have no confirmed real values.** `term_months`, `insurance_limit`, `collaboration_agreement_date`, `execution_month`/`execution_date`, and the six `availability_windows` strings in `agreements.py` are structurally correct placeholders, not verified legal/business terms — nothing in the source materials available during planning specifies them. Task 6's rollout checklist step 3 flags this explicitly; ARTPARK ops/legal must confirm these values before any founder signs a real, binding copy.
3. **Whether the one allowlisted production founder should be told before Part A ships** that their Founders Resources access (currently live, mockup data) goes away. This is a communication/timing decision, not a code decision — flagged here rather than assumed.
