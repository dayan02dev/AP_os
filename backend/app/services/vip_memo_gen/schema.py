"""MemoV2: the shared contract for VIP IC ("Navigator") memos.

An LLM writes this shape, the backend validates and stores it, and
``VipNavigatorMemo.jsx`` / ``vip_memo_v2_export.py`` render it. Every key those
two read is a field here. Leaf models keep unknown keys (``extra="allow"``) so
renderer-only extras survive; the top level is strict.
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
    model_config = ConfigDict(extra="forbid")

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
