# Communication (Wired & Wireless) Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `comms` (Communication — Wired & Wireless) seed domain, and surgically re-classify existing wired/wireless-communication applications into it via a hybrid keyword→LLM identifier with a CSV preview gate.

**Architecture:** One additive migration adds the seed category (the classifier reads categories dynamically, so future apps can be classified into it, and all three filter surfaces pick it up with no frontend changes). A pure `comms_classifier` service does keyword shortlist + injectable LLM confirm. A dry-run/apply backfill script builds a preview CSV and, on approval, overwrites `ai_screening.industry_category_id='comms'` for confirmed apps only.

**Tech Stack:** FastAPI + Supabase (PostgREST); OpenRouter gemini-2.5-flash; pytest with `backend/tests/fixtures/fake_supabase.py`.

**Working dir:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-comms-domain` (branch `feat/comms-domain`).

**Test runner note:** single-file runs need `--no-cov`. Copy `backend/.env` from the release worktree first (`cp ../release-sip-launch-v1/backend/.env backend/.env`) so `Settings()` constructs.

---

## Task 1: Migration 035 — seed the `comms` category

**Files:**
- Create: `backend/migrations/035_comms_industry_category.sql`
- Test: `backend/tests/test_comms_migration.py`

- [ ] **Step 1: Write the migration**

```sql
-- 035_comms_industry_category.sql
-- Adds the "Communication (Wired & Wireless)" domain as a permanent seed
-- category. Additive + idempotent — safe to apply any time (no deploy-order
-- risk; existing code keeps working). The AI classifier reads industry_categories
-- dynamically, so future submissions can be classified into it automatically.
insert into public.industry_categories (id, label, is_seed) values
  ('comms', 'Communication (Wired & Wireless)', true)
on conflict (id) do nothing;
```

- [ ] **Step 2: Write the idempotency test**

```python
# backend/tests/test_comms_migration.py
from pathlib import Path
import re

def test_migration_035_is_idempotent_insert():
    sql = Path("migrations/035_comms_industry_category.sql").read_text().lower()
    assert "insert into public.industry_categories" in sql
    assert "'comms'" in sql
    assert "communication (wired & wireless)" in sql
    assert "on conflict (id) do nothing" in sql   # re-runnable
    assert "is_seed" in sql                          # permanent taxonomy
```

- [ ] **Step 3: Run**

Run: `cd backend && pytest tests/test_comms_migration.py --no-cov -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/035_comms_industry_category.sql backend/tests/test_comms_migration.py
git commit -m "feat(comms): migration 035 seeds the Communication domain"
```

---

## Task 2: `comms_classifier` service (keyword shortlist + injectable LLM confirm)

**Files:**
- Create: `backend/app/services/comms_classifier.py`
- Test: `backend/tests/test_comms_classifier.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_comms_classifier.py
from app.services import comms_classifier as cc


def test_shortlist_matches_comms_terms():
    text = "A 5G RF antenna transceiver for wireless backhaul over fiber optic links."
    terms = cc.shortlist(text)
    assert "5g" in terms and "antenna" in terms and "wireless" in terms
    assert "fiber optic" in terms


def test_shortlist_ignores_non_comms():
    assert cc.shortlist("A payments platform for small merchants.") == []
    # merely 'communicate' must NOT trip a keyword (precision left to LLM)
    assert cc.shortlist("Our app lets teams communicate faster.") == []


def test_identify_includes_confirmed_excludes_rejected():
    apps = [
        {"app_id": "a1", "track": "tir", "project_name": "RadioCo",
         "current_category": "semi", "text": "5G wireless RF transceiver"},
        {"app_id": "a2", "track": "tir", "project_name": "PayCo",
         "current_category": "other", "text": "A payments platform"},
        {"app_id": "a3", "track": "sip", "project_name": "NetCo",
         "current_category": "ai", "text": "AI over a wireless mesh network"},
    ]
    # stub confirm: a1 yes, a3 no (a2 never reaches confirm — not shortlisted)
    calls = []
    def fake_confirm(text):
        calls.append(text)
        return {"is_comms": "5G" in text or "RF" in text, "reason": "rf/5g"}
    out = cc.identify(apps, confirm_fn=fake_confirm)
    ids = {m["app_id"] for m in out}
    assert ids == {"a1"}                       # a3 confirmed no, a2 not shortlisted
    assert all("payments" not in t for t in calls)  # a2 never sent to the LLM
    assert out[0]["matched_terms"] and out[0]["current_category"] == "semi"


def test_confirm_parses_json_and_is_failsafe():
    ok = cc.confirm_is_comms("x", call=lambda _t: '{"is_comms": true, "reason": "rf"}')
    assert ok == {"is_comms": True, "reason": "rf"}
    bad = cc.confirm_is_comms("x", call=lambda _t: "not json")
    assert bad["is_comms"] is False            # parse error → safe false
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && pytest tests/test_comms_classifier.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement the service**

```python
# backend/app/services/comms_classifier.py
"""Identify wired/wireless communication ventures for domain re-classification.

Two testable units: `shortlist` (pure keyword scan) and `confirm_is_comms`
(one gemini-flash call). `identify` composes them; the LLM call is injectable so
tests never hit the network.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable

import httpx

log = logging.getLogger("app.comms_classifier")

CATEGORY_ID = "comms"

# Comms-specific terms. Deliberately excludes bare "communication"/"communicate"
# (too noisy); precision is delegated to the LLM confirm.
_PHRASES = [
    "fiber optic", "optical communication", "optical transceiver",
    "satellite communication", "satcom", "iot connectivity",
    "wireless network", "communication network", "networking hardware",
    "telecom infrastructure", "wi-fi", "software defined radio",
]
_WORDS = [
    "wireless", "rf", "5g", "6g", "wifi", "bluetooth", "zigbee", "lora",
    "lorawan", "spectrum", "antenna", "mmwave", "sdr", "transceiver",
    "cellular", "modem", "baseband", "ethernet", "docsis", "telecom",
    "telecommunications", "interconnect",
]
KEYWORDS = _WORDS + _PHRASES
_WORD_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in _WORDS}

_PROMPT = (
    "You classify deep-tech startups. Is this venture PRIMARILY about wired or "
    "wireless COMMUNICATION technology — networks, RF, wireless connectivity, "
    "telecom, optical/fiber communication, or networking hardware? A venture that "
    "merely 'communicates with users', has a chat feature, or a generic app is NOT "
    "communication tech. Respond STRICT JSON: "
    '{"is_comms": true|false, "reason": "<=15 words"}.'
)

_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"
_TIMEOUT = 30.0


def shortlist(text: str) -> list[str]:
    """Return the comms keywords/phrases found in `text` (empty = not a candidate)."""
    if not text:
        return []
    low = text.lower()
    matched = [w for w in _WORDS if _WORD_RE[w].search(text)]
    matched += [p for p in _PHRASES if p in low]
    return matched


def _call_openrouter(text: str) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    payload = {
        "model": _MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            _URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def confirm_is_comms(text: str, *, call: Callable[[str], str] = _call_openrouter) -> dict[str, Any]:
    """One LLM call → {is_comms: bool, reason: str}. Parse/HTTP error → safe false."""
    try:
        data = json.loads(call(text))
        return {"is_comms": bool(data.get("is_comms")), "reason": str(data.get("reason", ""))[:120]}
    except Exception as exc:  # noqa: BLE001
        log.warning("comms confirm failed: %s", exc)
        return {"is_comms": False, "reason": ""}


def identify(
    apps: list[dict[str, Any]], *, confirm_fn: Callable[[str], dict] | None = None
) -> list[dict[str, Any]]:
    """`apps` items: {app_id, track, project_name, current_category, text}.
    Shortlist first (no LLM), then confirm only the candidates. Returns confirmed
    matches with matched_terms + reason."""
    confirm = confirm_fn or confirm_is_comms
    out: list[dict[str, Any]] = []
    for a in apps:
        terms = shortlist(a.get("text", ""))
        if not terms:
            continue
        verdict = confirm(a["text"])
        if verdict.get("is_comms"):
            out.append({
                "app_id": a["app_id"],
                "track": a["track"],
                "project_name": a.get("project_name"),
                "current_category": a.get("current_category"),
                "matched_terms": terms,
                "reason": verdict.get("reason", ""),
            })
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && pytest tests/test_comms_classifier.py --no-cov -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comms_classifier.py backend/tests/test_comms_classifier.py
git commit -m "feat(comms): keyword-shortlist + LLM-confirm comms classifier"
```

---

## Task 3: Backfill driver (dry-run CSV preview + surgical --apply)

**Files:**
- Create: `backend/scripts/backfill_comms_domain.py`
- Test: `backend/tests/test_backfill_comms_domain.py`

- [ ] **Step 1: Write the failing test** (drives the pure apply/collect logic; the DB load + LLM are exercised only via the CLI, so the testable core is `collect_rows` + `apply_matches`)

```python
# backend/tests/test_backfill_comms_domain.py
from scripts import backfill_comms_domain as bd
from tests.fixtures.fake_supabase import FakeSupabase


def test_apply_sets_comms_and_backs_up_only_changed():
    sb = FakeSupabase({
        "industry_categories": [{"id": "comms", "label": "Communication (Wired & Wireless)"}],
        "ai_screening": [
            {"application_id": "a1", "application_track": "tir", "industry_category_id": "semi"},
            {"application_id": "a2", "application_track": "tir", "industry_category_id": "comms"},
        ],
    })
    matches = [
        {"app_id": "a1", "track": "tir", "current_category": "semi"},
        {"app_id": "a2", "track": "tir", "current_category": "comms"},  # already comms
    ]
    backup, changed = bd.apply_matches(sb, matches)
    assert changed == 1                                   # a2 skipped (already comms)
    assert backup == [{"app_id": "a1", "track": "tir", "old_category_id": "semi"}]
    row = next(r for r in sb.tables["ai_screening"] if r["application_id"] == "a1")
    assert row["industry_category_id"] == "comms"


def test_apply_requires_comms_category_to_exist():
    sb = FakeSupabase({"industry_categories": [], "ai_screening": []})
    try:
        bd.assert_category_exists(sb)
        assert False, "expected failure"
    except SystemExit:
        pass
```

- [ ] **Step 2: Run to verify fail** — `ModuleNotFoundError: scripts.backfill_comms_domain`.

- [ ] **Step 3: Implement the driver** (env-load + imports mirror `backfill_industry.py:36-63`)

```python
# backend/scripts/backfill_comms_domain.py
"""Re-classify wired/wireless communication apps into the `comms` domain.

    python -m scripts.backfill_comms_domain --dry-run   # preview CSV, no writes
    python -m scripts.backfill_comms_domain --apply      # backup + write

Dry-run writes comms-domain-preview.csv for human review. --apply backs up the
prior (app, old_category) to comms-domain-backup.json, then sets
ai_screening.industry_category_id='comms' for confirmed apps only (idempotent).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))
for _c in (".env.staging", ".env"):
    p = _ROOT / _c
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
        break

from app.services import comms_classifier as cc  # noqa: E402
from app.services.ai_pipeline.serialize import build_app_text  # noqa: E402
from app.supabase_client import get_admin_client  # noqa: E402

_TRACKS = ("tir", "sip")


def assert_category_exists(sb) -> None:
    rows = sb.table("industry_categories").select("id").eq("id", cc.CATEGORY_ID).execute().data or []
    if not any(r.get("id") == cc.CATEGORY_ID for r in rows):
        print(f"✗ category '{cc.CATEGORY_ID}' missing — apply migration 035 first")
        raise SystemExit(1)


def collect_rows(sb) -> list[dict]:
    """Build identify() inputs from screened apps on both tracks."""
    out: list[dict] = []
    for track in _TRACKS:
        screening = {
            (r["application_id"]): r
            for r in (sb.table("ai_screening").select(
                "application_id,industry_category_id,project_name,summary"
            ).eq("application_track", track).execute().data or [])
        }
        if not screening:
            continue
        apps = sb.table(f"{track}_applications").select("*").in_(
            "id", list(screening.keys())
        ).execute().data or []
        for a in apps:
            sc = screening.get(a["id"], {})
            text = build_app_text(a, track)
            if sc.get("summary"):
                text += "\n" + sc["summary"]
            if sc.get("project_name"):
                text += "\n" + sc["project_name"]
            out.append({
                "app_id": a["id"], "track": track,
                "project_name": sc.get("project_name"),
                "current_category": sc.get("industry_category_id"),
                "text": text,
            })
    return out


def apply_matches(sb, matches: list[dict]) -> tuple[list[dict], int]:
    """Set industry_category_id='comms' for confirmed apps not already comms.
    Returns (backup_entries, changed_count)."""
    backup: list[dict] = []
    changed = 0
    for m in matches:
        if m.get("current_category") == cc.CATEGORY_ID:
            continue
        backup.append({"app_id": m["app_id"], "track": m["track"],
                       "old_category_id": m.get("current_category")})
        sb.table("ai_screening").update({"industry_category_id": cc.CATEGORY_ID}) \
            .eq("application_id", m["app_id"]).eq("application_track", m["track"]).execute()
        changed += 1
    return backup, changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    args = ap.parse_args()
    sb = get_admin_client()
    assert_category_exists(sb)

    rows = collect_rows(sb)
    print(f"Screened apps scanned: {len(rows)}")
    matches = cc.identify(rows)
    print(f"Confirmed comms apps: {len(matches)}")

    with open("comms-domain-preview.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["app_id", "track", "project_name", "current_domain", "matched_terms", "llm_reason"])
        for m in matches:
            w.writerow([m["app_id"], m["track"], m.get("project_name"),
                        m.get("current_category"), "|".join(m["matched_terms"]), m.get("reason")])
    print("Wrote comms-domain-preview.csv")

    if not args.apply:
        print("DRY-RUN — no writes. Review the CSV, then re-run with --apply.")
        return
    backup, changed = apply_matches(sb, matches)
    Path("comms-domain-backup.json").write_text(json.dumps(backup, indent=2))
    print(f"APPLIED — {changed} apps set to '{cc.CATEGORY_ID}'. Backup: comms-domain-backup.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run to verify pass** — `cd backend && pytest tests/test_backfill_comms_domain.py --no-cov -v`

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill_comms_domain.py backend/tests/test_backfill_comms_domain.py
git commit -m "feat(comms): dry-run/apply backfill driver with CSV preview + backup"
```

---

## Task 4: Full suite + no-regression check

- [ ] **Step 1:** `cd backend && pytest tests/test_comms_classifier.py tests/test_backfill_comms_domain.py tests/test_comms_migration.py --no-cov -v` → green.
- [ ] **Step 2:** Sanity: `python -c "import app.main"` from backend/ (wires up).
- [ ] **Step 3:** Confirm no frontend change is needed by grepping that admin/reviewer filters derive from row labels (they do — `industryCountsFor`, `countBy("industry")`), and leadership reads the categories endpoint. No edits.

---

## Rollout (ops — user-gated)

- [ ] Apply `035_comms_industry_category.sql` in prod Supabase (additive; safe any time).
- [ ] Deploy backend (SAM) so the service + script ship. (Filters need no deploy.)
- [ ] Run `python -m scripts.backfill_comms_domain --dry-run` (locally against prod with the service-role key, or from the deployed env) → **user reviews `comms-domain-preview.csv`**.
- [ ] On approval: `--apply`. Verify the `Communication (Wired & Wireless)` pill + count on leadership, admin, and reviewer (both tracks). Vercel promote not required (no FE change).

---

## Self-review
- Spec coverage: category (T1), classifier shortlist+confirm (T2), driver dry-run/apply+backup+preview (T3), regression + no-FE-change check (T4), rollout. All spec sections mapped.
- Types consistent: `identify` item shape `{app_id, track, project_name, current_category, matched_terms, reason}` matches `apply_matches`/CSV usage; `CATEGORY_ID='comms'` used everywhere.
- No placeholders: every step has runnable code/commands.
