# Edit-after-submit blank-screen fix + TIR window extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let submitted applicants edit their application when intake is closed (fix the blank/closed screen, both tracks), extend the TIR edit window to match VIP, and confirm edits persist to the DB.

**Architecture:** React/Vite SPA + FastAPI/Lambda + Supabase. The intake-close 403 on the draft fetch (`GET /{sip-}applications/me`) currently aborts a coupled `Promise.all`, so submitted apps never load and the app shows a terminal closed screen. Fix decouples the submitted-list fetch and lets the closed screen show only for brand-new applicants. The TIR window is a one-line backend config bump. Work in worktree `.claude/worktrees/edit-after-submit-fix` (branch `fix/edit-after-submit-blank-tir-window`, off `origin/release/sip-launch-v1` @ `c3bac0a`).

**Tech Stack:** Python 3.11 / pytest (append `--no-cov` to targeted runs). React / Vitest (`node_modules` symlinked). Commits: **no Co-Authored-By / AI references** (user's global rule). No DB migration.

**Spec:** `docs/superpowers/specs/2026-06-26-edit-after-submit-blank-fix-design.md`

---

## File Structure
- `backend/app/config.py:124` — `edit_deadline_tir` → 2026-07-05 (#B).
- `backend/tests/test_edit_window.py` — assert the new TIR default.
- `frontend/src/hooks/useApplication.jsx` — decouple TIR load (#A1).
- `frontend/src/App.jsx:767` — TIR closed-screen guard (#A2).
- `frontend/src/hooks/__tests__/useApplication.test.jsx` — TIR decouple test.
- `frontend/src/hooks/useSipApplication.jsx` — decouple SIP load (#A1).
- `frontend/src/AppSip.jsx:719` — SIP closed-screen guard (#A2).
- `frontend/src/hooks/__tests__/useSipApplication.test.jsx` (create) — SIP decouple test.

---

## Task 1: Extend the TIR edit window to match VIP (backend)

**Files:** Modify `backend/app/config.py`; Test `backend/tests/test_edit_window.py`.

- [ ] **Step 1: Write the failing test** — add to `backend/tests/test_edit_window.py`:
```python
def test_tir_edit_deadline_extended_to_match_sip():
    """TIR edit window extended to the SIP deadline (2026-07-05)."""
    from app.config import settings
    assert settings.edit_deadline_tir == "2026-07-05T23:59:59+05:30"
    assert settings.edit_deadline_tir == settings.edit_deadline_sip
```

- [ ] **Step 2: Run → FAIL** — `cd backend && python -m pytest tests/test_edit_window.py::test_tir_edit_deadline_extended_to_match_sip -v --no-cov` → FAIL (current default is `2026-06-25...`).

- [ ] **Step 3: Implement** — in `backend/app/config.py`, change line 124 from:
```python
    edit_deadline_tir: str = "2026-06-25T23:59:59+05:30"
```
to:
```python
    edit_deadline_tir: str = "2026-07-05T23:59:59+05:30"
```

- [ ] **Step 4: Run → PASS** — `cd backend && python -m pytest tests/test_edit_window.py -v --no-cov` → all pass.

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/edit-after-submit-fix
git add backend/app/config.py backend/tests/test_edit_window.py
git commit -m "feat(edit): extend TIR edit window to 2026-07-05 (match VIP)"
```

---

## Task 2: Decouple TIR load + closed-screen guard (frontend)

**Files:** Modify `frontend/src/hooks/useApplication.jsx`, `frontend/src/App.jsx`; Test `frontend/src/hooks/__tests__/useApplication.test.jsx`.

- [ ] **Step 1: Write the failing test** — add to `useApplication.test.jsx` (it already has `jsonResponse`, `Harness` calling `onReady(app)` → `appRef`, `seedAuthedSession`, and stubs `fetch`). Add a self-contained test:
```jsx
  it("loads submitted apps and sets tirClosed when the draft fetch is intake-closed", async () => {
    seedAuthedSession();
    const past = [{ id: "app-1", status: "under_review", submitted_at: "2026-06-15T00:00:00Z" }];
    globalThis.fetch
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { id: "u1", email: "u@x.com" }))) // /auth/me
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, past)))                            // /applications/me/submitted (now fetched first)
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(403, { error: "tir_submissions_closed", code: "tir_submissions_closed" }))); // /applications/me
    render(
      <AuthProvider>
        <ApplicationProvider>
          <Harness onReady={(a) => { appRef.current = a; }} />
        </ApplicationProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(appRef.current?.tirClosed).toBe(true));
    expect(appRef.current.submittedApps).toHaveLength(1);
    expect(appRef.current.submittedApps[0].id).toBe("app-1");
  });
```
If `appRef` in this file is a plain object (not a ref), use `appRef.xxx` assignment as the existing `onReady` does — match the file's existing harness (it sets `appRef = {}` in `beforeEach` and `onReady(app)`); adapt the assertion to however the file captures the latest `app` (e.g. assert on the captured object after `waitFor`). The behavioral assertions are the point: `tirClosed === true` **and** `submittedApps` length 1.

- [ ] **Step 2: Run → FAIL** — `cd frontend && npx vitest run src/hooks/__tests__/useApplication.test.jsx` → the new test FAILS (today the 403 aborts `Promise.all`, so `submittedApps` is empty).

- [ ] **Step 3a: Decouple the load** — in `frontend/src/hooks/useApplication.jsx`, replace the `async function load() { try { const [r, past] = await Promise.all([...]) ... } catch ... }` body with a decoupled version that always sets submitted apps first:
```jsx
    async function load() {
      // Submitted apps must ALWAYS load — never coupled to the draft fetch,
      // which 403s for submitted-only applicants once intake is closed.
      const past = await api.get("/applications/me/submitted").catch(() => []);
      if (cancelled) return;
      setSubmittedApps(Array.isArray(past) ? past : []);
      try {
        const r = await api.get("/applications/me");
        if (cancelled) return;
        setRow(r);
        setCompletion({
          completion_pct: r.completion_pct ?? 0,
          missing_required_fields: [],
          current_section: r.current_section ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403 && err.code === "wrong_track") {
          setWrongTrack(true);
        } else if (
          err instanceof ApiError &&
          err.status === 403 &&
          err.code === "tir_submissions_closed"
        ) {
          setTirClosed(true);
        } else {
          setError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
```
(Keep everything else — the `cancelled` flag, `setLoading(true)` before, the `return () => { cancelled = true; }` cleanup — unchanged.)

- [ ] **Step 3b: Guard the closed screen** — in `frontend/src/App.jsx`, change line 767 from:
```jsx
  if (user && tirClosed) {
```
to:
```jsx
  if (user && tirClosed && (submittedApps?.length ?? 0) === 0) {
```
(`submittedApps` is already destructured from the hook at the top of `App` — line ~163.)

- [ ] **Step 4: Run → PASS** — `cd frontend && npx vitest run src/hooks/__tests__/useApplication.test.jsx` → all pass.

- [ ] **Step 5: Grep-verify the guard** —
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/edit-after-submit-fix
grep -n "tirClosed && (submittedApps" frontend/src/App.jsx   # expect 1 match
```

- [ ] **Step 6: Commit**
```bash
git add frontend/src/hooks/useApplication.jsx frontend/src/App.jsx frontend/src/hooks/__tests__/useApplication.test.jsx
git commit -m "fix(applicant): submitted TIR applicants reach dashboard/edit when intake closed"
```

---

## Task 3: Decouple SIP load + closed-screen guard (frontend)

**Files:** Modify `frontend/src/hooks/useSipApplication.jsx`, `frontend/src/AppSip.jsx`; Test `frontend/src/hooks/__tests__/useSipApplication.test.jsx` (create).

- [ ] **Step 1: Write the failing test** — create `frontend/src/hooks/__tests__/useSipApplication.test.jsx`, mirroring `useApplication.test.jsx`'s structure but for the SIP provider (`SipApplicationProvider`, `useSipApplication` from `../useSipApplication.jsx`). The SIP hook exposes `submittedApps` and `sipClosed`:
```jsx
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SipApplicationProvider, useSipApplication } from "../useSipApplication.jsx";
import { AuthProvider } from "../useAuth.jsx";
import { _resetSessionForTests, saveSession } from "../../lib/session.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function Harness({ onReady }) { const app = useSipApplication(); onReady(app); return null; }

describe("useSipApplication intake-closed", () => {
  let appRef;
  beforeEach(() => { _resetSessionForTests(); vi.stubGlobal("fetch", vi.fn()); appRef = {}; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("loads submitted apps and sets sipClosed when the draft fetch is intake-closed", async () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    const past = [{ id: "app-1", status: "under_review", submitted_at: "2026-06-15T00:00:00Z" }];
    globalThis.fetch
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { id: "u1", email: "u@x.com" }))) // /auth/me
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, past)))                            // /sip-applications/me/submitted
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(403, { error: "sip_submissions_closed", code: "sip_submissions_closed" }))); // /sip-applications/me
    render(
      <AuthProvider>
        <SipApplicationProvider>
          <Harness onReady={(a) => { appRef.latest = a; }} />
        </SipApplicationProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(appRef.latest?.sipClosed).toBe(true));
    expect(appRef.latest.submittedApps).toHaveLength(1);
    expect(appRef.latest.submittedApps[0].id).toBe("app-1");
  });
});
```
(Confirm the exact provider/hook export names + that `useSipApplication` returns `submittedApps`/`sipClosed` — it does, per `useSipApplication.jsx`. Adjust the auth-mock count only if `AuthProvider` issues a different first call; the existing `useApplication.test.jsx` shows `/auth/me` is the first fetch.)

- [ ] **Step 2: Run → FAIL** — `cd frontend && npx vitest run src/hooks/__tests__/useSipApplication.test.jsx` → FAILS (coupled `Promise.all` aborts → `submittedApps` empty).

- [ ] **Step 3a: Decouple the SIP load** — in `frontend/src/hooks/useSipApplication.jsx`, replace the `async function load()` body (currently the coupled `Promise.all([api.get("/sip-applications/me"), api.get("/sip-applications/me/submitted").catch(() => [])])` + catch) with:
```jsx
    async function load() {
      // Submitted apps must ALWAYS load — never coupled to the draft fetch,
      // which 403s for submitted-only applicants once intake is closed.
      const past = await api.get("/sip-applications/me/submitted").catch(() => []);
      if (cancelled) return;
      setSubmittedApps(Array.isArray(past) ? past : []);
      try {
        const r = await api.get("/sip-applications/me");
        if (cancelled) return;
        setRow(r);
        setCompletion({
          completion_pct: r.completion_pct ?? 0,
          missing_required_fields: [],
          current_section: r.current_section ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403 && err.code === "wrong_track") {
          setWrongTrack(true);
        } else if (
          err instanceof ApiError &&
          err.status === 403 &&
          err.code === "sip_submissions_closed"
        ) {
          setSipClosed(true);
        } else {
          setError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
```
(Keep the `cancelled` flag, the `setLoading(true)`/`setError(null)`/`setWrongTrack(false)`/`setSipClosed(false)` resets before, and the cleanup unchanged.)

- [ ] **Step 3b: Guard the closed screen** — in `frontend/src/AppSip.jsx`, change line 719 from:
```jsx
  if (user && sipClosed) {
```
to:
```jsx
  if (user && sipClosed && (submittedApps?.length ?? 0) === 0) {
```
(`submittedApps` is already destructured from the hook at the top of `AppSip` — line ~194.)

- [ ] **Step 4: Run → PASS** — `cd frontend && npx vitest run src/hooks/__tests__/useSipApplication.test.jsx` → pass.

- [ ] **Step 5: Grep-verify the guard** —
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/edit-after-submit-fix
grep -n "sipClosed && (submittedApps" frontend/src/AppSip.jsx   # expect 1 match
```

- [ ] **Step 6: Commit**
```bash
git add frontend/src/hooks/useSipApplication.jsx frontend/src/AppSip.jsx frontend/src/hooks/__tests__/useSipApplication.test.jsx
git commit -m "fix(applicant): submitted VIP applicants reach dashboard/edit when intake closed"
```

---

## Task 4: Full verification

**Files:** none.

- [ ] **Step 1: Backend suite** — `cd backend && python -m pytest tests/test_edit_window.py tests/test_applications_edit.py tests/test_sip_applications_edit.py tests/test_submitted_edit.py -q --no-cov` → all pass (confirms edit endpoints persist `edited_after_submit`/`last_edited_at`). Then a quick whole-suite sanity: `python -m pytest -q --no-cov 2>&1 | tail -4` (≈19 pre-existing failures in `test_validate_submission_mandatory_fields`/`test_validation_limits` are unrelated — do NOT fix).

- [ ] **Step 2: Frontend suite** — `cd frontend && npx vitest run 2>&1 | tail -8` → all green except the known pre-existing `FileGridAnswer.test.jsx` collection error (missing `@testing-library/user-event` dep — unrelated).

- [ ] **Step 3: Grep + no-migration** —
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/edit-after-submit-fix
grep -n "tirClosed && (submittedApps" frontend/src/App.jsx
grep -n "sipClosed && (submittedApps" frontend/src/AppSip.jsx
grep -n 'edit_deadline_tir: str = "2026-07-05' backend/app/config.py
git diff --name-only c3bac0a..HEAD -- backend/migrations   # expect empty
```

- [ ] **Step 4: Commit log clean** — `git log --oneline c3bac0a..HEAD` shows the 3 implementation commits + docs, no AI trailers.

---

## Deploy (held for go-ahead)
- **Backend SAM deploy** (for the TIR window extension) — from the release worktree: grep `.env.prod` for `TIR_/SIP_SUBMISSIONS_CLOSED=true` (must stay true — only the *edit window* changes, intake stays closed), `./deploy-prod.sh`, push `release/sip-launch-v1`.
- **Frontend Vercel promote** (for the blank-screen fix) — done by the user from the dashboard.
- No migration.
- **Post-deploy smoke:** sign in as a submitted VIP applicant → dashboard loads (no blank), open submission → edit a field → it shows updated + `edited_after_submit=true` in the DB. Same for TIR (window now open through 5 Jul).
