"""Request bodies for /founder/mis.

Validation here is deliberately shallow — type and range only. Catalog
membership (an unknown metric_key/series/bucket/category, or an entries-row
key `mis_catalog.entry_fields(section)` does not list) is checked in the
router against `mis_catalog`, the single source of truth for what is valid;
duplicating that set here as a second, hand-maintained copy is exactly the
kind of drift this repo's `rbac.py` ↔ `rbac.js` pair already warns about.

Narrative bodies (`dict[str, str | None]`) and entries-row bodies
(`list[dict[str, Any]]`) are accepted as plain JSON shapes directly in the
router rather than modelled here at all: their valid key set depends on
`kind`/`section`, which a static pydantic model has no way to express —
the same reason `LeverAnswersIn` (models/air.py) defers option validation
to its router instead of encoding it in the model.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

_TEXT = 300
_LONG = 2000


class MetricIn(BaseModel):
    """One row of the monthly §2 Key Metrics grid. `metric_key` selects
    which pre-seeded `vip_mis_metrics` row this upserts into — the row
    itself is never created fresh by a founder (constraint: every catalog
    metric is seeded blank by `mis_query.ensure_periods`/`period_bundle`
    before any founder ever reaches this endpoint). `actual` is rejected in
    the router when `metric_key == "trl_level"` — that row is server-set,
    never founder-typed.
    """
    metric_key: str = Field(min_length=1, max_length=100)
    target: float | None = None
    actual: float | None = None
    rag: str | None = Field(default=None, max_length=10)
    commentary: str | None = Field(default=None, max_length=_LONG)


class FinancialAmountIn(BaseModel):
    """One (series, bucket) cell of the quarterly §6 financial grids.
    `series`/`bucket` are validated against `mis_catalog.FINANCIAL_SERIES`/
    the period's own fiscal-year-relative buckets in the router — bucket
    validity for the annual_revenue series depends on the period's fiscal
    year, which this model has no access to."""
    series: str = Field(min_length=1, max_length=100)
    bucket: str = Field(min_length=1, max_length=100)
    amount: float | None = None


class HeadcountRowIn(BaseModel):
    """One category row of the quarterly §8 People grid. `net_change` is
    intentionally absent — it is derived on read (`mis_query._net_change`),
    never stored, so there is no column for a client to write."""
    category: str = Field(min_length=1, max_length=100)
    current_count: int | None = Field(default=None, ge=0)
    exited: int | None = Field(default=None, ge=0)
    remarks: str | None = Field(default=None, max_length=_LONG)
