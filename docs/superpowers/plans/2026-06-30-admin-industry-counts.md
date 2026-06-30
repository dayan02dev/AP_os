# Admin Industry Filter — Real Track-Aware Counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin pipeline's hardcoded industry filter counts with real counts computed from the loaded applications, scoped to the selected track.

**Architecture:** Extract a pure exported helper `industryCountsFor(rows, track)` in `AdminPipeline.jsx`, compute the chip list via `useMemo`, switch the industry filter to an exact `s.domain` match, and render `{name} {count}` chips. Frontend-only.

**Tech Stack:** React + Vite, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-30-admin-industry-counts-design.md`

---

## Worktree

Already created: `.claude/worktrees/feat-industry-counts` (branch `feat/admin-industry-counts`, off `release/sip-launch-v1` @ `cba7307`). All paths below are relative to that worktree root. Commit messages must NOT add any Claude/AI co-author line.

## File map

| File | Change |
|---|---|
| `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` | remove hardcoded `INDUSTRIES`; add exported `industryCountsFor`; `useMemo` for chips; exact-match filter; chip render |
| `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js` | unit-test the helper + a render smoke test |

---

## Task 1: Real track-aware industry counts

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js`

Key facts about the current file (for exact edits):
- `const S = data?.startups || [];` (`:152`) — the loaded pipeline rows; each row has `track`, `domain`, `hidden`, `archived`.
- `const [industry, setIndustry] = React.useState('all');` (`:165`).
- Hardcoded `const INDUSTRIES = [ "Robotics & Automation 48", … ];` (`:92-105`).
- Industry filter block (`:265-269`): strips the trailing number via regex and compares lowercased to `s.domain`.
- Active-pill line (`:326`): `if (industry !== 'all') activeChips.push({ label: industry.replace(/\s+\d+$/, '').trim(), clear: () => setIndustry('all') });`
- Chip render (`:910-…`): `{INDUSTRIES.map(ind => ( <button key={ind} className={`lp-filter-btn${industry === ind ? ' active' : ''}`} onClick={() => setIndustry(ind)}>{ind}</button> ))}`.
- The test file already imports `{ render, screen, fireEvent }`, mocks `useAdminData` (its `pipeline` mock returns ONE startup: `name: "TestStartup"`, `domain: "Healthcare / MedTech"`, `track: "tir"`, `hidden: false`, `archived: false`), mocks `adminPlatformApi`, `PreviewBadge`, `ui.jsx`. The Filters panel (incl. industry chips) only renders after clicking the `Filters` toggle.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js`. Add `industryCountsFor` to the existing import of the component (or add a new import line):

```js
import { AdminPipeline, industryCountsFor } from "../screens/AdminPipeline.jsx";
```

(If `AdminPipeline` is already imported as `import { AdminPipeline } from "../screens/AdminPipeline.jsx";`, change that line to the one above rather than adding a duplicate import.)

Then add:

```js
describe("industryCountsFor", () => {
  const rows = [
    { domain: "EdTech", track: "tir" },
    { domain: "EdTech", track: "tir" },
    { domain: "EdTech", track: "sip" },
    { domain: "Robotics & Automation", track: "tir" },
    { domain: "EdTech", track: "tir", hidden: true },    // excluded
    { domain: "EdTech", track: "tir", archived: true },  // excluded
    { domain: "—", track: "tir" },                        // excluded (no industry)
  ];

  it("counts per industry across all tracks, excluding hidden/archived/empty", () => {
    expect(industryCountsFor(rows, "all")).toEqual([
      { name: "EdTech", count: 3 },
      { name: "Robotics & Automation", count: 1 },
    ]);
  });

  it("is track-aware", () => {
    expect(industryCountsFor(rows, "tir")).toEqual([
      { name: "EdTech", count: 2 },
      { name: "Robotics & Automation", count: 1 },
    ]);
    expect(industryCountsFor(rows, "sip")).toEqual([{ name: "EdTech", count: 1 }]);
  });

  it("handles empty input", () => {
    expect(industryCountsFor([], "all")).toEqual([]);
    expect(industryCountsFor(undefined, "all")).toEqual([]);
  });
});

describe("AdminPipeline industry chips (real counts)", () => {
  it("renders a computed count, not the hardcoded number", () => {
    render(React.createElement(AdminPipeline, { goDetail: vi.fn(), decisionMode: "reviewer" }));
    fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
    // The mock pipeline has exactly one Healthcare/MedTech (tir) row.
    expect(screen.getByText("Healthcare / MedTech 1")).toBeTruthy();
    // The old hardcoded "43" must be gone.
    expect(screen.queryByText("Healthcare / MedTech 43")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: FAIL — `industryCountsFor` is not exported; the chip still renders `"Healthcare / MedTech 43"`.

- [ ] **Step 3: Add the exported helper**

In `AdminPipeline.jsx`, add this exported function near the top (e.g. right after the imports, before the `getFriendlyStatus` helper):

```js
// Real industry chip counts from the loaded pipeline rows, scoped to the
// selected track. Excludes hidden/archived rows and rows without an industry
// ("—"). Returns [{ name, count }] sorted by count desc (name tiebreak).
export function industryCountsFor(rows, track) {
  const counts = new Map();
  for (const s of rows || []) {
    if (s.hidden || s.archived) continue;
    if (track && track !== "all" && s.track !== track) continue;
    const name = s.domain && s.domain !== "—" ? s.domain : null;
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Remove the hardcoded array**

Delete the entire `const INDUSTRIES = [ … ];` block (`:92-105`).

- [ ] **Step 5: Compute the chip list in the component**

Inside `AdminPipeline`, after `const S = data?.startups || [];` (`:152`), add:

```js
  const industries = React.useMemo(() => industryCountsFor(S, track), [S, track]);
```

(`track` state is declared a few lines below `S`; `useMemo` runs on render so the ordering is fine — but to be safe place this line AFTER the `const [track, setTrack] = React.useState('all');` declaration, e.g. just after the `const [batchFilter, …]` state line, so `track` is defined.)

- [ ] **Step 6: Exact-match the industry filter**

Replace the industry filter block (`:265-269`):

```js
    if (industry !== 'all') {
      const cleanIndustry = industry.replace(/\s+\d+$/, '').trim().toLowerCase();
      const sDomain = (s.domain || '').toLowerCase().trim();
      if (sDomain !== cleanIndustry) return false;
    }
```

with:

```js
    if (industry !== 'all') {
      if ((s.domain || '') !== industry) return false;
    }
```

- [ ] **Step 7: Fix the active-filter pill label**

Replace the industry active-chip line (`:326`):

```js
  if (industry !== 'all') activeChips.push({ label: industry.replace(/\s+\d+$/, '').trim(), clear: () => setIndustry('all') });
```

with:

```js
  if (industry !== 'all') activeChips.push({ label: industry, clear: () => setIndustry('all') });
```

- [ ] **Step 8: Render chips from the computed list**

Replace the `{INDUSTRIES.map(ind => ( … ))}` block (`:910-…`, the part AFTER the "All" button) with:

```jsx
                {industries.map(({ name, count }) => (
                  <button
                    key={name}
                    className={`lp-filter-btn${industry === name ? ' active' : ''}`}
                    onClick={() => setIndustry(name)}
                  >
                    {name} {count}
                  </button>
                ))}
```

(Leave the preceding "All" button — `industry === 'all'` — unchanged.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: PASS (whole file — the existing smoke/clear-filters/status/batch tests still pass; they don't depend on the hardcoded industries).

- [ ] **Step 10: Build**

Run: `cd frontend && npm run build`
Expected: clean (pre-existing chunk-size warning only).

- [ ] **Step 11: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-industry-counts
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js
git commit -m "fix(admin-ui): industry filter shows real track-aware counts (drop hardcoded list)"
```

---

## Task 2: Verify + deploy

- [ ] **Step 1: Full admin-platform frontend suite**

Run: `cd frontend && npx vitest run src/pages/admin/platform`
Expected: PASS.

- [ ] **Step 2: Push to release**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-industry-counts
git fetch origin
git rebase origin/release/sip-launch-v1     # resolve if origin advanced
git push origin feat/admin-industry-counts:release/sip-launch-v1
```

- [ ] **Step 3: Frontend deploy**

Frontend-only change → user does a Vercel **Promote to Production** on the resulting build. No SAM, no migration.

- [ ] **Step 4: Manual check (after promote)**

Open admin → Applications → Filters. Confirm each industry chip's number matches the result count when selected, with All and with TIR/VIP (the count changes per track).

---

## Self-review notes

- **Spec coverage:** remove hardcoded array → Step 4; computed track-aware counts → Steps 3+5; exact-match filter → Step 6; pill label → Step 7; chips render `{name} {count}` → Step 8; track-aware + excludes hidden/archived/empty → helper (Step 3) + tests (Step 1). All covered.
- **Consistency:** `industryCountsFor(rows, track)` signature is identical in the helper (Step 3), its `useMemo` call (Step 5), and the tests (Step 1); chips read `{name, count}` matching the helper's return shape; the filter compares `s.domain === industry` where `industry` is set to a `name` from the same list.
- **No placeholders:** every step has complete code + exact commands.
