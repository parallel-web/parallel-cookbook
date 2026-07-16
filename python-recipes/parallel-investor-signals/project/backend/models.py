"""
Pydantic request models + shared type aliases for the enrichment backend.

The RESPONSE shape (ResearchBrief) is produced as plain dicts by
`parallel_client.to_research_brief` so the JSON the frontend receives matches
the agreed TypeScript contract byte-for-byte. Keeping response construction as
dicts (rather than nested Pydantic models) avoids any serialization surprises
and keeps the normalization logic in one obvious place.

Only the *inputs* are validated with Pydantic here — FastAPI turns validation
failures into clean 422 responses automatically.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# Depth toggle exposed to the UI. Maps to a processor tier in parallel_client.
Depth = Literal["fast", "deep"]

# Confidence values the contract allows on every Field<T>. "inferred" is used
# ONLY for pattern-derived data (e.g. an email guessed from name + domain) that
# has no web citation and must never be presented as verified.
Confidence = Literal["high", "medium", "low", "inferred"]

# --- Custom research fields (ask-bar questions / bulk custom columns) --------
# Every answer comes back as a cited string; the schema is fixed and generic
# (see parallel_client._CUSTOM_SCHEMA), so a field def is just a question.
_MAX_CUSTOM_FIELDS = 8
_MAX_LABEL_LEN = 60
_MAX_QUESTION_LEN = 300


def _slugify(label: str) -> str:
    """Label -> schema/CSV/React-safe key. Not schema-load-bearing (the custom
    schema is fixed), so this only needs to be stable and unique per request."""
    s = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    s = re.sub(r"_+", "_", s)
    if not s:
        s = "field"
    if not s[0].isalpha():
        s = f"f_{s}"
    return s[:40]


class CustomFieldDef(BaseModel):
    """One ad-hoc research question. `key` is server-derived (client value is
    ignored) so identity/CSV headers/React keys stay stable and unique."""

    label: str = Field(min_length=1, max_length=_MAX_LABEL_LEN)
    question: str = Field(min_length=1, max_length=_MAX_QUESTION_LEN)
    key: str = ""

    @field_validator("label", "question")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v


def _assign_custom_keys(fields: list[CustomFieldDef]) -> list[CustomFieldDef]:
    """Derive a unique slug key per field (dedupe with _2, _3, ...)."""
    seen: dict[str, int] = {}
    for f in fields:
        base = _slugify(f.label)
        if base in seen:
            seen[base] += 1
            f.key = f"{base}_{seen[base]}"
        else:
            seen[base] = 1
            f.key = base
    return fields


class EnrichRequest(BaseModel):
    """Body for POST /api/enrich — a single company lookup."""

    query: str = Field(min_length=1, max_length=200)
    depth: Depth = "fast"
    custom_fields: list[CustomFieldDef] = Field(default_factory=list, max_length=_MAX_CUSTOM_FIELDS)

    @field_validator("query")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("query must not be empty")
        return v

    @model_validator(mode="after")
    def _key_custom_fields(self) -> EnrichRequest:
        _assign_custom_keys(self.custom_fields)
        return self


class BulkRow(BaseModel):
    """One row of a bulk enrichment request."""

    company: str = Field(min_length=1, max_length=200)

    @field_validator("company")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company must not be empty")
        return v


class BulkRequest(BaseModel):
    """Body for POST /api/enrich/bulk — a list of companies to enrich. Custom
    fields are batch-level (one field set applies to every row)."""

    rows: list[BulkRow] = Field(min_length=1, max_length=100)
    depth: Depth = "fast"
    custom_fields: list[CustomFieldDef] = Field(default_factory=list, max_length=_MAX_CUSTOM_FIELDS)

    @model_validator(mode="after")
    def _key_custom_fields(self) -> BulkRequest:
        _assign_custom_keys(self.custom_fields)
        return self
