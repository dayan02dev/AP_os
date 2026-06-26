"""Pure grouping/summary for the daily digest. Reviews are pre-filtered to the window."""
from __future__ import annotations

from .assignment_email import track_label
from .reviewer_query import _weighted_overall


def summarize_reviews(reviews: list[dict], name_by_uid: dict[str, str]) -> list[dict]:
    """Group submitted reviews by reviewer; return [{reviewer_user_id, reviewer_name,
    count, items:[{application_id_short, track_label, recommendation, overall}]}] sorted
    by count desc."""
    groups: dict[str, list[dict]] = {}
    for r in reviews:
        groups.setdefault(r["reviewer_user_id"], []).append(r)
    out = []
    for uid, rs in groups.items():
        items = [
            {
                "application_id_short": (r.get("application_id") or "")[:8],
                "track_label": track_label(r.get("application_track")),
                "recommendation": r.get("recommendation") or "—",
                "overall": _weighted_overall(r),
            }
            for r in sorted(rs, key=lambda x: x.get("submitted_at") or "")
        ]
        out.append({
            "reviewer_user_id": uid,
            "reviewer_name": name_by_uid.get(uid) or uid[:8],
            "count": len(items),
            "items": items,
        })
    out.sort(key=lambda g: g["count"], reverse=True)
    return out
