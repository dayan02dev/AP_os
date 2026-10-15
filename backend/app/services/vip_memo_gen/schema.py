"""MemoV2: the shared contract for VIP IC ("Navigator") memos.

An LLM writes this shape, the backend validates and stores it, and
``VipNavigatorMemo.jsx`` / ``vip_memo_v2_export.py`` render it. Every key those
two read is a field here. Leaf models keep unknown keys (``extra="allow"``) so
renderer-only extras survive; unknown top-level keys are dropped.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

SECTION_KEYS: tuple[str, ...] = (
    "what", "why", "product", "tech", "competitors", "market", "team", "milestones", "funds", "risks",
)
WHY_LABELS: tuple[str, ...] = (
    "Today", "Getting worse", "Why others can't", "Hard to copy", "Proof so far", "Plan B",
)

# Long text: a paragraph, or bullets where an item may itself be [lead, *sub-points].
Bullets = str | list[str | list[str]]
Num = int | float
Cell = Bullets
# Table rows are positional arrays (the renderers index them).
Row = list[Cell]
HolderOrFundRow = list[str | int | float | bool | list[str | list[str]]]

Verdict = Literal["APPROVE", "CONDITIONAL APPROVAL", "REQUEST MORE INFORMATION"]


class MemoValidationError(ValueError):
    """Memo failed validation; ``messages`` is a short human-readable list."""

    def __init__(self, messages: list[str]):
        self.messages = messages
        super().__init__("; ".join(messages))


class _Leaf(BaseModel):
    model_config = ConfigDict(extra="allow")


def _as_list(v: Any) -> Any:
    """Normalise a bullets field that drifted to a bare string."""
    if v is None or v == "":
        return []
    return [v] if isinstance(v, str) else v


class SnapItem(_Leaf):
    value: str
    note: str = ""


class Snapshot(_Leaf):
    ask: SnapItem
    instrument: SnapItem
    sector: SnapItem
    stage: SnapItem
    location: SnapItem
    team: SnapItem
    ic_date: str = "[To be confirmed]"


class What(_Leaf):
    paragraphs: list[str]
    analogy: Bullets = ""
    in_short: Bullets = ""


class Why(_Leaf):
    rows: list[Row]

    @field_validator("rows")
    @classmethod
    def _known_labels(cls, rows: list[Row]) -> list[Row]:
        for i, r in enumerate(rows):
            if len(r) != 2:
                raise ValueError(f"row {i} must be [label, text]")
            if r[0] not in WHY_LABELS:
                raise ValueError(f"row {i} label {r[0]!r} not one of {list(WHY_LABELS)}")
        return rows


class Product(_Leaf):
    kind: str = ""
    columns: list[str] = []
    offers: list[Row]
    note: Bullets = ""


class Tech(_Leaf):
    rows: list[Row]


class CompetitorGroup(_Leaf):
    segment: str
    rows: list[Row]  # [name, what they do, key limitation, our advantage, stage]


class Competitors(_Leaf):
    groups: list[CompetitorGroup]
    note: Bullets = ""


class MarketRow(_Leaf):
    segment: str
    global_size: str = ""
    slice_low_cr: Num
    slice_high_cr: Num
    slice_label: str
    rationale: Bullets = ""
    source: str = ""


class Market(_Leaf):
    rows: list[MarketRow]
    total: str
    beachhead: Bullets = ""
    tam_note: Bullets = ""


class Member(_Leaf):
    name: str
    role: str = ""
    background: Bullets = ""


class Team(_Leaf):
    members: list[Member]
    holders: list[HolderOrFundRow] = []  # [holder, type, equity %, is_founder]
    notes: Bullets = ""
    confirm: list[str] = []


class Milestones(_Leaf):
    rows: list[Row]  # [when, milestone, target]
    infra: list[str | list[str]] = []
    note: Bullets = ""

    @field_validator("infra", mode="before")
    @classmethod
    def _infra_as_list(cls, v: Any) -> Any:
        return _as_list(v)


class Funds(_Leaf):
    rows: list[HolderOrFundRow]  # [category, key items, percent, amount]
    total: str
    note: Bullets = ""


class RiskCard(_Leaf):
    title: str
    risk: Bullets
    handled: Bullets


class Risks(_Leaf):
    rows: list[RiskCard]

    @field_validator("rows", mode="before")
    @classmethod
    def _legacy_pairs(cls, rows: Any) -> Any:
        """Older memos used [risk, mitigant]; lift them to cards."""
        if not isinstance(rows, list):
            return rows
        out = []
        for r in rows:
            if isinstance(r, list) and len(r) == 2:
                lead = r[0]
                first = lead[0] if isinstance(lead, list) and lead else lead
                if not isinstance(first, str):
                    out.append(r)  # malformed: let RiskCard validation report it
                    continue
                title = first if len(first) <= 60 else first[:57].rstrip() + "..."
                r = {"title": title, "risk": r[0], "handled": r[1]}
            out.append(r)
        return out


class Sections(_Leaf):
    what: What
    why: Why
    product: Product
    tech: Tech
    competitors: Competitors
    market: Market
    team: Team
    milestones: Milestones
    funds: Funds
    risks: Risks


class PerSection(_Leaf):
    what: str
    why: str
    product: str
    tech: str
    competitors: str
    market: str
    team: str
    milestones: str
    funds: str
    risks: str


class Recommendation(_Leaf):
    verdict: Verdict
    summary: Bullets
    conditions: list[str] = []


class MemoV2(BaseModel):
    model_config = ConfigDict(extra="ignore")  # unknown top-level keys are dropped

    version: int = 2
    generated_at: str
    prepared_by: str
    source_files: list[str] = []
    name: str
    headline: str = ""
    plain: Bullets = ""
    in_short: str = ""
    snapshot: Snapshot
    figures: list[Any] = []
    know: list[Any] = []
    check: list[Any] = []
    takeaways: PerSection
    sources: PerSection
    sections: Sections
    recommendation: Recommendation | None = None
    questions: list[str] = []

    @field_validator("version", mode="before")
    @classmethod
    def _version_two(cls, v: Any) -> int:
        if isinstance(v, bool) or v not in (2, "2"):
            raise ValueError("version must be 2")
        return 2

    @field_validator("name")
    @classmethod
    def _name_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v


def _fmt(err: dict) -> str:
    loc = ".".join(str(p) for p in err["loc"])
    return f"{loc}: {err['msg']}"


def parse_memo(data: dict) -> MemoV2:
    try:
        return MemoV2.model_validate(data)
    except ValidationError as e:
        raise MemoValidationError([_fmt(x) for x in e.errors()]) from e


def memo_to_dict(m: MemoV2) -> dict:
    """The normalised JSON that is served and stored."""
    return m.model_dump(mode="json", exclude_none=True)


# --- salvage ---------------------------------------------------------------------------------
# Applied to every model output before ``parse_memo``: fills, coerces and drops so that any
# recognisable memo parses. Notes name paths only, never values (they reach logs and the DB).

TBC = "[To be confirmed]"
MAX_MISSING_SECTIONS = 5
_VERDICTS: tuple[str, ...] = ("APPROVE", "CONDITIONAL APPROVAL", "REQUEST MORE INFORMATION")
_SNAP_KEYS = ("ask", "instrument", "sector", "stage", "location", "team")
# A section that arrived as a bare list is taken to be its main list.
_SECTION_LIST_KEY = {
    "what": "paragraphs", "why": "rows", "product": "offers", "tech": "rows", "competitors": "groups",
    "market": "rows", "team": "members", "milestones": "rows", "funds": "rows", "risks": "rows",
}


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


_WHY_BY_NORM = {_norm(lab): lab for lab in WHY_LABELS}


class _Salvager:
    def __init__(self) -> None:
        self.notes: list[str] = []

    def note(self, path: str, what: str) -> None:
        self.notes.append(f"{path}: {what}")

    # scalars -------------------------------------------------------------------------------
    def flat(self, v: Any) -> str | None:
        """Any scalar or nested list as one string; None for things that carry no text."""
        if isinstance(v, str):
            return v
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, int | float):
            return str(v)
        if isinstance(v, list):
            parts = [p for p in (self.flat(x) for x in v) if p]
            return " ".join(parts)
        return None

    def text(self, v: Any, path: str, default: str = TBC) -> str:
        if isinstance(v, str):
            return v
        out = self.flat(v) if v is not None else None
        if out is None:
            self.note(path, "missing; filled" if v is None else "not text; filled")
            return default
        self.note(path, "coerced to text")
        return out

    def opt_text(self, v: Any, path: str) -> str:
        """Optional text (model default ""): absence is not worth a note."""
        return "" if v is None else self.text(v, path, "")

    def num(self, v: Any, path: str) -> int | float:
        if isinstance(v, int | float) and not isinstance(v, bool):
            return v
        if isinstance(v, str):
            try:
                return float(v.replace(",", "").strip())
            except ValueError:
                pass
        self.note(path, "missing; set to 0" if v is None else "not a number; set to 0")
        return 0

    # bullets ------------------------------------------------------------------------------
    def bullets(self, v: Any, path: str, default: Any = "") -> Any:
        """str | list[str | list[str]]; deeper nesting is flattened, non-text items dropped."""
        if v is None:
            return default
        if isinstance(v, str):
            return v
        if not isinstance(v, list):
            out = self.flat(v)
            self.note(path, "coerced to text" if out is not None else "not text; cleared")
            return out if out is not None else default
        items: list[Any] = []
        changed = False
        for x in v:
            if isinstance(x, str):
                items.append(x)
            elif isinstance(x, list):
                sub = [s for s in (self.flat(y) for y in x) if s]
                changed |= len(sub) != len(x) or any(not isinstance(y, str) for y in x)
                if sub:
                    items.append(sub)
            else:
                s = self.flat(x)
                changed = True
                if s:
                    items.append(s)
        if changed:
            self.note(path, "bullet items coerced")
        return items

    def str_list(self, v: Any, path: str) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            self.note(path, "text wrapped in a list")
            return [v] if v.strip() else []
        if not isinstance(v, list):
            self.note(path, "not a list; cleared")
            return []
        out = [s for s in (self.flat(x) for x in v) if s]
        if len(out) != len(v) or any(not isinstance(x, str) for x in v):
            self.note(path, "list items coerced")
        return out

    def any_list(self, v: Any, path: str) -> list:
        if v is None:
            return []
        if isinstance(v, list):
            return v
        self.note(path, "not a list; wrapped")
        return [v]

    # rows ---------------------------------------------------------------------------------
    def row(self, v: Any, path: str, scalars: bool = False) -> list | None:
        """A positional table row; ``scalars`` keeps numbers/bools (holder and fund rows)."""
        if isinstance(v, dict):
            v = list(v.values())
            self.note(path, "object row converted to a list")
        elif isinstance(v, str):
            v = [v]
            self.note(path, "text row wrapped")
        elif not isinstance(v, list):
            self.note(path, "not a row; dropped")
            return None
        out: list[Any] = []
        for j, c in enumerate(v):
            if scalars and isinstance(c, str | int | float | bool):
                out.append(c)
            elif c is None:
                out.append("")
            else:
                out.append(self.bullets(c, f"{path}[{j}]"))
        return out

    def rows(self, v: Any, path: str, scalars: bool = False) -> list[list]:
        if v is None:
            self.note(path, "missing; empty")
            return []
        if not isinstance(v, list):
            self.note(path, "not a list; emptied")
            return []
        out = []
        for i, r in enumerate(v):
            fixed = self.row(r, f"{path}[{i}]", scalars)
            if fixed is not None:
                out.append(fixed)
        return out

    def objs(self, v: Any, path: str) -> list[tuple[str, Any]]:
        """(path, item) for a list of objects; a missing or non-list value is noted and empty."""
        if v is None:
            self.note(path, "missing; empty")
            return []
        if not isinstance(v, list):
            self.note(path, "not a list; emptied")
            return []
        return [(f"{path}[{i}]", x) for i, x in enumerate(v)]

    # sections -----------------------------------------------------------------------------
    def what(self, s: dict, p: str) -> dict:
        paras = s.get("paragraphs")
        if isinstance(paras, list):
            fixed = [t for t in (self.flat(x) for x in paras) if t]
            if len(fixed) != len(paras) or any(not isinstance(x, str) for x in paras):
                self.note(f"{p}.paragraphs", "items coerced")
        else:
            fixed = self.str_list(paras, f"{p}.paragraphs") if paras is not None else []
            if paras is None:
                self.note(f"{p}.paragraphs", "missing; empty")
        s["paragraphs"] = fixed
        s["analogy"] = self.bullets(s.get("analogy"), f"{p}.analogy")
        s["in_short"] = self.bullets(s.get("in_short"), f"{p}.in_short")
        return s

    def why(self, s: dict, p: str) -> dict:
        raw = s.get("rows")
        out = []
        for rp, r in self.objs(raw, f"{p}.rows"):
            if isinstance(r, dict):
                r = [r.get("label"), r.get("text", r.get("value"))]
            if not isinstance(r, list) or len(r) < 2 or not isinstance(r[0], str):
                self.note(rp, "not a [label, text] row; dropped")
                continue
            label = r[0] if r[0] in WHY_LABELS else _WHY_BY_NORM.get(_norm(r[0]))
            if label is None:
                self.note(rp, "unknown label; dropped")
                continue
            if label != r[0]:
                self.note(f"{rp}[0]", "label normalised")
            body = r[1] if len(r) == 2 else r[1:]
            out.append([label, self.bullets(body, f"{rp}[1]")])
        s["rows"] = out
        return s

    def product(self, s: dict, p: str) -> dict:
        s["kind"] = self.opt_text(s.get("kind"), f"{p}.kind")
        s["columns"] = self.str_list(s.get("columns"), f"{p}.columns")
        s["offers"] = self.rows(s.get("offers"), f"{p}.offers")
        s["note"] = self.bullets(s.get("note"), f"{p}.note")
        return s

    def tech(self, s: dict, p: str) -> dict:
        s["rows"] = self.rows(s.get("rows"), f"{p}.rows")
        return s

    def competitors(self, s: dict, p: str) -> dict:
        groups = []
        for gp, g in self.objs(s.get("groups"), f"{p}.groups"):
            if isinstance(g, list):
                g = {"rows": g}
            if not isinstance(g, dict):
                self.note(gp, "not a group; dropped")
                continue
            g["segment"] = self.text(g.get("segment"), f"{gp}.segment")
            g["rows"] = self.rows(g.get("rows"), f"{gp}.rows")
            groups.append(g)
        s["groups"] = groups
        s["note"] = self.bullets(s.get("note"), f"{p}.note")
        return s

    def market(self, s: dict, p: str) -> dict:
        rows = []
        for rp, r in self.objs(s.get("rows"), f"{p}.rows"):
            if not isinstance(r, dict):
                self.note(rp, "not a market row; dropped")
                continue
            r["segment"] = self.text(r.get("segment"), f"{rp}.segment")
            r["global_size"] = self.opt_text(r.get("global_size"), f"{rp}.global_size")
            r["slice_low_cr"] = self.num(r.get("slice_low_cr"), f"{rp}.slice_low_cr")
            r["slice_high_cr"] = self.num(r.get("slice_high_cr"), f"{rp}.slice_high_cr")
            r["slice_label"] = self.text(r.get("slice_label"), f"{rp}.slice_label")
            r["rationale"] = self.bullets(r.get("rationale"), f"{rp}.rationale")
            r["source"] = self.opt_text(r.get("source"), f"{rp}.source")
            rows.append(r)
        s["rows"] = rows
        s["total"] = self.text(s.get("total"), f"{p}.total")
        s["beachhead"] = self.bullets(s.get("beachhead"), f"{p}.beachhead")
        s["tam_note"] = self.bullets(s.get("tam_note"), f"{p}.tam_note")
        return s

    def team(self, s: dict, p: str) -> dict:
        members = []
        for mp, m in self.objs(s.get("members"), f"{p}.members"):
            if isinstance(m, str):
                self.note(mp, "text member wrapped")
                m = {"name": m}
            if not isinstance(m, dict):
                self.note(mp, "not a member; dropped")
                continue
            m["name"] = self.text(m.get("name"), f"{mp}.name")
            m["role"] = self.opt_text(m.get("role"), f"{mp}.role")
            m["background"] = self.bullets(m.get("background"), f"{mp}.background")
            members.append(m)
        s["members"] = members
        s["holders"] = self.rows(s.get("holders"), f"{p}.holders", scalars=True) \
            if s.get("holders") is not None else []
        s["notes"] = self.bullets(s.get("notes"), f"{p}.notes")
        s["confirm"] = self.str_list(s.get("confirm"), f"{p}.confirm")
        return s

    def milestones(self, s: dict, p: str) -> dict:
        s["rows"] = self.rows(s.get("rows"), f"{p}.rows")
        infra = self.bullets(s.get("infra"), f"{p}.infra", default=[])
        s["infra"] = [infra] if isinstance(infra, str) and infra else (infra or [])
        s["note"] = self.bullets(s.get("note"), f"{p}.note")
        return s

    def funds(self, s: dict, p: str) -> dict:
        s["rows"] = self.rows(s.get("rows"), f"{p}.rows", scalars=True)
        s["total"] = self.text(s.get("total"), f"{p}.total")
        s["note"] = self.bullets(s.get("note"), f"{p}.note")
        return s

    def risks(self, s: dict, p: str) -> dict:
        cards = []
        for rp, r in self.objs(s.get("rows"), f"{p}.rows"):
            if isinstance(r, str):
                self.note(rp, "text risk wrapped")
                r = {"risk": r}
            elif isinstance(r, list):
                if not r:
                    self.note(rp, "empty row; dropped")
                    continue
                legacy = len(r) == 2  # the documented legacy shape: lifted silently, like Risks
                if not legacy:
                    self.note(rp, "row lifted to a card")
                r = {"risk": r[0], "handled": r[1] if legacy else r[1:] or None, "_legacy": legacy}
            if not isinstance(r, dict):
                self.note(rp, "not a risk; dropped")
                continue
            r["risk"] = self.bullets(r.get("risk"), f"{rp}.risk", default=TBC)
            r["handled"] = self.bullets(r.get("handled"), f"{rp}.handled", default=TBC)
            legacy = r.pop("_legacy", False)
            title = r.get("title")
            if title is None or (isinstance(title, str) and not title.strip()):
                lead = self.flat(r["risk"][0] if isinstance(r["risk"], list) and r["risk"] else r["risk"])
                lead = (lead or TBC).strip() or TBC
                r["title"] = lead if len(lead) <= 60 else lead[:57].rstrip() + "..."
                if not legacy:
                    self.note(f"{rp}.title", "missing; derived")
            else:
                r["title"] = self.text(title, f"{rp}.title")
            cards.append(r)
        s["rows"] = cards
        return s

    # top level ----------------------------------------------------------------------------
    def per_section(self, v: Any, path: str) -> dict:
        if not isinstance(v, dict):
            self.note(path, "missing; filled" if v is None else "not an object; filled")
            v = {}
        out = dict(v)
        for k in SECTION_KEYS:
            if k not in v or v[k] is None:
                self.note(f"{path}.{k}", "missing; filled")
                out[k] = TBC
            else:
                out[k] = self.text(v[k], f"{path}.{k}")
        return out

    def snapshot(self, v: Any) -> dict:
        if not isinstance(v, dict):
            self.note("snapshot", "missing; filled" if v is None else "not an object; filled")
            v = {}
        out = dict(v)
        for k in _SNAP_KEYS:
            item = v.get(k)
            if isinstance(item, dict):
                item = dict(item)
                item["value"] = self.text(item.get("value"), f"snapshot.{k}.value")
                item["note"] = self.opt_text(item.get("note"), f"snapshot.{k}.note")
            elif item is None:
                self.note(f"snapshot.{k}", "missing; filled")
                item = {"value": TBC, "note": ""}
            else:
                item = {"value": self.text(item, f"snapshot.{k}"), "note": ""}
            out[k] = item
        out["ic_date"] = self.text(v.get("ic_date", TBC), "snapshot.ic_date")
        return out

    def recommendation(self, v: Any) -> dict | None:
        if v is None:
            return None
        if not isinstance(v, dict):
            self.note("recommendation", "not an object; dropped")
            return None
        verdict = v.get("verdict")
        mapped = next((x for x in _VERDICTS if isinstance(verdict, str) and _norm(verdict) == _norm(x)), None)
        if mapped is None:
            self.note("recommendation.verdict", "unknown verdict; recommendation dropped")
            return None
        out = dict(v)
        out["verdict"] = mapped
        out["summary"] = self.bullets(v.get("summary"), "recommendation.summary", default=TBC)
        out["conditions"] = self.str_list(v.get("conditions"), "recommendation.conditions")
        return out

    def sections(self, data: dict) -> dict:
        secs = data.get("sections")
        if secs is None and any(k in data for k in SECTION_KEYS):
            self.note("sections", "sections found at the top level; lifted")
            secs = {k: data[k] for k in SECTION_KEYS if k in data}
        if not isinstance(secs, dict):
            secs = {}
        missing = [k for k in SECTION_KEYS if not isinstance(secs.get(k), dict | list | str)]
        if len(missing) > MAX_MISSING_SECTIONS:
            raise MemoValidationError(
                [f"sections: {len(missing)} of {len(SECTION_KEYS)} sections missing; not a memo"])
        out = dict(secs)
        for k in SECTION_KEYS:
            path = f"sections.{k}"
            s = secs.get(k)
            if k in missing:
                self.note(path, "missing; filled with an empty section")
                s = {}
            elif isinstance(s, list):
                self.note(path, f"list taken as {_SECTION_LIST_KEY[k]}")
                s = {_SECTION_LIST_KEY[k]: s}
            elif isinstance(s, str):
                self.note(path, "text section; wrapped")
                s = {"paragraphs": [s]} if k == "what" else {"note": s}
            else:
                s = dict(s)
            out[k] = getattr(self, k)(s, path)
        return out

    def run(self, data: Any) -> dict:
        if not isinstance(data, dict):
            raise MemoValidationError(["response is not a JSON object"])
        d = dict(data)
        name = d.get("name")
        name = self.flat(name) if name is not None and not isinstance(name, dict) else None
        if not name or not name.strip():
            raise MemoValidationError(["name: missing or empty; not a memo"])
        if not isinstance(d.get("name"), str):
            self.note("name", "coerced to text")
        d["name"] = name
        d["sections"] = self.sections(d)
        d["generated_at"] = self.opt_text(d.get("generated_at"), "generated_at")
        d["prepared_by"] = self.opt_text(d.get("prepared_by"), "prepared_by")
        d["headline"] = self.opt_text(d.get("headline"), "headline")
        d["in_short"] = self.opt_text(d.get("in_short"), "in_short")
        d["plain"] = self.bullets(d.get("plain"), "plain")
        d["source_files"] = self.str_list(d.get("source_files"), "source_files")
        d["questions"] = self.str_list(d.get("questions"), "questions")
        for k in ("figures", "know", "check"):
            d[k] = self.any_list(d.get(k), k)
        d["snapshot"] = self.snapshot(d.get("snapshot"))
        d["takeaways"] = self.per_section(d.get("takeaways"), "takeaways")
        d["sources"] = self.per_section(d.get("sources"), "sources")
        rec = self.recommendation(d.get("recommendation"))
        if rec is None:
            d.pop("recommendation", None)
        else:
            d["recommendation"] = rec
        return d


def salvage(data: dict) -> tuple[dict, list[str]]:
    """Make a recognisable memo parse: (fixed copy, notes naming the changed paths).

    Hard failures (``MemoValidationError``): not a JSON object, ``name`` missing/empty, or more
    than ``MAX_MISSING_SECTIONS`` of the ten sections entirely missing.
    """
    import copy

    s = _Salvager()
    out = s.run(copy.deepcopy(data) if isinstance(data, dict) else data)
    return out, s.notes


def _inline_refs(node: Any, defs: dict) -> Any:
    if isinstance(node, dict):
        if "$ref" in node:
            return _inline_refs(defs[node["$ref"].rsplit("/", 1)[-1]], defs)
        return {k: _inline_refs(v, defs) for k, v in node.items() if k != "$defs"}
    if isinstance(node, list):
        return [_inline_refs(v, defs) for v in node]
    return node


def writer_json_schema() -> dict:
    """Plain, $ref-free JSON Schema of MemoV2 for structured-output ``response_format``."""
    s = MemoV2.model_json_schema()
    return _inline_refs(s, s.get("$defs", {}))
