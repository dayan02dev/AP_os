"""Regenerate the academic-profile URL allow-list from the roster.

    python -m scripts.gen_academic_profile_urls

Reads frontend/public/iisc_professors.json (the committed scrape that the admin
Academic Jury Roster renders) and writes the distinct profile_url values to
backend/app/data/academic_profile_urls.json.

WHY an allow-list exists at all: POST /admin/platform/academic-profiles/enrich
takes a URL from the client and fetches it server-side. Fetching an arbitrary
client-supplied URL from inside Lambda is textbook SSRF — it could be pointed at
the instance metadata service or anything else reachable from the VPC. A host
allow-list is not enough here: the roster's 809 rows span 93 hostnames and only
~85% sit under iisc.ac.in (the rest are personal sites — github.io, weebly,
wixsite, university pages abroad). So the guard is an EXACT match against the
known set of roster URLs, which has zero SSRF surface and still covers every
professor.

Consequence: re-scrape the roster → re-run this script, or newly-added
professors get 422 url_not_in_roster when someone tries to enrich them. The
frontend copy in frontend/public/ is the source of truth; this file is a build
artefact of it, kept under backend/ because the SAM bundle only ships backend/.
"""
from __future__ import annotations

import json
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
_SRC = _REPO / "frontend" / "public" / "iisc_professors.json"
_DST = _BACKEND / "app" / "data" / "academic_profile_urls.json"


def main() -> int:
    if not _SRC.exists():
        print(f"✗ roster not found at {_SRC}")
        return 1
    rows = json.loads(_SRC.read_text())
    urls = sorted({
        (r.get("profile_url") or "").strip()
        for r in rows
        if (r.get("profile_url") or "").strip()
    })
    if not urls:
        print("✗ no profile_url values found — refusing to write an empty allow-list")
        return 1

    previous: list[str] = []
    if _DST.exists():
        try:
            previous = json.loads(_DST.read_text())
        except Exception:
            previous = []

    _DST.parent.mkdir(parents=True, exist_ok=True)
    _DST.write_text(json.dumps(urls, indent=0))

    added = sorted(set(urls) - set(previous))
    removed = sorted(set(previous) - set(urls))
    print(f"{len(rows)} roster rows → {len(urls)} distinct URLs → {_DST}")
    if previous:
        print(f"  +{len(added)} added, -{len(removed)} removed")
        for u in added[:10]:
            print(f"    + {u}")
        for u in removed[:10]:
            print(f"    - {u}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
