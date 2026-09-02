"""Emit the Art Infra UI fixture from the real founder_catalog constants.

Read-only: imports the module, writes one JSON file into the frontend. Touches
no database and no environment. Run from backend/:

    python3 scripts/gen_art_infra_fixture.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from app.services import founder_catalog as fc  # noqa: E402

OUT = (_ROOT.parent / "frontend/src/lib/__fixtures__/artInfraSeed.json")

# "3–4 weeks" (en-dash), "3-4 weeks" (hyphen), or "6 weeks".
_LEAD = re.compile(r"(\d+)\s*[–-]\s*(\d+)\s*weeks?|(\d+)\s*weeks?", re.I)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def split_lead_time(specs: list[dict]) -> tuple[list[dict], int | None, int | None]:
    """Lift the 'Lead time' spec row out into min/max week columns.

    Returns (specs_without_lead_time, min_weeks, max_weeks). A product with no
    lead-time row keeps its specs untouched and yields (None, None).
    """
    kept, lo, hi = [], None, None
    for row in specs:
        if row["k"].strip().lower() != "lead time":
            kept.append(row)
            continue
        m = _LEAD.search(row["v"])
        if m:
            if m.group(1):
                lo, hi = int(m.group(1)), int(m.group(2))
            else:
                lo = hi = int(m.group(3))
    return kept, lo, hi


def main() -> int:
    vendors, categories, products = {}, {}, []

    for product in fc.CATALOG:
        vid = slugify(product["vendor"])
        vendors.setdefault(vid, {
            "id": vid, "name": product["vendor"],
            # Admins fill these in through the UI; we invent no contact details.
            "contact_name": "", "contact_email": "", "contact_phone": "",
            "artpark_ref": "", "notes": "",
        })
        cid = slugify(product["cat"])
        categories.setdefault(cid, {"id": cid, "label": product["cat"],
                                    "sort": len(categories)})

        specs, lo, hi = split_lead_time(product.get("specs") or [])
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
            "specs": specs,
            "status": "published",
            "sort": len(products),
            "visible_tracks": ["tir"],
        })

    payload = {
        "vendors": sorted(vendors.values(), key=lambda v: v["name"]),
        "categories": sorted(categories.values(), key=lambda c: c["sort"]),
        "products": products,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}")
    print(f"  vendors    {len(payload['vendors'])}")
    print(f"  categories {len(payload['categories'])}")
    print(f"  products   {len(payload['products'])}")
    missing = [p["name"] for p in products if p["lead_time_weeks_min"] is None]
    print(f"  lead time parsed for {len(products) - len(missing)}/{len(products)}")
    for name in missing:
        print(f"    NO LEAD TIME: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
