"""Exercise notebook code without running its setup or live API cells."""

import ast
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from google.genai import types
from pydantic import BaseModel, Field


@pytest.fixture
def notebook():
    path = Path(__file__).parents[1] / "gemini_search_enrichment.ipynb"
    namespace = {"BaseModel": BaseModel, "Field": Field, "types": types, "json": json}
    for cell in json.loads(path.read_text())["cells"]:
        if cell["cell_type"] != "code" or "".join(cell["source"]).startswith("%"):
            continue
        for node in ast.parse("".join(cell["source"])).body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) or (
                isinstance(node, ast.Assign)
                and any(
                    isinstance(t, ast.Name) and t.id == "ENRICHMENT_POLICY" for t in node.targets
                )
            ):
                exec(
                    compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace
                )
    return namespace


def grounded_response(parts=None, supports=None):
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(parts=parts or [types.Part(text="A supported fact.")]),
                grounding_metadata=types.GroundingMetadata(
                    grounding_chunks=[
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                uri="https://example.com/about", title="About"
                            )
                        )
                    ],
                    grounding_supports=supports or [],
                ),
            )
        ]
    )


def support(part_index, end_index, start_index=0, indices=None):
    return types.GroundingSupport(
        segment=types.Segment(part_index=part_index, start_index=start_index, end_index=end_index),
        grounding_chunk_indices=[0] if indices is None else indices,
    )


def company(notebook, **changes):
    values = dict(
        company_name="Example",
        official_domain="example.com",
        ceo_name="Alex",
        headquarters="unknown",
        founded_year="unknown",
        citations=[dict(field="ceo_name", url="https://example.com/about", note="Alex")],
    )
    values.update(changes)
    return notebook["CompanyEnrichment"](**values)


def verify(notebook, enriched):
    notebook["verify_citations"](
        enriched,
        {"company_name": "Example", "official_domain": "example.com"},
        [{"url": "https://example.com/about", "title": "About"}],
    )


def test_identity_change_rejected(notebook):
    with pytest.raises(ValueError, match="identity"):
        verify(notebook, company(notebook, company_name="Another company"))


def test_citation_field_must_exist(notebook):
    enriched = company(notebook)
    enriched.citations.append(
        notebook["Citation"](field="made_up", url="https://example.com/about", note="x")
    )
    with pytest.raises(ValueError, match="field"):
        verify(notebook, enriched)


def test_valid_record_and_unknown_fields_pass(notebook, capsys):
    verify(notebook, company(notebook))
    assert "All citations verified" not in capsys.readouterr().out


@pytest.mark.parametrize("change", ["invented_url", "missing_citation"])
def test_url_and_coverage_failures(notebook, change):
    enriched = company(notebook)
    if change == "invented_url":
        enriched.citations[0].url = "https://invented.example/"
    else:
        enriched.citations = []
    with pytest.raises((ValueError, AssertionError)):
        verify(notebook, enriched)


def test_provenance_does_not_prove_fact_or_string_format(notebook):
    enriched = company(notebook, founded_year="yesterday")
    enriched.citations.append(
        notebook["Citation"](
            field="founded_year", url="https://example.com/about", note="unsupported statement"
        )
    )
    verify(notebook, enriched)  # Semantic review remains separate from these checks.


@pytest.mark.parametrize(
    "parts,claim,expected",
    [
        (
            [types.Part(text="First. "), types.Part(text="Second.")],
            support(1, 7),
            "First. Second.[1]",
        ),
        ([types.Part(text="Café")], support(0, 5), "Café[1]"),
        (
            [types.Part(text="Private thought", thought=True), types.Part(text="Café")],
            support(1, 5),
            "Café[1]",
        ),
        (
            [
                types.Part(inline_data=types.Blob(mime_type="image/png", data=b"test")),
                types.Part(text="Café"),
            ],
            support(1, 5),
            "Café[1]",
        ),
    ],
)
def test_inline_citations_follow_part_and_byte_offsets(notebook, parts, claim, expected):
    result = notebook["with_inline_citations"](grounded_response(parts, [claim]))
    assert result.split("\n\nSources:")[0] == expected
    assert "[1] About" in result and "https://example.com/about" in result


@pytest.mark.parametrize("invalid_character", ["\ud800", "\udfff"])
def test_malformed_unicode_falls_back_without_reusing_offsets(notebook, invalid_character):
    response = grounded_response(
        [types.Part(text=f"Bad{invalid_character} text. "), types.Part(text="Café")],
        [support(0, 3), support(1, 5)],
    )
    result = notebook["with_inline_citations"](response)
    assert result.split("\n\nSources:")[0] == "Bad? text. Café[1]"
    assert "[1] About: https://example.com/about" in result
    result.encode("utf-8")


@pytest.mark.parametrize(
    "claim",
    [
        support(3, 4),
        support(0, 40),
        support(0, 4),
        support(0, 5, start_index=6),
        support(0, 5, indices=[8]),
        types.GroundingSupport(grounding_chunk_indices=[0]),
    ],
)
def test_invalid_segments_do_not_attach_citations(notebook, claim):
    result = notebook["with_inline_citations"](
        grounded_response([types.Part(text="Café")], [claim])
    )
    assert result.split("\n\nSources:")[0] == "Café"


@pytest.mark.parametrize(
    "response",
    [
        types.GenerateContentResponse(),
        types.GenerateContentResponse(
            candidates=[
                types.Candidate(content=types.Content(parts=[types.Part(text="No sources")]))
            ]
        ),
        types.GenerateContentResponse(
            candidates=[types.Candidate(grounding_metadata=types.GroundingMetadata())]
        ),
    ],
)
def test_missing_grounding_stops_with_actionable_error(notebook, response):
    with pytest.raises(ValueError, match="[Gg]round|[Ee]vidence|[Cc]andidate"):
        notebook["normalize_sources"](response)


def test_missing_parsed_record_stops_before_verification(notebook):
    generate = Mock(side_effect=[grounded_response(), types.GenerateContentResponse()])
    notebook.update(
        client=SimpleNamespace(models=SimpleNamespace(generate_content=generate)),
        MODEL="test-model",
        parallel_tool=types.Tool(parallel_ai_search=types.ToolParallelAiSearch()),
    )
    with pytest.raises(ValueError, match="[Ss]tructur|[Pp]ars"):
        notebook["enrich"](
            {"company_name": "Example", "official_domain": "example.com"},
            notebook["CompanyEnrichment"],
            "Research this company",
        )


@pytest.mark.parametrize("key", ["", "test-key"])
def test_auth_modes_use_notebook_tool(key):
    path = Path(__file__).parents[1] / "gemini_search_enrichment.ipynb"
    namespace = {"types": types, "PARALLEL_API_KEY": key}
    for cell in json.loads(path.read_text())["cells"]:
        source = "".join(cell["source"])
        if cell["cell_type"] == "code" and "parallel_tool =" in source:
            assignment = next(
                node
                for node in ast.parse(source).body
                if isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "parallel_tool" for t in node.targets)
            )
            exec(
                compile(ast.Module(body=[assignment], type_ignores=[]), str(path), "exec"),
                namespace,
            )
    payload = namespace["parallel_tool"].model_dump(exclude_none=True)["parallel_ai_search"]
    if key:
        assert payload["api_key"] == key
    else:
        assert "api_key" not in payload


def test_company_step_rejects_missing_parsed_result(notebook):
    path = Path(__file__).parents[1] / "gemini_search_enrichment.ipynb"
    source = next(
        "".join(c["source"])
        for c in json.loads(path.read_text())["cells"]
        if c["cell_type"] == "code" and "structuring_response =" in "".join(c["source"])
    )
    generate = Mock(return_value=types.GenerateContentResponse())
    notebook.update(
        client=SimpleNamespace(models=SimpleNamespace(generate_content=generate)),
        MODEL="test-model",
        company_row={"company_name": "Example", "official_domain": "example.com"},
        evidence="A fact",
        grounded_sources=[{"url": "https://example.com/about", "title": "About"}],
    )
    with pytest.raises(ValueError, match="structured company record"):
        exec(compile(source, str(path), "exec"), notebook)


def test_enrich_keeps_research_and_extraction_separate(notebook):
    enriched = company(notebook)
    generate = Mock(
        side_effect=[grounded_response(), types.GenerateContentResponse(parsed=enriched)]
    )
    tool = types.Tool(parallel_ai_search=types.ToolParallelAiSearch())
    notebook.update(
        client=SimpleNamespace(models=SimpleNamespace(generate_content=generate)),
        MODEL="test-model",
        parallel_tool=tool,
    )
    result = notebook["enrich"](
        {"company_name": "Example", "official_domain": "example.com"},
        notebook["CompanyEnrichment"],
        "Research Example",
    )
    assert result is enriched
    research, extraction = generate.call_args_list
    assert research.kwargs["config"].tools == [tool]
    assert not extraction.kwargs["config"].tools
    assert extraction.kwargs["config"].response_schema is notebook["CompanyEnrichment"]
    assert "A supported fact." in extraction.kwargs["contents"]
    assert "https://example.com/about" in extraction.kwargs["contents"]
