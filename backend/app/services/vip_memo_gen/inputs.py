"""Build the model input for a VIP application: wizard text block + file refs."""
from __future__ import annotations

import logging
import mimetypes
from dataclasses import dataclass

from app.services import applications_query as aq
from app.services.ai_pipeline.serialize import build_app_text

log = logging.getLogger(__name__)

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_TEMPLATE_BUCKET = "sip-application-templates"

# source field -> FileRef.kind
_FIELD_KIND = {
    "sip_pitch_deck": "deck",
    "sip_cap_table_file": "cap_table",
    "sip_traction_files": "traction",
    "execution_milestone_files": "milestones",
    "sip_patents_files": "patents",
}


@dataclass
class FileRef:
    bucket: str
    path: str
    filename: str
    mime: str
    kind: str  # deck, template, traction, milestones, cap_table, patents, cv


@dataclass
class InputRecord:
    kind: str
    bucket: str | None
    path: str | None
    mime: str | None
    method: str
    chars_used: int
    truncated: bool
    skipped_reason: str | None


_PII_KEYS = {"basic_email", "basic_phone", "basic_name", "basic_full_name"}

# VIP wizard fields the shared serializer does not emit.
_EXTRA = [
    ("Failure mode", "execution_failure"),
    ("Demo video", "sip_demo_video_url"),
    ("DPIIT recognition number", "basic_dpiit_recognition_number"),
    ("Incubator association", "basic_incubator_association"),
]


def _is_pii_key(key: str) -> bool:
    return key in _PII_KEYS or key.endswith("_email") or key.endswith("_phone")


# Form values that mean "not filled in" (front-end serialisation leaks them).
_PLACEHOLDERS = {"null", "undefined", "none", "n/a", "na", "nil", "-", "--", "nan"}


def _missing(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return v.strip().lower() in _PLACEHOLDERS or not v.strip()
    return False


def _clean(v):
    """Drop placeholder strings from a field value (top level, lists, dict entries)."""
    if isinstance(v, list):
        items = [_clean(x) for x in v if not _missing(x)]
        return [x for x in items if x not in ({}, [])]
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items() if not _missing(x)}
    return v


def _known(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def _pick(entries, keys):
    out = []
    for e in entries if isinstance(entries, list) else []:
        if isinstance(e, dict):
            item = {k: e[k] for k in keys if e.get(k) not in (None, "")}
            if item:
                out.append(item)
    return out


def build_application_block(app_row: dict, track: str) -> str:
    app_row = {k: _clean(v) for k, v in app_row.items() if not _missing(v)}
    row = {k: v for k, v in app_row.items() if not _is_pii_key(k)}
    mates = app_row.get("basic_teammates")
    if mates:
        row["basic_teammates"] = [
            _known({"name": m.get("name") or m.get("fullName"), "role": m.get("role")})
            for m in mates if isinstance(m, dict) and (m.get("name") or m.get("fullName"))
        ]
    if app_row.get("sip_founders"):
        row["sip_founders"] = [
            _known({"name": f.get("name"), "share": f.get("share", f.get("percent"))})
            for f in app_row["sip_founders"]
            if isinstance(f, dict) and f.get("name")
        ]
    text = build_app_text(row, track)
    if text == "No application details provided.":
        text = ""
    extras = []
    for label, col in _EXTRA:
        v = row.get(col)
        if v not in (None, "", [], {}):
            extras.append(f"{label}: {v}")
    out = "\n\n".join([p for p in [text, *extras] if p])
    return out or "No application details provided."


def _guess_mime(obj_mime, filename: str) -> str:
    return obj_mime or mimetypes.guess_type(filename or "")[0] or "application/octet-stream"


def _add_obj(refs: list[FileRef], seen: set, obj, bucket: str, kind: str) -> None:
    path = aq._path_of(obj)
    if not path or path in seen:
        return
    seen.add(path)
    name = obj.get("original_filename") or obj.get("filename") or obj.get("name") or path.rsplit("/", 1)[-1]
    refs.append(FileRef(bucket, path, name, _guess_mime(obj.get("mime_type") or obj.get("mime"), name), kind))


def collect_files(client, app_row: dict, track: str) -> list[FileRef]:
    refs: list[FileRef] = []
    seen: set[str] = set()
    buckets = aq.collect_application_file_paths(track, app_row)
    for field, kind in _FIELD_KIND.items():
        value = app_row.get(field)
        for obj in (value if isinstance(value, list) else [value]):
            path = aq._path_of(obj)
            if path and path in buckets:
                _add_obj(refs, seen, obj, buckets[path], kind)

    resume = aq.resolve_resume_file(track, app_row)
    if resume:
        _add_obj(refs, seen, {**resume, "path": resume["storage_path"]}, resume["bucket"], "cv")

    user_id = app_row.get("user_id")
    if user_id:
        try:
            res = (
                client.table("sip_application_templates")
                .select("storage_path, original_filename, mime_type, created_at")
                .eq("user_id", str(user_id))
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = res.data or []
        except Exception:
            log.warning("collect_files: template lookup failed", extra={"track": track}, exc_info=True)
            rows = []
        if rows and rows[0].get("storage_path"):
            r = rows[0]
            _add_obj(refs, seen, {"path": r["storage_path"], "original_filename": r.get("original_filename"),
                                  "mime_type": r.get("mime_type")}, _TEMPLATE_BUCKET, "template")
    return refs
