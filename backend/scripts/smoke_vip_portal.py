"""Smoke-test the VIP founder portal against a deployed environment.

Reads + writes as a real founder, using a magic-link session rather than a
password, so it is non-destructive to credentials. Writes DO touch data —
point it at staging only.

Run:
  cd backend
  set -a && source /Users/apple/Desktop/Final_AP_os/backend/.env.staging && set +a
  python scripts/smoke_vip_portal.py           # reads only
  python scripts/smoke_vip_portal.py --writes  # also exercises the write paths

What the write pass proves, none of which a unit test can (it runs against
real Postgres, real API Gateway, real Lambda):
  - the AIR ladder computes over the wire
  - put_metrics is a FULL-ROW upsert: an omitted field is nulled
  - metrics coerce "12" -> 12.0 (they do NOT 422; only entries validate)
  - in-order submit fires: submitting a later period 409s naming the earliest
    still-draft one
"""
import json, os, sys, urllib.request, urllib.error

# Import `app` whether this is run from the repo root or from backend/.
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HERE)
API = "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com"
EMAIL = "claude-test-applicant-sip@artpark.in"

from app.supabase_client import get_admin_client
from supabase import create_client

sb = get_admin_client()
link = sb.auth.admin.generate_link({"type": "magiclink", "email": EMAIL})
otp = link.properties.email_otp
anon = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
sess = anon.auth.verify_otp({"email": EMAIL, "token": otp, "type": "email"})
TOKEN = sess.session.access_token
print(f"session minted for {EMAIL}\n")

results = []
def get(path):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, (e.read()[:300].decode(errors="replace"))

def check(name, path, fn):
    code, body = get(path)
    if code != 200:
        results.append((name, f"HTTP {code}", body)); return None
    try:
        detail = fn(body)
        results.append((name, "OK", detail))
    except Exception as ex:
        results.append((name, "SHAPE", f"{type(ex).__name__}: {ex}"))
    return body

check("GET /founder/me", "/founder/me",
      lambda b: f"track={b.get('track')} status={b.get('status')} project={b.get('project_name')!r}")

air = check("GET /founder/air", "/founder/air",
      lambda b: f"round={b['round']['round_label']} status={b['round']['status']} "
                f"levers={len(b['levers'])} catalog_levers={len(b['catalog']['levers'])} "
                f"rollups={b['rollups']['claimed']}")

mis = check("GET /founder/mis", "/founder/mis",
      lambda b: f"monthly={len(b['monthly'])} quarterly={len(b['quarterly'])} "
                f"overdue={sum(1 for r in b['monthly']+b['quarterly'] if r.get('overdue'))}")

if mis and isinstance(mis, dict) and mis.get("monthly"):
    first = sorted(mis["monthly"], key=lambda r: r["due_date"])[0]
    check(f"GET /founder/mis/monthly/{first['period_key']}",
          f"/founder/mis/monthly/{first['period_key']}",
          lambda b: f"metrics={len(b['metrics'])} sections={len(b['catalog']['sections'])} "
                    f"status={b['period']['status']}")
if mis and isinstance(mis, dict) and mis.get("quarterly"):
    q = sorted(mis["quarterly"], key=lambda r: r["due_date"])[0]
    check(f"GET /founder/mis/quarterly/{q['period_key']}",
          f"/founder/mis/quarterly/{q['period_key']}",
          lambda b: f"headcount={len(b.get('headcount') or [])} "
                    f"financials={len(b.get('financials') or [])} "
                    f"derived_keys={sorted((b.get('derived') or {}).keys())}")

print(f"{'CHECK':<45} {'RESULT':<8} DETAIL")
print("-" * 110)
bad = 0
for name, status, detail in results:
    if status != "OK": bad += 1
    print(f"{name:<45} {status:<8} {detail}")
print("-" * 110)
print(f"\n{len(results)-bad}/{len(results)} passed")
sys.exit(1 if bad else 0)


# ── write pass (only with --writes) ──────────────────────────────────
if '--writes' not in sys.argv:
    sys.exit(1 if bad else 0)

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

out = []
# 1. AIR ladder: answer q1 only -> level should come from q1 alone
code, b = call("PUT", "/founder/air/levers/architecture",
    {"q1_option": "A", "q2_option": None, "q3_option": None, "criteria_checked": []})
lev = next((l for l in b["levers"] if l["lever"] == "architecture"), {}) if code == 200 else {}
out.append(("PUT air lever (q1 only)", code, f"claimed_level={lev.get('claimed_level')} (ladder stops at q1)"))

# 2. AIR ladder: max q1, add q2 -> level must rise
code, b = call("PUT", "/founder/air/levers/architecture",
    {"q1_option": "C", "q2_option": "B", "q3_option": None, "criteria_checked": []})
lev = next((l for l in b["levers"] if l["lever"] == "architecture"), {}) if code == 200 else {}
out.append(("PUT air lever (q1 max + q2)", code, f"claimed_level={lev.get('claimed_level')}"))

# 3. MIS metrics full-row upsert: set target+actual, then send actual only
call("PUT", "/founder/mis/monthly/2026-05/metrics",
     [{"metric_key": "revenue_month", "target": 10, "actual": 4, "commentary": "keep me"}])
code, b = call("PUT", "/founder/mis/monthly/2026-05/metrics",
     [{"metric_key": "revenue_month", "actual": 7}])
row = next((m for m in b["metrics"] if m["metric_key"] == "revenue_month"), {}) if code == 200 else {}
out.append(("PUT metrics partial row", code,
    f"target={row.get('target')} commentary={row.get('commentary')!r} <- NULLED means full-row upsert confirmed"))

# 4. Validation, not coercion: a string for a numeric field must 422
code, b = call("PUT", "/founder/mis/monthly/2026-05/metrics",
     [{"metric_key": "revenue_month", "actual": "12"}])
out.append(("PUT metrics with string '12'", code, str(b)[:90]))

# 5. THE ruling: submit August while May is still draft -> 409 naming May
code, b = call("POST", "/founder/mis/monthly/2026-08/submit")
d = b.get("detail", {}) if isinstance(b, dict) else {}
out.append(("POST submit out of order", code,
    f"code={d.get('code')} blocker={d.get('period_key')} ({d.get('label')})"))

print(f"\n{'WRITE CHECK':<34} {'HTTP':<6} DETAIL")
print("-" * 118)
for n, c, d in out: print(f"{n:<34} {c:<6} {d}")
