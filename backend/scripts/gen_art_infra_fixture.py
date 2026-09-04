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


# Six fields are `text` despite describing quantities: the catalog's real values
# embed units or lists ("68 dB(A)", "TDM / PDM", "Al 6061, ABS, PC"), so typing
# them number/multi_enum would make every seeded product fail validation and let
# an editor silently blank a real value. Typed inputs are demonstrated by the
# ~70 fields whose values are absent from the seed.
#
# Per-category spec fields. Keys are plain slugs so the existing free-text
# spec labels ("Channels", "SNR") map onto them by slugify() with no hand table.
# data_type is one of: text | number | enum | multi_enum | boolean
SPEC_FIELDS: dict[str, list[dict]] = {
    "sensors": [
        {"key": "modality", "label": "Sensing modality", "data_type": "text"},
        {"key": "channels", "label": "Channels", "data_type": "text", "filterable": True},
        {"key": "snr", "label": "SNR", "data_type": "text"},
        {"key": "interface", "label": "Interface", "data_type": "text"},
        {"key": "supply_voltage", "label": "Supply voltage", "data_type": "number", "unit": "V"},
        {"key": "operating_temp", "label": "Operating temperature", "data_type": "text"},
    ],
    "boards": [
        {"key": "form_factor", "label": "Form factor", "data_type": "text"},
        {"key": "mcu", "label": "MCU / SoC", "data_type": "text"},
        {"key": "io_count", "label": "I/O count", "data_type": "number"},
        {"key": "connectivity", "label": "Connectivity", "data_type": "multi_enum",
         "enum_options": ["Wi-Fi", "BLE", "LoRa", "Ethernet", "USB", "CAN"]},
        {"key": "supply_voltage", "label": "Supply voltage", "data_type": "number", "unit": "V"},
        {"key": "toolchain", "label": "Toolchain", "data_type": "text"},
        {"key": "resolution", "label": "Resolution", "data_type": "text"},
        {"key": "leads", "label": "Leads", "data_type": "text"},
        {"key": "isolation", "label": "Isolation", "data_type": "text"},
    ],
    "compute": [
        {"key": "architecture", "label": "Architecture", "data_type": "enum",
         "enum_options": ["x86", "ARM", "RISC-V"], "filterable": True},
        {"key": "cores", "label": "Cores", "data_type": "number"},
        {"key": "ram", "label": "RAM", "data_type": "number", "unit": "GB", "filterable": True},
        {"key": "accelerator", "label": "Accelerator", "data_type": "text"},
        {"key": "tdp", "label": "TDP", "data_type": "number", "unit": "W"},
        {"key": "compute", "label": "Compute", "data_type": "text"},
        {"key": "memory", "label": "Memory", "data_type": "text"},
        {"key": "power", "label": "Power", "data_type": "text"},
    ],
    "prototyping": [
        {"key": "service_type", "label": "Service type", "data_type": "enum",
         "enum_options": ["3D printing", "PCB assembly", "Wire harness", "Enclosure"],
         "filterable": True},
        {"key": "technology", "label": "Technology", "data_type": "text"},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "mm"},
        {"key": "materials", "label": "Materials", "data_type": "multi_enum",
         "enum_options": ["PLA", "ABS", "Nylon", "Resin", "FR4", "Aluminium"]},
        {"key": "turnaround", "label": "Turnaround", "data_type": "text"},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
        {"key": "process", "label": "Process", "data_type": "text"},
        {"key": "layers", "label": "Layers", "data_type": "text"},
        {"key": "max_size", "label": "Max size", "data_type": "text"},
        {"key": "qty", "label": "Qty", "data_type": "text"},
        {"key": "layer_height", "label": "Layer height", "data_type": "text"},
        {"key": "build_volume", "label": "Build volume", "data_type": "text"},
    ],
    "fabrication": [
        {"key": "process", "label": "Process", "data_type": "text"},
        {"key": "materials", "label": "Materials", "data_type": "text"},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "mm"},
        {"key": "max_envelope", "label": "Max part envelope", "data_type": "text"},
        {"key": "surface_finish", "label": "Surface finish", "data_type": "multi_enum",
         "enum_options": ["As-machined", "Bead blast", "Anodised", "Powder coat"]},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
        {"key": "finish", "label": "Finish", "data_type": "text"},
    ],
    "components": [
        {"key": "component_type", "label": "Component type", "data_type": "text"},
        {"key": "package", "label": "Package", "data_type": "text"},
        {"key": "tolerance", "label": "Tolerance", "data_type": "number", "unit": "%"},
        {"key": "operating_temp", "label": "Operating temperature", "data_type": "text"},
        {"key": "rohs", "label": "RoHS compliant", "data_type": "boolean"},
        {"key": "moq", "label": "Minimum order qty", "data_type": "number"},
        {"key": "shielding", "label": "Shielding", "data_type": "text"},
        {"key": "sterilisation", "label": "Sterilisation", "data_type": "text"},
    ],
    "power": [
        {"key": "cell_type", "label": "Chemistry / type", "data_type": "text"},
        {"key": "nominal_voltage", "label": "Nominal voltage", "data_type": "number", "unit": "V"},
        {"key": "capacity", "label": "Capacity", "data_type": "number", "unit": "Wh"},
        {"key": "max_current", "label": "Max current", "data_type": "number", "unit": "A"},
        {"key": "protection", "label": "Protection", "data_type": "multi_enum",
         "enum_options": ["OVP", "OCP", "OTP", "Short-circuit", "Cell balancing"]},
        {"key": "chemistry", "label": "Chemistry", "data_type": "text"},
        {"key": "bms", "label": "BMS", "data_type": "text"},
        {"key": "certs", "label": "Certs", "data_type": "text"},
    ],
    "software": [
        {"key": "licensing", "label": "Licensing model", "data_type": "enum",
         "enum_options": ["Perpetual", "Subscription", "Usage-based"],
         "filterable": True},
        {"key": "deployment", "label": "Deployment", "data_type": "enum",
         "enum_options": ["Cloud", "On-premise", "Hybrid"], "filterable": True},
        {"key": "seats", "label": "Seats included", "data_type": "text"},
        {"key": "compliance", "label": "Compliance", "data_type": "multi_enum",
         "enum_options": ["HIPAA", "GDPR", "ISO 13485", "21 CFR Part 11", "SOC 2"]},
        {"key": "support_sla", "label": "Support SLA", "data_type": "text"},
        {"key": "targets", "label": "Targets", "data_type": "text"},
        {"key": "term", "label": "Term", "data_type": "text"},
        {"key": "support", "label": "Support", "data_type": "text"},
        {"key": "modalities", "label": "Modalities", "data_type": "text"},
        {"key": "labellers", "label": "Labellers", "data_type": "text"},
        {"key": "qa", "label": "QA", "data_type": "text"},
        {"key": "onboarding", "label": "Onboarding", "data_type": "text"},
        {"key": "credit_value", "label": "Credit value", "data_type": "text"},
        {"key": "baa", "label": "BAA", "data_type": "text"},
        {"key": "gpu", "label": "GPU", "data_type": "text"},
        {"key": "validity", "label": "Validity", "data_type": "text"},
        {"key": "standards", "label": "Standards", "data_type": "text"},
        {"key": "modules", "label": "Modules", "data_type": "text"},
        {"key": "users", "label": "Users", "data_type": "text"},
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

    payload = {
        "vendors": sorted(vendors.values(), key=lambda v: v["name"]),
        "categories": sorted(categories.values(), key=lambda c: c["sort"]),
        "spec_fields": build_spec_fields(),
        "products": products,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}")
    print(f"  vendors    {len(payload['vendors'])}")
    print(f"  categories {len(payload['categories'])}")
    print(f"  products   {len(payload['products'])}")
    print(f"  spec_fields {len(payload['spec_fields'])}")
    mapped = sum(len(p["specs"]) for p in products)
    unmapped = sum(len(p["extra_specs"]) for p in products)
    print(f"  specs mapped {mapped}, unmapped {unmapped}")
    for p in products:
        for row in p["extra_specs"]:
            print(f"    UNMAPPED {p['id']} {row['k']!r}")
    missing = [p["name"] for p in products if p["lead_time_weeks_min"] is None]
    print(f"  lead time parsed for {len(products) - len(missing)}/{len(products)}")
    for name in missing:
        print(f"    NO LEAD TIME: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
