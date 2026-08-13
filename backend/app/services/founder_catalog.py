"""Reference data for the Founders Resources tabs (procurement store,
fundraising & connects, corporate partners, book ARTPARK assets).

Transcribed verbatim from the design mockup
`TIR Onboarding.dc.html` (catalogData / investorsData / frTools /
partnersData / assetsData / seed bookings & tickets). This data is static
reference content — not stored in the DB — the per-applicant state layered
on top (cart, quote/intro/partner requests, bookings, tickets) lives in the
`founder_cart_items` / `founder_resource_requests` / `founder_bookings` /
`founder_tickets` tables (migration 038).

Money is kept as integer rupees throughout.
"""
from __future__ import annotations

# ── Procurement store ───────────────────────────────────────────────────────
CATALOG: list[dict] = [
    {
        "id": "c1", "name": "MEMS microphone array (8-ch)", "vendor": "Knowles",
        "cat": "Sensors", "type": "Hardware", "pricing": "fixed", "price": 8200,
        "blurb": "Low-noise 8-channel MEMS array for acoustic sensing.",
        "desc": (
            "A pre-calibrated 8-microphone MEMS array tuned for the 20 Hz–20 kHz "
            "band, with beamforming-ready channel matching. Ships with a reference "
            "carrier board and Python capture tooling used across ARTPARK acoustic "
            "projects."
        ),
        "specs": [
            {"k": "Channels", "v": "8, matched ±1 dB"},
            {"k": "SNR", "v": "68 dB(A)"},
            {"k": "Interface", "v": "TDM / PDM"},
            {"k": "Lead time", "v": "3–4 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Array datasheet (rev C)"},
            {"kind": "PDF", "name": "Beamforming app note"},
        ],
        "reviews": [
            {"name": "Rohan Iyer", "company": "AuralDx", "rating": 5,
             "text": "Channel matching saved us weeks of calibration. Carrier board just worked with our Jetson."},
            {"name": "Nisha P.", "company": "BreatheAI", "rating": 4,
             "text": "Great SNR. Docs assume some DSP background."},
        ],
    },
    {
        "id": "c2", "name": "ECG / HRV analog front-end board", "vendor": "Analog Devices",
        "cat": "Boards", "type": "Hardware", "pricing": "fixed", "price": 12500,
        "blurb": "Medical-grade AFE for ECG and heart-rate variability.",
        "desc": (
            "Three-lead ECG analog front-end with integrated right-leg drive and "
            "24-bit sigma-delta ADC. Designed for wearable and bedside form factors "
            "with a documented path to IEC 60601 compliance."
        ),
        "specs": [
            {"k": "Resolution", "v": "24-bit"},
            {"k": "Leads", "v": "3 (expandable)"},
            {"k": "Isolation", "v": "Reinforced, 5 kV"},
            {"k": "Lead time", "v": "5–6 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "AFE datasheet"},
            {"kind": "DOC", "name": "60601 compliance notes"},
        ],
        "reviews": [
            {"name": "Dr. Kavya M.", "company": "CardioSense", "rating": 5,
             "text": "Cleanest ECG traces we've measured at this price. RLD works out of the box."},
        ],
    },
    {
        "id": "c3", "name": "Edge SoC dev module", "vendor": "NVIDIA Jetson",
        "cat": "Compute", "type": "Hardware", "pricing": "fixed", "price": 15500,
        "blurb": "Compact edge AI compute for on-device inference.",
        "desc": (
            "Jetson-class edge module with 8 GB LPDDR5 and a 40 TOPS NPU, on a "
            "carrier with M.2, CSI, and industrial I/O. The standard ARTPARK target "
            "for on-device model deployment."
        ),
        "specs": [
            {"k": "Compute", "v": "40 TOPS"},
            {"k": "Memory", "v": "8 GB LPDDR5"},
            {"k": "Power", "v": "7–15 W"},
            {"k": "Lead time", "v": "2–3 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Module datasheet"},
            {"kind": "PDF", "name": "Carrier schematic"},
        ],
        "reviews": [
            {"name": "Arjun N.", "company": "Neonatal monitor", "rating": 4,
             "text": "Plenty of headroom for our quantised model. Thermals need a heatsink under sustained load."},
            {"name": "Team Vahan", "company": "Vahan Robotics", "rating": 5,
             "text": "Best price/perf we found in India. Fast delivery."},
        ],
    },
    {
        "id": "c4", "name": "Rapid PCB fabrication (2-layer, 10 pcs)", "vendor": "ARTPARK Fab",
        "cat": "Prototyping", "type": "Hardware", "pricing": "fixed", "price": 6500,
        "blurb": "Quick-turn 2-layer PCB prototyping run.",
        "desc": (
            "In-house quick-turn PCB fabrication for 2-layer boards up to "
            "100×100 mm, 10 pieces, with HASL finish. Typical turnaround is "
            "48–72 hours from Gerber submission."
        ),
        "specs": [
            {"k": "Layers", "v": "2"},
            {"k": "Max size", "v": "100 × 100 mm"},
            {"k": "Qty", "v": "10 boards"},
            {"k": "Turnaround", "v": "48–72 hrs"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Fab capabilities & DRC"},
        ],
        "reviews": [
            {"name": "Meera D.", "company": "Neonatal monitor", "rating": 5,
             "text": "Faster than any external fab and they catch DRC issues before running."},
        ],
    },
    {
        "id": "c5", "name": "Resin 3D printing (per part)", "vendor": "ARTPARK Fab",
        "cat": "Prototyping", "type": "Hardware", "pricing": "fixed", "price": 1800,
        "blurb": "High-resolution SLA parts for enclosures & fixtures.",
        "desc": (
            "Per-part SLA resin printing at 50 µm layer height for enclosures, "
            "jigs, and test fixtures. Standard, tough, and biocompatible resins "
            "available."
        ),
        "specs": [
            {"k": "Process", "v": "SLA"},
            {"k": "Layer height", "v": "50 µm"},
            {"k": "Build volume", "v": "192 × 120 × 245 mm"},
            {"k": "Turnaround", "v": "24–48 hrs"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Resin material guide"},
        ],
        "reviews": [
            {"name": "Sana K.", "company": "OrthoFit", "rating": 4,
             "text": "Surface finish is excellent. Biocompatible resin has a longer queue."},
        ],
    },
    {
        "id": "c6", "name": "Custom enclosure CNC machining", "vendor": "Precision Enclosures",
        "cat": "Fabrication", "type": "Hardware", "pricing": "quote", "price": 0,
        "blurb": "Machined metal/plastic enclosures to spec.",
        "desc": (
            "Custom CNC machining for aluminium and engineering-plastic "
            "enclosures, including anodising and silk-screen. Priced per project "
            "from your CAD and finish requirements."
        ),
        "specs": [
            {"k": "Materials", "v": "Al 6061, ABS, PC"},
            {"k": "Finish", "v": "Anodise, bead-blast"},
            {"k": "MOQ", "v": "1"},
            {"k": "Lead time", "v": "3–5 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Tolerance & finish guide"},
        ],
        "reviews": [
            {"name": "Vikram S.", "company": "RoboHarvest", "rating": 5,
             "text": "Quote came back in a day and the anodised finish was flawless."},
        ],
    },
    {
        "id": "c7", "name": "Medical-grade cable assembly", "vendor": "Molex",
        "cat": "Components", "type": "Hardware", "pricing": "fixed", "price": 3400,
        "blurb": "Sterilisable, shielded cable assemblies.",
        "desc": (
            "Custom shielded cable assemblies rated for repeated autoclave and "
            "EtO sterilisation, with medical connectors and documented "
            "biocompatibility."
        ),
        "specs": [
            {"k": "Shielding", "v": "Braid + foil"},
            {"k": "Sterilisation", "v": "Autoclave / EtO"},
            {"k": "MOQ", "v": "25"},
            {"k": "Lead time", "v": "4–6 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Assembly spec sheet"},
        ],
        "reviews": [
            {"name": "Dr. Anitha K.", "company": "IISc CDS", "rating": 4,
             "text": "Held up through 200+ autoclave cycles in testing."},
        ],
    },
    {
        "id": "c8", "name": "Custom battery pack + BMS", "vendor": "Inventus Power",
        "cat": "Power", "type": "Hardware", "pricing": "quote", "price": 0,
        "blurb": "Bespoke Li-ion packs with certified BMS.",
        "desc": (
            "Design and build of custom lithium-ion packs with an integrated, "
            "certified battery-management system. Priced per project against "
            "your capacity, form-factor, and certification needs."
        ),
        "specs": [
            {"k": "Chemistry", "v": "Li-ion / LiFePO₄"},
            {"k": "BMS", "v": "Certified, configurable"},
            {"k": "Certs", "v": "IS 16046 path"},
            {"k": "Lead time", "v": "6–8 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Pack design questionnaire"},
        ],
        "reviews": [
            {"name": "Team Ampere", "company": "Ampere Mobility", "rating": 5,
             "text": "They handled certification paperwork end-to-end. Worth the quote process."},
        ],
    },
    {
        "id": "c9", "name": "Edge inference SDK (annual licence)", "vendor": "Deci AI",
        "cat": "Software", "type": "Software", "pricing": "fixed", "price": 45000,
        "blurb": "Model optimisation & runtime for edge deployment.",
        "desc": (
            "Annual licence for an edge inference SDK that quantises, prunes, and "
            "compiles models for the target NPU, with a profiling suite. Includes "
            "one seat and priority support."
        ),
        "specs": [
            {"k": "Seats", "v": "1 (add-on available)"},
            {"k": "Targets", "v": "Jetson, ARM, x86"},
            {"k": "Term", "v": "12 months"},
            {"k": "Support", "v": "Priority email"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "SDK overview"},
            {"kind": "URL", "name": "API documentation"},
        ],
        "reviews": [
            {"name": "Arjun N.", "company": "Neonatal monitor", "rating": 5,
             "text": "Cut our inference latency by 40% with almost no accuracy loss."},
            {"name": "Dev team", "company": "VisionAgri", "rating": 4,
             "text": "Great tooling; licensing per seat adds up as you grow."},
        ],
    },
    {
        "id": "c10", "name": "Clinical data annotation platform", "vendor": "Centaur Labs",
        "cat": "Software", "type": "Software", "pricing": "quote", "price": 0,
        "blurb": "Expert-labelled medical data at scale.",
        "desc": (
            "Managed annotation platform with clinician-in-the-loop labelling for "
            "medical imaging, signals, and video. Priced per project by volume, "
            "modality, and required expertise."
        ),
        "specs": [
            {"k": "Modalities", "v": "Imaging, signal, video"},
            {"k": "Labellers", "v": "Verified clinicians"},
            {"k": "QA", "v": "Consensus scoring"},
            {"k": "Onboarding", "v": "1–2 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Platform & QA methodology"},
        ],
        "reviews": [
            {"name": "Meera D.", "company": "Neonatal monitor", "rating": 5,
             "text": "Label quality on our recordings was far above in-house crowd work."},
        ],
    },
    {
        "id": "c11", "name": "HIPAA-ready cloud (compute credits)", "vendor": "AWS Activate",
        "cat": "Software", "type": "Software", "pricing": "fixed", "price": 60000,
        "blurb": "Compliant cloud compute & storage credits.",
        "desc": (
            "A credit pack for HIPAA-eligible cloud services — GPU training "
            "instances, object storage, and managed databases — with a signed "
            "BAA and reference architecture for health workloads."
        ),
        "specs": [
            {"k": "Credit value", "v": "₹60,000"},
            {"k": "BAA", "v": "Included"},
            {"k": "GPU", "v": "A10G / A100 on demand"},
            {"k": "Validity", "v": "12 months"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "Reference architecture"},
            {"kind": "URL", "name": "Eligible-services list"},
        ],
        "reviews": [
            {"name": "Arjun N.", "company": "Neonatal monitor", "rating": 4,
             "text": "Credits stretched our training budget nicely. Watch egress costs."},
        ],
    },
    {
        "id": "c12", "name": "Regulatory QMS software", "vendor": "Qualio",
        "cat": "Software", "type": "Software", "pricing": "quote", "price": 0,
        "blurb": "Quality management system for medical devices.",
        "desc": (
            "Cloud QMS for ISO 13485 and design-control workflows — document "
            "control, CAPA, and audit trails. Priced per project by team size and "
            "module selection."
        ),
        "specs": [
            {"k": "Standards", "v": "ISO 13485, 21 CFR 820"},
            {"k": "Modules", "v": "DControl, CAPA, Training"},
            {"k": "Users", "v": "From 5"},
            {"k": "Onboarding", "v": "2–3 weeks"},
        ],
        "datasheets": [
            {"kind": "PDF", "name": "QMS module overview"},
        ],
        "reviews": [
            {"name": "Dr. Anitha K.", "company": "IISc CDS", "rating": 5,
             "text": "Made our design-history file audit-ready without a dedicated QA hire."},
        ],
    },
]

# ── Fundraising & connects ─────────────────────────────────────────────────
INVESTORS: list[dict] = [
    {"id": "i1", "name": "Anish Rao", "firm": "Endiya Partners",
     "focus": "Seed · deep-tech health", "cheque": "₹4–8 Cr", "thesis": "Medtech"},
    {"id": "i2", "name": "Kavya Menon", "firm": "pi Ventures",
     "focus": "Seed · AI / robotics", "cheque": "₹3–6 Cr", "thesis": "AI-first"},
    {"id": "i3", "name": "Deep Shah", "firm": "Blume Ventures",
     "focus": "Pre-A · frontier tech", "cheque": "₹6–12 Cr", "thesis": "Hardware"},
    {"id": "i4", "name": "Rhea Kapoor", "firm": "IndiaQuotient",
     "focus": "Seed · health access", "cheque": "₹2–5 Cr", "thesis": "Impact"},
]

FR_TOOLS: list[dict] = [
    {"name": "Pitch deck template",
     "desc": "ARTPARK's deep-tech narrative structure, slide by slide."},
    {"name": "Data-room checklist",
     "desc": "Everything a diligence team will ask for, pre-organised."},
    {"name": "Cap table & dilution model",
     "desc": "Model rounds, ESOP, and dilution before you raise."},
    {"name": "SAFE & term-sheet primer",
     "desc": "Plain-English guide to the terms that matter."},
]

# ── Corporate partners ─────────────────────────────────────────────────────
PARTNERS: list[dict] = [
    {"id": "pt1", "name": "Narayana Health", "sector": "Hospital network",
     "offer": "Clinical pilots and validation sites across neonatal and cardiac units."},
    {"id": "pt2", "name": "Bosch", "sector": "Industrial + mobility",
     "offer": "Co-development and access to manufacturing and reliability engineering."},
    {"id": "pt3", "name": "Tata Elxsi", "sector": "Design + engineering",
     "offer": "Product engineering and regulatory pathway support."},
    {"id": "pt4", "name": "Wipro GE Healthcare", "sector": "Medical devices",
     "offer": "Distribution and channel access into hospital procurement."},
]

# ── Book ARTPARK assets ─────────────────────────────────────────────────────
ASSETS: list[dict] = [
    {"id": "a1", "name": "NICU test bench (Class II)", "loc": "IISc CDS · Block A", "avail": "available"},
    {"id": "a2", "name": "Anechoic acoustic chamber", "loc": "IISc EE · Block C", "avail": "limited"},
    {"id": "a3", "name": "Environmental / thermal chamber", "loc": "ARTPARK Lab 2", "avail": "available"},
    {"id": "a4", "name": "PCB rework + SMT station", "loc": "ARTPARK Fab", "avail": "available"},
    {"id": "a5", "name": "High-speed oscilloscope (4 GHz)", "loc": "IISc EE · Block C", "avail": "limited"},
]

# ── Seed demo data (per plan: NOT auto-seeded per user; available for an
#    optional seed script to insert as founder_bookings / founder_tickets
#    rows). Store/fundraising/partners/assets reference data above is always
#    served from the constants — this is only demo content. ──────────────
SEED_BOOKINGS: list[dict] = [
    {"id": "bk1", "asset_id": "a1", "asset_name": "NICU test bench (Class II)",
     "date": "2026-07-18", "slot": "Morning (9–1)", "status": "confirmed"},
    {"id": "bk2", "asset_id": "a2", "asset_name": "Anechoic acoustic chamber",
     "date": "2026-07-22", "slot": "Afternoon (2–6)", "status": "pending"},
]

SEED_TICKETS: list[dict] = [
    {"ref": "IT-104", "area": "IT", "priority": "High",
     "subject": "GPU workstation access for training runs", "status": "in-progress"},
    {"ref": "FAC-061", "area": "Facilities", "priority": "Medium",
     "subject": "Lab bench power outlet dead in Bay 3", "status": "open"},
    {"ref": "IT-098", "area": "IT", "priority": "Low",
     "subject": "VPN certificate for remote data pull", "status": "resolved"},
]


def catalog_by_id(product_id: str) -> dict | None:
    return next((c for c in CATALOG if c["id"] == product_id), None)


def investor_by_id(investor_id: str) -> dict | None:
    return next((i for i in INVESTORS if i["id"] == investor_id), None)


def partner_by_id(partner_id: str) -> dict | None:
    return next((p for p in PARTNERS if p["id"] == partner_id), None)


def asset_by_id(asset_id: str) -> dict | None:
    return next((a for a in ASSETS if a["id"] == asset_id), None)
