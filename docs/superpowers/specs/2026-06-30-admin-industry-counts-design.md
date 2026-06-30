# Admin pipeline — real, track-aware industry counts — design spec

**Date:** 2026-06-30
**Surface:** Admin Applications portal — `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`. **Frontend-only. No backend, no migration.**

## Problem

The INDUSTRY filter chips show counts baked into a hardcoded array (`INDUSTRIES = ["Robotics & Automation 48", … "EdTech 6", …]`, `AdminPipeline.jsx:92-105`). These are static prototype numbers, never computed from real applications, so they don't match reality — e.g. the chip reads "EdTech 6" while selecting it (with TIR) yields 9 results. The industry filter currently strips the trailing number via regex (`industry.replace(/\s+\d+$/, '')`, `:266`, `:326`) to match `s.domain`.

## Decision (locked with the user)

**Track-aware counts.** Each chip's count reflects the currently selected track (All / TIR / VIP) and updates live when the track toggle changes. Counts are independent of the status/batch filters (those are normally "All" when picking an industry), so the chip matches the filtered result count in the common case. Counts exclude hidden/archived rows (same base the table shows).

## Current state (grounding)

- Pipeline rows come from `useAdminData("pipeline", {})` → `data.startups` (`S`); each row has `track`, `domain` (industry label, `"—"` when none), `hidden`, `archived`. All ~594 rows load client-side (well under `FETCH_CAP=5000`), so client-side counting is accurate.
- `filtered` (`AdminPipeline.jsx:226-273`) already excludes `s.archived` and `s.hidden`, then applies track / batch / search / status / industry. Industry match: `cleanIndustry = industry.replace(/\s+\d+$/,'').trim().toLowerCase()` vs `s.domain.toLowerCase()`.
- Chips render `{ind}` (the full hardcoded string incl. number) at `:910`; active-filter pill strips the number at `:326`.
- `AdminDashboard.jsx` already computes a real industry breakdown by grouping `pipelineData.startups` on `domain` — the same pattern this fix reuses.

## Change (`AdminPipeline.jsx`)

1. **Remove** the module-level `const INDUSTRIES = [...]` array.
2. **Add a `useMemo`** inside the component that computes the chip list from `S`, track-scoped:
   ```js
   const industries = React.useMemo(() => {
     const counts = new Map();
     for (const s of S) {
       if (s.hidden || s.archived) continue;
       if (track !== 'all' && s.track !== track) continue;
       const name = (s.domain && s.domain !== '—') ? s.domain : null;
       if (!name) continue;
       counts.set(name, (counts.get(name) || 0) + 1);
     }
     return Array.from(counts.entries())
       .map(([name, count]) => ({ name, count }))
       .sort((a, b) => b.count - a.count);
   }, [S, track]);
   ```
3. **Industry filter state stores the plain domain name.** Change the filter match (`:265-269`) to exact:
   ```js
   if (industry !== 'all') {
     if ((s.domain || '') !== industry) return false;
   }
   ```
   and the active-pill label (`:326`) to `{ label: industry, clear: () => setIndustry('all') }` (no regex strip).
4. **Render chips from `industries`** (`:910` area):
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
   The "All" chip (`industry === 'all'`) is unchanged.

No change to the `{filtered.length} of {S.length}` count, the search/track/status/batch logic, or any other screen.

## Result

With TIR selected, "EdTech N" shows the real count of non-hidden/non-archived TIR EdTech apps; clicking it yields exactly N when status/batch are "All". Switching All/TIR/VIP recomputes every chip. Industries with zero apps in the current track simply don't appear; an industry that exists in data but was missing from the old hardcoded list now shows up.

## Testing

- **vitest** (`AdminPipeline.test.js`): with a mocked `pipeline` containing rows across two industries/tracks, assert (a) a chip renders `"<industry> <count>"` with the count equal to the number of matching rows, (b) selecting the chip filters the table to that industry, (c) the count is track-scoped (switching the track changes the chip's number). Update/replace any existing test that referenced the hardcoded "AI screening"/industry strings.
- `npm run build` clean.
- Manual: open Applications, confirm each industry chip's number matches the result count when selected (All and TIR/VIP).

## Deploy

Frontend-only → push `feat/admin-industry-counts` → `release/sip-launch-v1` (rebase onto latest origin first) and Vercel **Promote to Production**. No SAM, no migration.

## Out of scope / non-goals

- No change to counts' relationship with status/batch (intentionally track-only). No backend industry-count endpoint. No change to the leadership dashboard. The `industry_categories` seed list is unchanged (chips are now derived from data, not that table).
