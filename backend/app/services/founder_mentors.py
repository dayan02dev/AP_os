"""Reference data: the 3-person TIR mentor pod (Approach step 1 · Mentors,
and the Review-step "Reviewers" list). Transcribed verbatim from the design
source's `mentorsData` (TIR Onboarding.dc.html, renderVals()) — this is
static program copy, not per-application data, so it lives in code rather
than a table.

Field mapping vs. the mockup's `mentorsData` entries:
  reviewFocus -> review_focus, helps -> brings (everything else same name).
`id` is a stable slug (lowercase initials) added for the API surface — the
mockup doesn't need one since it renders mentors inline by array index.
"""
from __future__ import annotations

MENTORS: list[dict] = [
    {
        "id": "ak",
        "initials": "AK",
        "name": "Dr. Anitha Krishnan",
        "role": "Clinical Translation Lead · IISc CDS",
        "tags": ["Clinical validation", "Regulatory", "In-vivo trials"],
        "hours": "Tue",
        "review_focus": "Clinical + ethics",
        "brings": (
            "Study design, ethics approvals, and the hospital partnerships "
            "that make in-vivo validation possible."
        ),
        "bio": (
            "Ran three medical-device trials to CDSCO approval. She'll make "
            "sure your experiments answer the questions a regulator and a "
            "clinician actually ask."
        ),
    },
    {
        "id": "rm",
        "initials": "RM",
        "name": "Rahul Menon",
        "role": "Venture Partner · ARTPARK",
        "tags": ["Go-to-market", "Fundraising", "Deep-tech BD"],
        "hours": "Thu",
        "review_focus": "Commercial",
        "brings": (
            "Derisking the commercial assumptions — who pays, how much, "
            "and what a first pilot really needs to prove."
        ),
        "bio": (
            "Backed and built deep-tech companies across health and "
            "robotics. He pushes on the assumptions founders most want to "
            "avoid: willingness to pay and route to market."
        ),
    },
    {
        "id": "si",
        "initials": "SI",
        "name": "Prof. S. Iyer",
        "role": "Hardware Systems · IISc EE",
        "tags": ["Embedded", "Sensor fusion", "Manufacturing"],
        "hours": "Fri",
        "review_focus": "Hardware + scale",
        "brings": (
            "Bill-of-materials, reliability, and the path from a working "
            "bench unit to something you can actually manufacture."
        ),
        "bio": (
            "Two decades in embedded and sensor systems. He'll tell you "
            "early whether your on-device performance targets are physics "
            "or wishful thinking."
        ),
    },
]
