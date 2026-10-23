"""The two verification tags that replace the old "[To be confirmed]" placeholder.

FOUNDER: a fact only the startup can supply (ask, funds, cap table, team, pricing, traction).
VERIFY: an outside fact to be cross-checked against third-party sources (market, competitors).
The tag is chosen by where the placeholder sits in the memo.
"""
from __future__ import annotations

from typing import Any

LEGACY = "[To be confirmed]"
FOUNDER = "[Needs founder verification]"
VERIFY = "[Needs AI cross-verification]"
TAGS = (FOUNDER, VERIFY)

_VERIFY_SECTIONS = {"market", "competitors"}
_WHY_VERIFY_LABEL = "Why others can't"


def tag_for(path: tuple) -> str:
    """Tag for a placeholder at ``path`` (keys / indexes from the memo root)."""
    if len(path) >= 2 and path[0] == "sections" and path[1] in _VERIFY_SECTIONS:
        return VERIFY
    if len(path) >= 2 and path[0] in ("takeaways", "sources") and path[1] in _VERIFY_SECTIONS:
        return VERIFY
    return FOUNDER


def retag(memo: Any) -> tuple[Any, int]:
    """A copy of ``memo`` with every LEGACY placeholder replaced by its tag, and the count."""
    count = 0

    def walk(node: Any, path: tuple, tag: str | None) -> Any:
        nonlocal count
        if isinstance(node, str):
            if LEGACY not in node:
                return node
            count += node.count(LEGACY)
            return node.replace(LEGACY, tag or tag_for(path))
        if isinstance(node, dict):
            return {k: walk(v, path + (k,), tag) for k, v in node.items()}
        if isinstance(node, list):
            # A why row ["Why others can't", text] is about competitors: VERIFY throughout.
            if (path[:3] == ("sections", "why", "rows") and len(path) == 4
                    and node and node[0] == _WHY_VERIFY_LABEL):
                tag = VERIFY
            return [walk(v, path + (i,), tag) for i, v in enumerate(node)]
        return node

    return walk(memo, (), None), count
